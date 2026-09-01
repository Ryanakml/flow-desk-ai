import {
  claimBotDraftRuns,
  finishBotDraftRun,
  getBotConfig,
  getBotRunById,
  getConversationWithMessages,
  getLatestKnowledgeVersion,
  markBotRunStale,
  requeueBotDraftRun,
  runInTenantTransaction,
  searchDocumentChunks,
  type DbClient
} from "@flowdesk/db";
import {
  assemblePromptContext,
  buildCitations,
  formatKnowledgeContext,
  type ConversationMessageContext
} from "@flowdesk/domain";
import {
  AiProviderError,
  type AiChatProvider,
  type AiEmbeddingProvider
} from "@flowdesk/providers";
import {
  checkPromptInjection,
  checkTokenBudget,
  LlmCircuitBreaker,
  redactPiiFromPrompt
} from "@flowdesk/security";
import { recordAiDraftRun } from "@flowdesk/observability";
import { processCompletedAutoRun } from "./auto-send.js";

export interface BotDraftWorkerOptions {
  chatProvider: AiChatProvider;
  embeddingProvider: AiEmbeddingProvider;
  chatModel: string;
  logger?: {
    error: (context: Record<string, unknown>, message: string) => void;
    info?: (context: Record<string, unknown>, message: string) => void;
    warn?: (context: Record<string, unknown>, message: string) => void;
  };
}

interface BotConfigSnapshot {
  instructions: string;
  tone: string;
  language: string;
  confidenceThreshold: number;
  topK: number;
  emergencyDisabled: boolean;
}

const circuitBreaker = new LlmCircuitBreaker({
  failureThreshold: 3,
  recoveryTimeMs: 30_000,
  name: "ai-draft-worker"
});

function configSnapshot(value: Record<string, unknown>): BotConfigSnapshot | null {
  if (
    typeof value["instructions"] !== "string" ||
    typeof value["tone"] !== "string" ||
    typeof value["language"] !== "string" ||
    typeof value["confidenceThreshold"] !== "number" ||
    typeof value["topK"] !== "number" ||
    typeof value["emergencyDisabled"] !== "boolean"
  ) {
    return null;
  }
  return {
    instructions: value["instructions"],
    tone: value["tone"],
    language: value["language"],
    confidenceThreshold: value["confidenceThreshold"],
    topK: value["topK"],
    emergencyDisabled: value["emergencyDisabled"]
  };
}

function providerFailure(error: unknown): {
  code: string;
  detail: string;
  retryable: boolean;
} {
  if (error instanceof AiProviderError) {
    return { code: error.code, detail: error.message, retryable: error.retryable };
  }
  return {
    code: "AI_DRAFT_FAILED",
    detail: "AI draft generation failed.",
    retryable: false
  };
}

