import { createHash } from "node:crypto";
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
import {
  calculateServiceWindow,
  evaluateAutoReleaseGate,
  type BotEvaluationScores,
  type ReleaseApproval
} from "@flowdesk/domain";
import { currentRequestContext } from "@flowdesk/observability";
import { createRequireAuthMiddleware } from "./auth.js";
import { createRequireOrgPermissionMiddleware } from "./organizations.js";

interface AutoReleaseGateRow {
  id: string;
  organization_id: string;
  bot_config_id: string;
  policy_id: string | null;
  policy_version: number;
  cohort: "internal" | "beta" | "general";
  status: "pending" | "approved" | "rejected" | "paused" | "revoked";
  eval_scores: BotEvaluationScores;
  approvals: ReleaseApproval[];
  sampling_rate: number | string;
  rate_limit_per_hour: number;
  monthly_cost_ceiling_cents: number;
  rollback_owner: string;
  created_at: string;
  updated_at: string;
}

interface CreateReleaseGateBody {
  policyId?: string;
  policyVersion?: number;
  cohort?: "internal" | "beta" | "general";
  evalScores?: Partial<BotEvaluationScores>;
  approvals?: ReleaseApproval[];
  samplingRate?: number;
  rateLimitPerHour?: number;
  monthlyCostCeilingCents?: number;
  customerConsentRequired?: boolean;
  aiDisclosureEnabled?: boolean;
  rollbackOwner?: string;
}

export interface BotRouterOptions {
  db: DbClient;
  logger?: {
    error: (context: Record<string, unknown>, message: string) => void;
    info?: (context: Record<string, unknown>, message: string) => void;
    warn?: (context: Record<string, unknown>, message: string) => void;
  };
  logError?: (event: {
    requestId: string;
    correlationId: string;
    method: string;
    path: string;
    errorName: string;
    errorMessage: string;
    errorCode?: string;
    errorConstraint?: string;
    stack?: string;
    [key: string]: unknown;
  }) => void;
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
          const latestRun = await getLatestBotRunForConversation(
            db,
            organizationId,
            conversationId
          );
          if (!latestRun) return null;
          const conversation = await getConversationWithMessages(
            db,
            { organizationId },
            conversationId
          );
          if (!conversation) return null;
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
        const conversation = await getConversationWithMessages(
          db,
          { organizationId },
          conversationId
        );
        if (!conversation) return null;
        const existingConfig = await getBotConfig(db, organizationId);
        const knowledgeVersion = await getLatestKnowledgeVersion(db, organizationId);
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
            inputMessageCreatedAt: trigger.createdAt,
            mode: "draft"
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

      const requestId =
        response.getHeader("x-request-id")?.toString() ??
        request.header("x-request-id") ??
        currentRequestContext()?.requestId ??
        "unknown";
      const correlationId =
        request.header("x-correlation-id") ?? currentRequestContext()?.correlationId ?? requestId;
      const organizationId = getParam(request.params, "orgId");
      const conversationId = getParam(request.params, "conversationId");

      const dbErr = error as Error & {
        code?: unknown;
        detail?: unknown;
        constraint?: unknown;
        schema?: unknown;
        table?: unknown;
      };

      const errorPayload = {
        requestId,
        correlationId,
        method: request.method,
        path:
          request.originalUrl ||
          request.url ||
          `/api/v1/organizations/${organizationId}/bot/draft/${conversationId}`,
        organizationId,
        conversationId,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
        ...(typeof dbErr?.code === "string" ? { errorCode: dbErr.code, pgCode: dbErr.code } : {}),
        ...(typeof dbErr?.detail === "string"
          ? { errorDetail: dbErr.detail, pgDetail: dbErr.detail }
          : {}),
        ...(typeof dbErr?.constraint === "string"
          ? { errorConstraint: dbErr.constraint, pgConstraint: dbErr.constraint }
          : {})
      };

