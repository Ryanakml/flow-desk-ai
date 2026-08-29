import { Router, type Request, type Response } from "express";
import {
  type Problem,
  UpdateBotConfigRequestSchema,
  GenerateBotDraftResponseSchema
} from "@flowdesk/contracts";
import {
  getBotConfig,
  upsertBotConfig,
  getConversationWithMessages,
  searchDocumentChunks,
  recordBotRun,
  type DbClient,
  type BotTone,
  type BotLanguage,
  type BotMode
} from "@flowdesk/db";
import {
  buildCitations,
  formatKnowledgeContext,
  assemblePromptContext,
  type ConversationMessageContext
} from "@flowdesk/domain";
import { FakeEmbeddingProvider, FakeAiChatProvider } from "@flowdesk/providers";
import {
  checkPromptInjection,
  redactPiiFromPrompt,
  checkTokenBudget,
  LlmCircuitBreaker
} from "@flowdesk/security";
import { createRequireAuthMiddleware } from "./auth.js";
import { createRequireOrgPermissionMiddleware } from "./organizations.js";

const embeddingProvider = new FakeEmbeddingProvider();
const chatProvider = new FakeAiChatProvider();
const llmCircuitBreaker = new LlmCircuitBreaker({
  failureThreshold: 3,
  recoveryTimeMs: 30_000,
  name: "ai-chat-provider"
});

export interface BotRouterOptions {
  db: DbClient;
}

function getParam(params: Record<string, string | string[] | undefined>, key: string): string {
  const val = params[key];
  if (Array.isArray(val)) return val[0] ?? "";
  return typeof val === "string" ? val : "";
}

function sendProblem(
  response: Response,
  status: number,
  code: string,
  title: string,
  detail: string
) {
  const problem: Problem = {
    type: `https://flowdesk.dev/problems/${code.toLowerCase().replaceAll("_", "-")}`,
    title,
    status,
    code,
    detail,
    requestId: response.getHeader("x-request-id")?.toString() ?? "unknown"
  };
  return response.status(status).type("application/problem+json").json(problem);
}