export async function processBotDraftBatch(
  db: DbClient,
  options: BotDraftWorkerOptions,
  limit = 5
): Promise<number> {
  const claimedRuns = await claimBotDraftRuns(db, limit);

  for (const claimed of claimedRuns) {
    const startedAt = Date.now();
    let currentStage = "fetch_context";
    try {
      await runInTenantTransaction(
        db,
        { organizationId: claimed.organizationId },
        async (tenantDb) => {
          const run = await getBotRunById(tenantDb, claimed.id);
          const conversation = await getConversationWithMessages(
            tenantDb,
            { organizationId: claimed.organizationId },
            claimed.conversationId
          );
          const currentConfig = await getBotConfig(tenantDb, claimed.organizationId);
          const currentKnowledgeVersion = await getLatestKnowledgeVersion(
            tenantDb,
            claimed.organizationId
          );
          if (!run || !conversation) throw new Error("BOT_DRAFT_CONTEXT_NOT_FOUND");

          if (run.knowledgeVersionId !== (currentKnowledgeVersion?.id ?? null)) {
            await finishBotDraftRun(tenantDb, {
              id: run.id,
              status: "stale",
              errorCode: "KNOWLEDGE_VERSION_CHANGED",
              errorDetail: "Knowledge changed before this draft could be generated."
            });
            return;
          }

          const latestCustomer = [...conversation.messages]
            .reverse()
            .find((message) => message.senderType === "customer");
          if (!latestCustomer || latestCustomer.id !== run.triggerMessageId) {
            await markBotRunStale(tenantDb, run.id);
            return;
          }

          const snapshot = configSnapshot(run.configSnapshot);
          if (!snapshot) throw new Error("BOT_CONFIG_SNAPSHOT_INVALID");
          if (
            snapshot.emergencyDisabled ||
            currentConfig?.emergencyDisabled ||
            currentConfig?.mode === "off"
          ) {
            await finishBotDraftRun(tenantDb, {
              id: run.id,
              status: "off",
              errorCode: "BOT_DISABLED",
              errorDetail: "AI draft generation is disabled."
            });
            return;
          }

          currentStage = "safety_check";
          const injection = checkPromptInjection(latestCustomer.content);
          if (!injection.safe) {
            await finishBotDraftRun(tenantDb, {
              id: run.id,
              status: "safety_blocked",
              errorCode: "PROMPT_INJECTION_BLOCKED",
              errorDetail: "The customer message was blocked by AI safety checks.",
              metadata: { safetyRule: "prompt_injection" }
            });
            return;
          }

          currentStage = "query_embedding";
          const redactedQuery = redactPiiFromPrompt(injection.sanitized);
          const piiTypesRedacted = new Set(redactedQuery.piiFound);
          const embeddingResult = await options.embeddingProvider.generateEmbeddings([
            redactedQuery.redacted
          ]);
          const queryEmbedding = embeddingResult[0]?.embedding;
          if (!queryEmbedding) {
            throw new AiProviderError("AI_PROVIDER_INVALID_RESPONSE", { retryable: true });
          }

          currentStage = "vector_search";
          const rawChunks = await searchDocumentChunks(tenantDb, {
            organizationId: claimed.organizationId,
            queryEmbedding,
            topK: snapshot.topK,
            similarityThreshold: snapshot.confidenceThreshold
          });
          const safeChunks = rawChunks.filter((chunk) => checkPromptInjection(chunk.content).safe);
          const promptChunks = safeChunks.map((chunk) => {
            const redacted = redactPiiFromPrompt(chunk.content);
            redacted.piiFound.forEach((type) => piiTypesRedacted.add(type));
            return { ...chunk, content: redacted.redacted };
          });
          const citations = buildCitations(promptChunks);
          if (citations.length === 0) {
            await finishBotDraftRun(tenantDb, {
              id: run.id,
              status: "no_evidence",
              errorCode: "NO_KNOWLEDGE_EVIDENCE",
              errorDetail: "No sufficiently relevant safe knowledge was found.",
              metadata: { unsafeKnowledgeChunksRemoved: rawChunks.length - safeChunks.length }
            });
            return;
          }

          currentStage = "prompt_assembly";
          const messages: ConversationMessageContext[] = conversation.messages.map((message) => {
            const redacted = redactPiiFromPrompt(message.content);
            redacted.piiFound.forEach((type) => piiTypesRedacted.add(type));
            return {
              sender: message.senderType === "customer" ? "customer" : "operator",
              text: redacted.redacted,
              sentAt: message.createdAt
            };
          });
          const knowledgeContext = formatKnowledgeContext(citations);
          const prompt = assemblePromptContext({
            instructions: snapshot.instructions,
            tone: snapshot.tone,
            language: snapshot.language,
            knowledgeContext,
            messages
          });
          const fullSystemPrompt = `${prompt.systemInstructions}\n\nKnowledge Context:\n${prompt.knowledgeContext}\n\nConversation History:\n${prompt.formattedMessages}`;
          const budget = checkTokenBudget(fullSystemPrompt, redactedQuery.redacted);
          if (!budget.allowed) {
            await finishBotDraftRun(tenantDb, {
              id: run.id,
              status: "budget_exceeded",
              errorCode: "TOKEN_BUDGET_EXCEEDED",
              errorDetail: "The prompt exceeded the configured token budget.",
              metadata: { estimatedPromptTokens: budget.estimatedTokens }
            });
            return;
          }

          currentStage = "chat_generation";
          const reply = await circuitBreaker.call(() =>
            options.chatProvider.generateReplyDraft(fullSystemPrompt, redactedQuery.redacted)
          );
          const unsafeOutput = !checkPromptInjection(reply.content).safe;
          const leakedInstructions =
            snapshot.instructions.length >= 20 && reply.content.includes(snapshot.instructions);
          if (unsafeOutput || leakedInstructions) {
            await finishBotDraftRun(tenantDb, {
              id: run.id,
              status: "safety_blocked",
              errorCode: "AI_OUTPUT_SAFETY_BLOCKED",
              errorDetail: "The generated draft failed output safety checks.",
              promptTokens: reply.promptTokens,
              completionTokens: reply.completionTokens,
              latencyMs: Date.now() - startedAt,
              metadata: { safetyRule: leakedInstructions ? "instruction_leak" : "unsafe_output" }
            });
            return;
          }

          currentStage = "db_persistence";
          const refreshed = await getConversationWithMessages(
            tenantDb,
            { organizationId: claimed.organizationId },
            claimed.conversationId
          );
          const newestCustomer = refreshed?.messages
            .slice()
            .reverse()
            .find((message) => message.senderType === "customer");
          if (!newestCustomer || newestCustomer.id !== run.triggerMessageId) {
            await markBotRunStale(tenantDb, run.id);
            return;
          }
          const refreshedKnowledgeVersion = await getLatestKnowledgeVersion(
            tenantDb,
            claimed.organizationId
          );
          if (run.knowledgeVersionId !== (refreshedKnowledgeVersion?.id ?? null)) {
            await finishBotDraftRun(tenantDb, {
              id: run.id,
              status: "stale",
              errorCode: "KNOWLEDGE_VERSION_CHANGED",
              errorDetail: "Knowledge changed while this draft was being generated.",
              promptTokens: reply.promptTokens,
              completionTokens: reply.completionTokens,
              latencyMs: Date.now() - startedAt
            });
            return;
          }

          const dbCitations = citations.map((citation) => ({
            chunkId: citation.chunkId,
            sourceTitle: citation.documentTitle,
            snippet: citation.snippet,
            score: citation.score
          }));
          await finishBotDraftRun(tenantDb, {
            id: run.id,
            status: "completed",
            suggestedContent: reply.content,
            citations: dbCitations,
            reasoning: reply.reasoning ?? null,
            confidence: reply.confidence ?? 0,
            promptTokens: reply.promptTokens,
            completionTokens: reply.completionTokens,
            latencyMs: Date.now() - startedAt,
            costEstimateMicrocents: Math.ceil((reply.promptTokens + reply.completionTokens) * 0.15),
            model: options.chatModel,
            metadata: {
              provider: options.chatProvider.name,
              model: options.chatModel,
              piiTypesRedacted: [...piiTypesRedacted].sort(),
              unsafeKnowledgeChunksRemoved: rawChunks.length - safeChunks.length
            }
          });
          if (run.mode === "auto") {
            currentStage = "auto_pre_send";
            await processCompletedAutoRun(tenantDb, {
              organizationId: claimed.organizationId,
              runId: run.id
            });
          }
        }
      );
      const outcome = await runInTenantTransaction(
        db,
        { organizationId: claimed.organizationId },
        (tenantDb) => getBotRunById(tenantDb, claimed.id)
      );
      if (outcome) {
        recordAiDraftRun({
          provider: options.chatProvider.name,
          status: outcome.status,
          durationSeconds: (Date.now() - startedAt) / 1_000,
          promptTokens: outcome.promptTokens,
          completionTokens: outcome.completionTokens,
          costMicrocents: outcome.costEstimateMicrocents
        });
      }
    } catch (error) {
      const failure = providerFailure(error);
      const willRetry = failure.retryable && claimed.attempts < claimed.maxAttempts;

      const aiErr = error instanceof AiProviderError ? error : undefined;
      const dbErr = error as Error & {
        code?: unknown;
        detail?: unknown;
        constraint?: unknown;
      };

      const errorPayload: Record<string, unknown> = {
        organizationId: claimed.organizationId,
        conversationId: claimed.conversationId,
        runId: claimed.id,
        stage: currentStage,
        provider: options.chatProvider.name,
        chatModel: options.chatModel,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
        ...(aiErr?.httpStatus !== undefined ? { httpStatus: aiErr.httpStatus } : {}),
        ...(aiErr?.httpBody !== undefined ? { httpBody: aiErr.httpBody } : {}),
        ...(typeof dbErr?.code === "string" ? { pgCode: dbErr.code, errorCode: dbErr.code } : {}),
        ...(typeof dbErr?.detail === "string"
          ? { pgDetail: dbErr.detail, errorDetail: dbErr.detail }
          : {}),
        ...(typeof dbErr?.constraint === "string"
          ? { pgConstraint: dbErr.constraint, errorConstraint: dbErr.constraint }
          : {})
      };

      if (options.logger?.error) {
        options.logger.error(errorPayload, "worker.bot_draft.failed");
      } else {
        process.stderr.write(
          `${JSON.stringify({ level: "error", msg: "worker.bot_draft.failed", ...errorPayload })}\n`
        );
      }

      await runInTenantTransaction(
        db,
        { organizationId: claimed.organizationId },
        async (tenantDb) => {
          if (willRetry) {
            await requeueBotDraftRun(tenantDb, {
              id: claimed.id,
              availableAt: new Date(Date.now() + Math.min(60_000, 2 ** claimed.attempts * 1_000)),
              errorCode: failure.code,
              errorDetail: failure.detail
            });
            return;
          }
          await finishBotDraftRun(tenantDb, {
            id: claimed.id,
            status: "provider_failed",
            errorCode: failure.code,
            errorDetail: failure.detail,
            latencyMs: Date.now() - startedAt
          });
        }
      );
      recordAiDraftRun({
        provider: options.chatProvider.name,
        status: willRetry ? "retry_scheduled" : "provider_failed",
        durationSeconds: (Date.now() - startedAt) / 1_000
      });
    }
  }

  return claimedRuns.length;
}
