import { Router, type Response } from "express";
import {
  BotDraftActionRequestSchema,
  GenerateBotDraftResponseSchema,
  MessageSchema,
  UpdateBotConfigRequestSchema,
  type Problem
} from "@flowdesk/contracts";
import {
  createOutboundMessageWithOutbox,
  enqueueBotDraftRun,
  getBotConfig,
  getBotRunById,
  getConversationWithMessages,
  getLatestKnowledgeVersion,
  getLatestBotRunForConversation,
  getOutboundMessageByBotRun,
  markBotRunStale,
  recordAuditEvent,
  recordBotRun,
  runInTenantTransaction,
  updateBotRunAction,
  upsertBotConfig,
  type BotLanguage,
  type BotMode,
  type BotRun,
  type BotTone,
  type DbClient,
  type MessageRecord
} from "@flowdesk/db";
import { calculateServiceWindow } from "@flowdesk/domain";
import { createRequireAuthMiddleware } from "./auth.js";
import { createRequireOrgPermissionMiddleware } from "./organizations.js";

export interface BotRouterOptions {
  db: DbClient;
}

function getParam(params: Record<string, string | string[] | undefined>, key: string): string {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? "";
  return typeof value === "string" ? value : "";
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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

function serializeBotRun(run: BotRun) {
  return GenerateBotDraftResponseSchema.parse({
    runId: run.id,
    status: run.status === "completed" ? "drafted" : run.status,
    suggestedContent: run.suggestedContent ?? "",
    citations: run.citations.map((citation) => ({
      chunkId: citation.chunkId,
      documentTitle: citation.sourceTitle,
      snippet: citation.snippet,
      score: citation.score
    })),
    confidence: run.confidence ?? 0,
    ...(run.reasoning ? { reasoning: run.reasoning } : {}),
    sendable:
      run.status === "completed" && Boolean(run.suggestedContent) && run.operatorAction === null,
    errorCode: run.errorCode,
    createdAt: toIso(run.createdAt),
    updatedAt: toIso(run.updatedAt)
  });
}

function serializeMessage(message: MessageRecord) {
  return MessageSchema.parse({
    ...message,
    sentAt: message.sentAt ? toIso(message.sentAt) : null,
    deliveredAt: message.deliveredAt ? toIso(message.deliveredAt) : null,
    readAt: message.readAt ? toIso(message.readAt) : null,
    createdAt: toIso(message.createdAt),
    updatedAt: toIso(message.updatedAt)
  });
}

function latestCustomerMessage(
  messages: Array<{ id: string; senderType: string; createdAt: Date }>
) {
  return [...messages].reverse().find((message) => message.senderType === "customer") ?? null;
}

async function staleIfSuperseded(
  db: DbClient,
  run: BotRun,
  messages: Array<{ id: string; senderType: string; createdAt: Date }>
): Promise<BotRun> {
  const latest = latestCustomerMessage(messages);
  if (
    run.triggerMessageId &&
    latest &&
    latest.id !== run.triggerMessageId &&
    ["queued", "processing", "completed"].includes(run.status)
  ) {
    await markBotRunStale(db, run.id);
    return (await getBotRunById(db, run.id)) ?? { ...run, status: "stale" };
  }
  return run;
}

export function createBotRouter(options: BotRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const requireAuth = createRequireAuthMiddleware(options.db);
  const requireView = createRequireOrgPermissionMiddleware(options.db, "conversation:read");
  const requireSend = createRequireOrgPermissionMiddleware(options.db, "message:send");
  const requireAdmin = createRequireOrgPermissionMiddleware(options.db, "automation:publish");

  router.get("/config", requireAuth, requireView, async (request, response) => {
    try {
      const organizationId = getParam(request.params, "orgId");
      const config = await runInTenantTransaction(
        options.db,
        { organizationId },
        async (db) =>
          (await getBotConfig(db, organizationId)) ?? upsertBotConfig(db, { organizationId })
      );
      return response.status(200).json(config);
    } catch {
      return sendProblem(
        response,
        500,
        "INTERNAL_ERROR",
        "Internal error",
        "Failed to fetch bot configuration."
      );
    }
  });

  router.put("/config", requireAuth, requireAdmin, async (request, response) => {
    const parsed = UpdateBotConfigRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendProblem(
        response,
        400,
        "INVALID_REQUEST",
        "Validation error",
        parsed.error.issues[0]?.message ?? "Invalid body"
      );
    }
    try {
      const organizationId = getParam(request.params, "orgId");
      const payload: {
        organizationId: string;
        instructions?: string;
        tone?: BotTone;
        language?: BotLanguage;
        confidenceThreshold?: number;
        topK?: number;
        mode?: BotMode;
        emergencyDisabled?: boolean;
      } = { organizationId };
      if (parsed.data.instructions !== undefined) payload.instructions = parsed.data.instructions;
      if (parsed.data.tone !== undefined) payload.tone = parsed.data.tone;
      if (parsed.data.language !== undefined) payload.language = parsed.data.language;
      if (parsed.data.confidenceThreshold !== undefined) {
        payload.confidenceThreshold = parsed.data.confidenceThreshold;
      }
      if (parsed.data.topK !== undefined) payload.topK = parsed.data.topK;
      if (parsed.data.mode !== undefined) payload.mode = parsed.data.mode;
      if (parsed.data.emergencyDisabled !== undefined) {
        payload.emergencyDisabled = parsed.data.emergencyDisabled;
      }
      const updated = await runInTenantTransaction(options.db, { organizationId }, async (db) => {
        const config = await upsertBotConfig(db, payload);
        await recordAuditEvent(db, {
          organizationId,
          actorUserId: request.user!.id,
          action: "bot:config:update",
          targetType: "bot_config",
          targetId: config.id,
          result: "allowed",
          metadata: {
            mode: config.mode,
            emergencyDisabled: config.emergencyDisabled,
            model: config.model
          }
        });
        return config;
      });
      return response.status(200).json(updated);
    } catch {
      return sendProblem(
        response,
        500,
        "INTERNAL_ERROR",
        "Internal error",
        "Failed to update bot configuration."
      );
    }
  });

  router.get(
    "/draft/:conversationId/latest",
    requireAuth,
    requireView,
    async (request, response) => {
      try {
        const organizationId = getParam(request.params, "orgId");
        const conversationId = getParam(request.params, "conversationId");
        const run = await runInTenantTransaction(options.db, { organizationId }, async (db) => {
          const [latestRun, conversation] = await Promise.all([
            getLatestBotRunForConversation(db, organizationId, conversationId),
            getConversationWithMessages(db, { organizationId }, conversationId)
          ]);
          if (!latestRun || !conversation) return null;
          return staleIfSuperseded(db, latestRun, conversation.messages);
        });
        if (!run) {
          return sendProblem(
            response,
            404,
            "DRAFT_NOT_FOUND",
            "Draft not found",
            "No AI draft exists for this conversation."
          );
        }
        return response.status(200).json(serializeBotRun(run));
      } catch {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          "Failed to fetch the AI draft."
        );
      }
    }
  );

  router.post("/draft/:conversationId", requireAuth, requireView, async (request, response) => {
    try {
      const organizationId = getParam(request.params, "orgId");
      const conversationId = getParam(request.params, "conversationId");
      const run = await runInTenantTransaction(options.db, { organizationId }, async (db) => {
        const [existingConfig, conversation, knowledgeVersion] = await Promise.all([
          getBotConfig(db, organizationId),
          getConversationWithMessages(db, { organizationId }, conversationId),
          getLatestKnowledgeVersion(db, organizationId)
        ]);
        if (!conversation) return null;
        const config = existingConfig ?? (await upsertBotConfig(db, { organizationId }));
        const trigger = latestCustomerMessage(conversation.messages);
        const snapshot = {
          instructions: config.instructions,
          tone: config.tone,
          language: config.language,
          confidenceThreshold: config.confidenceThreshold,
          topK: config.topK,
          mode: config.mode,
          emergencyDisabled: config.emergencyDisabled,
          model: config.model,
          botConfigUpdatedAt: toIso(config.updatedAt)
        };

        let createdRun: BotRun;
        if (config.mode === "off" || config.emergencyDisabled) {
          createdRun = await recordBotRun(db, {
            organizationId,
            conversationId,
            triggerMessageId: trigger?.id ?? null,
            botConfigId: config.id,
            knowledgeVersionId: knowledgeVersion?.id ?? null,
            mode: config.mode,
            status: "off",
            requestedByUserId: request.user!.id,
            model: config.model,
            configSnapshot: snapshot,
            inputMessageCreatedAt: trigger?.createdAt ?? null
          });
        } else {
          if (!trigger) throw new Error("CUSTOMER_MESSAGE_REQUIRED");
          createdRun = await enqueueBotDraftRun(db, {
            organizationId,
            conversationId,
            triggerMessageId: trigger.id,
            botConfigId: config.id,
            knowledgeVersionId: knowledgeVersion?.id ?? null,
            requestedByUserId: request.user!.id,
            model: config.model,
            configSnapshot: snapshot,
            inputMessageCreatedAt: trigger.createdAt
          });
        }
        await recordAuditEvent(db, {
          organizationId,
          actorUserId: request.user!.id,
          action: "bot:draft:requested",
          targetType: "bot_run",
          targetId: createdRun.id,
          result: "allowed",
          metadata: { status: createdRun.status, conversationId }
        });
        return createdRun;
      });

      if (!run) {
        return sendProblem(
          response,
          404,
          "RESOURCE_NOT_FOUND",
          "Resource not found",
          "Conversation not found."
        );
      }
      return response.status(run.status === "off" ? 200 : 202).json(serializeBotRun(run));
    } catch (error) {
      if (error instanceof Error && error.message === "CUSTOMER_MESSAGE_REQUIRED") {
        return sendProblem(
          response,
          422,
          "CUSTOMER_MESSAGE_REQUIRED",
          "Customer message required",
          "A customer message is required before generating a draft."
        );
      }
      return sendProblem(
        response,
        500,
        "INTERNAL_ERROR",
        "Internal error",
        "Failed to queue the AI draft."
      );
    }
  });

  router.post("/draft-runs/:runId/action", requireAuth, requireSend, async (request, response) => {
    const parsed = BotDraftActionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendProblem(
        response,
        400,
        "INVALID_REQUEST",
        "Validation error",
        parsed.error.issues[0]?.message ?? "Invalid body"
      );
    }
    try {
      const organizationId = getParam(request.params, "orgId");
      const runId = getParam(request.params, "runId");
      const result = await runInTenantTransaction(options.db, { organizationId }, async (db) => {
        const existing = await getOutboundMessageByBotRun(db, organizationId, runId);
        if (existing) return { kind: "sent" as const, message: existing };
        const run = await getBotRunById(db, runId);
        if (!run) return { kind: "missing" as const };
        const conversation = await getConversationWithMessages(
          db,
          { organizationId },
          run.conversationId
        );
        if (!conversation) return { kind: "missing" as const };
        const latest = latestCustomerMessage(conversation.messages);
        if (!latest || latest.id !== run.triggerMessageId) {
          await markBotRunStale(db, run.id);
          return { kind: "stale" as const };
        }
        if (run.status !== "completed" || !run.suggestedContent || run.operatorAction) {
          return { kind: "not_sendable" as const };
        }
        if (parsed.data.action === "rejected") {
          await updateBotRunAction(db, {
            botRunId: run.id,
            action: "rejected",
            userId: request.user!.id
          });
          await recordAuditEvent(db, {
            organizationId,
            actorUserId: request.user!.id,
            action: "bot:draft:rejected",
            targetType: "bot_run",
            targetId: run.id,
            result: "allowed"
          });
          return { kind: "rejected" as const, run: (await getBotRunById(db, run.id))! };
        }
        if (!calculateServiceWindow(conversation.conversation.lastInboundAt).isOpen) {
          return { kind: "window_closed" as const };
        }
        const action = parsed.data.action === "edited" ? "edited" : "approved";
        const claimed = await updateBotRunAction(db, {
          botRunId: run.id,
          action,
          userId: request.user!.id
        });
        if (!claimed) {
          const concurrent = await getOutboundMessageByBotRun(db, organizationId, run.id);
          return concurrent
            ? { kind: "sent" as const, message: concurrent }
            : { kind: "not_sendable" as const };
        }
        const message = await createOutboundMessageWithOutbox(db, {
          organizationId,
          conversationId: run.conversationId,
          senderUserId: request.user!.id,
          content: parsed.data.editedContent ?? run.suggestedContent,
          correlationId: response.getHeader("x-request-id")?.toString(),
          metadata: { aiBotRunId: run.id, aiDraftAction: action }
        });
        await recordAuditEvent(db, {
          organizationId,
          actorUserId: request.user!.id,
          action: action === "edited" ? "bot:draft:edited" : "bot:draft:approved",
          targetType: "bot_run",
          targetId: run.id,
          result: "allowed",
          metadata: { outboundMessageId: message.id }
        });
        return { kind: "sent" as const, message };
      });

      if (result.kind === "missing") {
        return sendProblem(
          response,
          404,
          "DRAFT_NOT_FOUND",
          "Draft not found",
          "AI draft not found."
        );
      }
      if (result.kind === "stale") {
        return sendProblem(
          response,
          409,
          "DRAFT_STALE",
          "Draft is stale",
          "A newer customer message makes this draft unsafe to send."
        );
      }
      if (result.kind === "not_sendable") {
        return sendProblem(
          response,
          409,
          "DRAFT_NOT_SENDABLE",
          "Draft is not sendable",
          "The draft is incomplete or was already actioned."
        );
      }
      if (result.kind === "window_closed") {
        return sendProblem(
          response,
          422,
          "SERVICE_WINDOW_CLOSED",
          "Service window closed",
          "An approved WhatsApp template is required outside the service window."
        );
      }
      if (result.kind === "rejected") {
        return response.status(200).json({ run: serializeBotRun(result.run), message: null });
      }
      return response.status(201).json({ message: serializeMessage(result.message) });
    } catch {
      return sendProblem(
        response,
        500,
        "INTERNAL_ERROR",
        "Internal error",
        "Failed to apply the draft action."
      );
    }
  });

  router.post("/emergency-stop", requireAuth, requireAdmin, async (request, response) => {
    try {
      const organizationId = getParam(request.params, "orgId");
      const enabled = (request.body as { enabled?: boolean }).enabled ?? true;
      const updated = await runInTenantTransaction(options.db, { organizationId }, async (db) => {
        const config = await upsertBotConfig(db, {
          organizationId,
          emergencyDisabled: enabled
        });
        await recordAuditEvent(db, {
          organizationId,
          actorUserId: request.user!.id,
          action: enabled ? "bot:emergency-stop:enabled" : "bot:emergency-stop:disabled",
          targetType: "bot_config",
          targetId: config.id,
          result: "allowed"
        });
        return config;
      });
      return response.status(200).json({
        organizationId,
        emergencyDisabled: updated.emergencyDisabled,
        triggeredAt: new Date().toISOString()
      });
    } catch {
      return sendProblem(
        response,
        500,
        "INTERNAL_ERROR",
        "Internal error",
        "Failed to toggle emergency stop."
      );
    }
  });

  return router;
}