export function createBotRouter(options: BotRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const requireAuth = createRequireAuthMiddleware(options.db);
  const requireViewPermission = createRequireOrgPermissionMiddleware(
    options.db,
    "conversation:read"
  );
  const requireAdminPermission = createRequireOrgPermissionMiddleware(
    options.db,
    "automation:publish"
  );

  // GET /api/v1/organizations/:orgId/bot/config
  router.get(
    "/config",
    requireAuth,
    requireViewPermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");

        let config = await getBotConfig(options.db, orgId);
        if (!config) {
          config = await upsertBotConfig(options.db, { organizationId: orgId });
        }

        return response.status(200).json(config);
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          err instanceof Error ? err.message : "Failed to fetch bot config"
        );
      }
    }
  );

  // PUT /api/v1/organizations/:orgId/bot/config
  router.put(
    "/config",
    requireAuth,
    requireAdminPermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");

        const parseResult = UpdateBotConfigRequestSchema.safeParse(request.body);
        if (!parseResult.success) {
          return sendProblem(
            response,
            400,
            "INVALID_REQUEST",
            "Validation error",
            parseResult.error.issues[0]?.message || "Invalid body"
          );
        }

        const payload: {
          organizationId: string;
          instructions?: string;
          tone?: BotTone;
          language?: BotLanguage;
          confidenceThreshold?: number;
          topK?: number;
          mode?: BotMode;
          emergencyDisabled?: boolean;
        } = { organizationId: orgId };

        if (parseResult.data.instructions !== undefined)
          payload.instructions = parseResult.data.instructions;
        if (parseResult.data.tone !== undefined) payload.tone = parseResult.data.tone;
        if (parseResult.data.language !== undefined) payload.language = parseResult.data.language;
        if (parseResult.data.confidenceThreshold !== undefined)
          payload.confidenceThreshold = parseResult.data.confidenceThreshold;
        if (parseResult.data.topK !== undefined) payload.topK = parseResult.data.topK;
        if (parseResult.data.mode !== undefined) payload.mode = parseResult.data.mode;
        if (parseResult.data.emergencyDisabled !== undefined)
          payload.emergencyDisabled = parseResult.data.emergencyDisabled;

        const updated = await upsertBotConfig(options.db, payload);

        return response.status(200).json(updated);
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          err instanceof Error ? err.message : "Failed to update bot config"
        );
      }
    }
  );

  // POST /api/v1/organizations/:orgId/bot/draft/:conversationId
  router.post(
    "/draft/:conversationId",
    requireAuth,
    requireViewPermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const conversationId = getParam(request.params, "conversationId");

        const tenantContext = {
          organizationId: orgId,
          actorId: request.user!.id,
          correlationId: response.getHeader("x-request-id")?.toString() || "req-id"
        };

        const startTime = Date.now();
        let config = await getBotConfig(options.db, orgId);
        if (!config) {
          config = await upsertBotConfig(options.db, { organizationId: orgId });
        }

        if (config.mode === "off" || config.emergencyDisabled) {
          const offRun = await recordBotRun(options.db, {
            organizationId: orgId,
            conversationId,
            mode: config.mode,
            status: "completed",
            suggestedContent: "",
            confidence: 0,
            promptTokens: 0,
            completionTokens: 0,
            latencyMs: Date.now() - startTime,
            costEstimateMicrocents: 0,
            citations: []
          });

          return response.status(200).json(
            GenerateBotDraftResponseSchema.parse({
              runId: offRun.id,
              status: "off",
              suggestedContent: "",
              citations: [],
              confidence: 0,
              reasoning: "Bot mode is OFF or emergency disabled"
            })
          );
        }

        const conversation = await getConversationWithMessages(
          options.db,
          tenantContext,
          conversationId
        );

        if (!conversation) {
          return sendProblem(
            response,
            404,
            "RESOURCE_NOT_FOUND",
            "Resource not found",
            `Conversation ${conversationId} not found`
          );
        }

        const recentMessages: ConversationMessageContext[] = conversation.messages.map((m) => ({
          sender: m.senderType === "customer" ? "customer" : "operator",
          text: String(m.content || ""),
          sentAt: new Date(m.createdAt)
        }));

        const latestCustomerMsg =
          [...recentMessages].reverse().find((m) => m.sender === "customer")?.text || "Hello";

        // M4-07: 1. Prompt injection check on customer message
        const injectionCheck = checkPromptInjection(latestCustomerMsg);
        // Use sanitized message for all downstream processing
        const safeCustomerMsg = injectionCheck.sanitized;

        // M4-07: 2. PII redaction before sending to LLM
        const piiRedaction = redactPiiFromPrompt(safeCustomerMsg);
        const redactedMsg = piiRedaction.redacted;

        // 1. Generate query embedding (use redacted msg to avoid PII in vector store)
        const embeddings = await embeddingProvider.generateEmbeddings([redactedMsg]);
        const queryEmbedding = embeddings[0]?.embedding ?? new Array<number>(1536).fill(0);

        // 2. Perform vector search in pgvector
        const rawChunks = await searchDocumentChunks(options.db, {
          organizationId: orgId,
          queryEmbedding,
          topK: config.topK,
          similarityThreshold: config.confidenceThreshold
        });

        // 3. Build citations & knowledge context
        const citations = buildCitations(rawChunks);
        const knowledgeContext = formatKnowledgeContext(citations);

        // 4. Assemble prompt context
        const promptContext = assemblePromptContext({
          instructions: config.instructions,
          tone: config.tone,
          language: config.language,
          knowledgeContext,
          messages: recentMessages
        });

        // M4-07: 3. Token budget enforcement before calling LLM
        const budgetCheck = checkTokenBudget(promptContext.systemInstructions, redactedMsg);
        if (!budgetCheck.allowed) {
          return sendProblem(
            response,
            422,
            "BUDGET_EXCEEDED",
            "Token budget exceeded",
            budgetCheck.reason ?? "Prompt too large for configured token budget"
          );
        }

        // M4-07: 4. Circuit-breaker-wrapped LLM call
        const chatResponse = await llmCircuitBreaker.call(() =>
          chatProvider.generateReplyDraft(promptContext.systemInstructions, redactedMsg)
        );

        const latencyMs = Date.now() - startTime;
        const confidence = chatResponse.confidence ?? 0.85;
        const runStatus = confidence >= config.confidenceThreshold ? "drafted" : "escalated";

        const costEstimateMicrocents = Math.ceil(
          (chatResponse.promptTokens + chatResponse.completionTokens) * 0.15
        );

        // 6. Record audit entry in bot_runs
        const dbCitations = citations.map((c) => ({
          chunkId: c.chunkId,
          sourceTitle: c.documentTitle,
          snippet: c.snippet,
          score: c.score
        }));

        const botRun = await recordBotRun(options.db, {
          organizationId: orgId,
          conversationId,
          mode: config.mode,
          status: citations.length > 0 ? "completed" : "fallback_no_evidence",
          suggestedContent: chatResponse.content,
          confidence,
          reasoning: chatResponse.reasoning ?? null,
          promptTokens: chatResponse.promptTokens,
          completionTokens: chatResponse.completionTokens,
          totalTokens: chatResponse.promptTokens + chatResponse.completionTokens,
          latencyMs,
          costEstimateMicrocents,
          citations: dbCitations
        });

        return response.status(200).json(
          GenerateBotDraftResponseSchema.parse({
            runId: botRun.id,
            status: runStatus,
            suggestedContent: chatResponse.content,
            citations,
            confidence,
            reasoning: chatResponse.reasoning
          })
        );
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          err instanceof Error ? err.message : "Failed to generate AI draft"
        );
      }
    }
  );

  return router;
}