      if (options.logger?.error) {
        options.logger.error(errorPayload, "bot.draft.enqueue_failed");
      } else if (options.logError) {
        options.logError(errorPayload);
      } else {
        process.stderr.write(
          `${JSON.stringify({ level: "error", msg: "bot.draft.enqueue_failed", ...errorPayload })}\n`
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
            userId: request.user!.id,
            metadata: { rejectionReason: parsed.data.rejectionReason ?? "unspecified" }
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
        if (conversation.conversation.status === "closed") {
          return { kind: "conversation_closed" as const };
        }
        const currentConfig = await getBotConfig(db, organizationId, { forShare: true });
        if (currentConfig?.emergencyDisabled) return { kind: "bot_disabled" as const };
        if (!calculateServiceWindow(conversation.conversation.lastInboundAt).isOpen) {
          return { kind: "window_closed" as const };
        }
        const action = parsed.data.action === "edited" ? "edited" : "approved";
        const finalContent = parsed.data.editedContent ?? run.suggestedContent;
        const claimed = await updateBotRunAction(db, {
          botRunId: run.id,
          action,
          userId: request.user!.id,
          metadata: {
            finalContentHash: createHash("sha256").update(finalContent, "utf8").digest("hex")
          }
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
          content: finalContent,
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
      if (result.kind === "conversation_closed") {
        return sendProblem(
          response,
          409,
          "CONVERSATION_CLOSED",
          "Conversation closed",
          "A closed conversation cannot receive an approved AI draft."
        );
      }
      if (result.kind === "bot_disabled") {
        return sendProblem(
          response,
          409,
          "BOT_DISABLED",
          "AI assistant disabled",
          "Emergency stop is active, so this draft cannot be sent."
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

  // --- M5 #179: AUTO Release Gate, Staged Tenant Enablement & Approvals ---
  router.get("/release-gate", requireAuth, requireView, async (request, response) => {
    try {
      const organizationId = getParam(request.params, "orgId");
      const gates = await runInTenantTransaction(options.db, { organizationId }, async (db) => {
        return db.query<AutoReleaseGateRow>(
          `SELECT * FROM flowdesk.auto_release_gates
           WHERE organization_id = $1
           ORDER BY created_at DESC`,
          [organizationId]
        );
      });
      return response.status(200).json({
        organizationId,
        releaseGates: gates.rows
      });
    } catch {
      return sendProblem(
        response,
        500,
        "INTERNAL_ERROR",
        "Internal error",
        "Failed to retrieve release gates."
      );
    }
  });

  router.post("/release-gate", requireAuth, requireAdmin, async (request, response) => {
    try {
      const organizationId = getParam(request.params, "orgId");
      const body = (request.body ?? {}) as CreateReleaseGateBody;

      const result = await runInTenantTransaction(options.db, { organizationId }, async (db) => {
        const botConfig = await getBotConfig(db, organizationId);
        if (!botConfig) {
          return { error: "NOT_FOUND" as const };
        }

        const evalScores: BotEvaluationScores = {
          groundedQuality: body.evalScores?.groundedQuality ?? 0,
          noEvidenceFailClosedRate: body.evalScores?.noEvidenceFailClosedRate ?? 0,
          prohibitedIntentBlockRate: body.evalScores?.prohibitedIntentBlockRate ?? 0,
          multilingualAccuracy: body.evalScores?.multilingualAccuracy ?? 0,
          promptInjectionDefenseRate: body.evalScores?.promptInjectionDefenseRate ?? 0,
          humanEscalationRate: body.evalScores?.humanEscalationRate ?? 0
        };

        const gateConfig = {
          organizationId,
          botConfigId: botConfig.id,
          policyId: body.policyId,
          policyVersion: body.policyVersion ?? 1,
          cohort: body.cohort ?? ("beta" as const),
          evalScores,
          approvals: body.approvals ?? [],
          samplingRate: body.samplingRate ?? 0.1,
          rateLimitPerHour: body.rateLimitPerHour ?? 60,
          monthlyCostCeilingCents: body.monthlyCostCeilingCents ?? 50000,
          customerConsentRequired: body.customerConsentRequired ?? true,
          aiDisclosureEnabled: body.aiDisclosureEnabled ?? true,
          rollbackOwner: body.rollbackOwner || ""
        };

        const evaluation = evaluateAutoReleaseGate(gateConfig);

        const res = await db.query<AutoReleaseGateRow>(
          `INSERT INTO flowdesk.auto_release_gates (
             organization_id, bot_config_id, policy_id, policy_version, cohort, status,
             eval_scores, approvals, sampling_rate, rate_limit_per_hour,
             monthly_cost_ceiling_cents, rollback_owner
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING *`,
          [
            organizationId,
            botConfig.id,
            gateConfig.policyId ?? null,
            gateConfig.policyVersion,
            gateConfig.cohort,
            evaluation.status,
            JSON.stringify(gateConfig.evalScores),
            JSON.stringify(gateConfig.approvals),
            gateConfig.samplingRate,
            gateConfig.rateLimitPerHour,
            gateConfig.monthlyCostCeilingCents,
            gateConfig.rollbackOwner
          ]
        );

        await recordAuditEvent(db, {
          organizationId,
          actorUserId: request.user!.id,
          action: "bot:release-gate:created",
          targetType: "auto_release_gate",
          targetId: res.rows[0]?.id ?? null,
          result: "allowed",
          metadata: { status: evaluation.status, cohort: gateConfig.cohort }
        });

        return { releaseGate: res.rows[0], evaluation };
      });

      if ("error" in result && result.error === "NOT_FOUND") {
        return sendProblem(response, 404, "NOT_FOUND", "Not found", "Bot configuration not found.");
      }

      return response.status(201).json(result);
    } catch {
      return sendProblem(
        response,
        500,
        "INTERNAL_ERROR",
        "Internal error",
        "Failed to create release gate."
      );
    }
  });

  router.post(
    "/release-gate/:gateId/approve",
    requireAuth,
    requireAdmin,
    async (request, response) => {
      try {
        const organizationId = getParam(request.params, "orgId");
        const gateId = getParam(request.params, "gateId");
        const { role, notes } = (request.body ?? {}) as {
          role: "product" | "security" | "peer";
          notes?: string;
        };

        if (!["product", "security", "peer"].includes(role)) {
          return sendProblem(
            response,
            400,
            "INVALID_ROLE",
            "Bad request",
            "Approval role must be product, security, or peer."
          );
        }

        const updated = await runInTenantTransaction(options.db, { organizationId }, async (db) => {
          const existing = await db.query<AutoReleaseGateRow>(
            `SELECT * FROM flowdesk.auto_release_gates WHERE organization_id = $1 AND id = $2`,
            [organizationId, gateId]
          );
          const gate = existing.rows[0];
          if (!gate) return null;

          const approvals: ReleaseApproval[] = Array.isArray(gate.approvals)
            ? [...gate.approvals]
            : [];
          const existingApprovalIndex = approvals.findIndex((a) => a.role === role);
          const approvalEntry: ReleaseApproval = {
            actorId: request.user!.id,
            role,
            approvedAt: new Date().toISOString(),
            notes
          };

          if (existingApprovalIndex >= 0) {
            approvals[existingApprovalIndex] = approvalEntry;
          } else {
            approvals.push(approvalEntry);
          }

          const gateConfig = {
            organizationId,
            botConfigId: gate.bot_config_id,
            policyId: gate.policy_id ?? undefined,
            policyVersion: gate.policy_version,
            cohort: gate.cohort,
            evalScores: gate.eval_scores,
            approvals,
            samplingRate: Number(gate.sampling_rate),
            rateLimitPerHour: gate.rate_limit_per_hour,
            monthlyCostCeilingCents: gate.monthly_cost_ceiling_cents,
            customerConsentRequired: true,
            aiDisclosureEnabled: true,
            rollbackOwner: gate.rollback_owner
          };

          const evaluation = evaluateAutoReleaseGate(gateConfig);

          const res = await db.query<AutoReleaseGateRow>(
            `UPDATE flowdesk.auto_release_gates
           SET approvals = $1, status = $2, updated_at = clock_timestamp()
           WHERE organization_id = $3 AND id = $4
           RETURNING *`,
            [JSON.stringify(approvals), evaluation.status, organizationId, gateId]
          );

          await recordAuditEvent(db, {
            organizationId,
            actorUserId: request.user!.id,
            action: "bot:release-gate:approved",
            targetType: "auto_release_gate",
            targetId: gateId,
            result: "allowed",
            metadata: { role, status: evaluation.status }
          });

          return { gate: res.rows[0], evaluation };
        });

        if (!updated) {
          return sendProblem(response, 404, "NOT_FOUND", "Not found", "Release gate not found.");
        }

        return response.status(200).json(updated);
      } catch {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          "Failed to record release gate approval."
        );
      }
    }
  );

  router.post(
    "/release-gate/:gateId/enable-auto",
    requireAuth,
    requireAdmin,
    async (request, response) => {
      try {
        const organizationId = getParam(request.params, "orgId");
        const gateId = getParam(request.params, "gateId");

        const result = await runInTenantTransaction(options.db, { organizationId }, async (db) => {
          const gateRes = await db.query<AutoReleaseGateRow>(
            `SELECT * FROM flowdesk.auto_release_gates WHERE organization_id = $1 AND id = $2`,
            [organizationId, gateId]
          );
          const gate = gateRes.rows[0];
          if (!gate) return { error: "NOT_FOUND" as const };
          if (gate.status !== "approved") {
            return {
              error: "NOT_APPROVED" as const,
              reason: `Release gate status is '${gate.status}'; must be 'approved'.`
            };
          }

          await db.query(
            `UPDATE flowdesk.bot_configs
           SET auto_enabled = TRUE,
               active_release_gate_id = $1,
               rate_limit_per_hour = $2,
               monthly_cost_ceiling_cents = $3,
               updated_at = clock_timestamp()
           WHERE organization_id = $4 AND id = $5`,
            [
              gate.id,
              gate.rate_limit_per_hour,
              gate.monthly_cost_ceiling_cents,
              organizationId,
              gate.bot_config_id
            ]
          );

          await recordAuditEvent(db, {
            organizationId,
            actorUserId: request.user!.id,
            action: "bot:auto-enabled",
            targetType: "bot_config",
            targetId: gate.bot_config_id,
            result: "allowed",
            metadata: { gateId: gate.id, cohort: gate.cohort }
          });

          return { success: true, gateId: gate.id, cohort: gate.cohort };
        });

        if (result.error === "NOT_FOUND") {
          return sendProblem(response, 404, "NOT_FOUND", "Not found", "Release gate not found.");
        }
        if (result.error === "NOT_APPROVED") {
          return sendProblem(response, 400, "GATE_NOT_APPROVED", "Bad request", result.reason);
        }

        return response.status(200).json({
          organizationId,
          autoEnabled: true,
          releaseGateId: gateId,
          enabledAt: new Date().toISOString()
        });
      } catch {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          "Failed to enable AUTO mode."
        );
      }
    }
  );

  return router;
}
