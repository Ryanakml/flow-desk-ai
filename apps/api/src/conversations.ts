import {
  type Problem,
  ConversationOperationRequestSchema,
  ConversationDetailResponseSchema,
  ConversationSchema,
  CreateOutboundMessageRequestSchema,
  ListConversationsQuerySchema,
  ListConversationsResponseSchema,
  MessageSchema,
  UpdateConversationRequestSchema
} from "@flowdesk/contracts";
import {
  type DbClient,
  createOutboundMessageWithOutbox,
  getConversationById,
  listConversations,
  listMessagesByConversation,
  OptimisticConcurrencyError,
  ClosedConversationError,
  ConversationAccessRevokedError,
  ConversationActionError,
  performConversationOperation,
  runInTenantTransaction,
  updateConversation
} from "@flowdesk/db";
import { type Permission } from "@flowdesk/domain";
import { type Request, type Response, Router } from "express";
import { createRequireAuthMiddleware } from "./auth.js";
import { createIdempotencyMiddleware } from "./idempotency.js";
import { createRequireOrgPermissionMiddleware } from "./organizations.js";

export interface ConversationsRouterOptions {
  db: DbClient;
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

function serializeConversation(conv: {
  id: string;
  organizationId: string;
  channelId: string;
  customerPhone: string;
  customerName: string | null;
  status: string;
  priority: string;
  assignedToUserId: string | null;
  queueId?: string | null;
  teamId?: string | null;
  waitingReason?: string | null;
  botPaused?: boolean;
  firstResponseDueAt?: Date | null;
  resolutionDueAt?: Date | null;
  resolvedAt?: Date | null;
  firstRespondedAt?: Date | null;
  slaPausedAt?: Date | null;
  firstResponseRemainingSeconds?: number | null;
  resolutionRemainingSeconds?: number | null;
  version: number;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}) {
  return ConversationSchema.parse({
    id: conv.id,
    organizationId: conv.organizationId,
    channelId: conv.channelId,
    customerPhone: conv.customerPhone,
    customerName: conv.customerName,
    status: conv.status,
    priority: conv.priority,
    assignedToUserId: conv.assignedToUserId,
    queueId: conv.queueId ?? null,
    teamId: conv.teamId ?? null,
    waitingReason: conv.waitingReason ?? null,
    botPaused: conv.botPaused ?? false,
    firstResponseDueAt: conv.firstResponseDueAt?.toISOString() ?? null,
    resolutionDueAt: conv.resolutionDueAt?.toISOString() ?? null,
    resolvedAt: conv.resolvedAt?.toISOString() ?? null,
    firstRespondedAt: conv.firstRespondedAt?.toISOString() ?? null,
    slaPausedAt: conv.slaPausedAt?.toISOString() ?? null,
    firstResponseRemainingSeconds: conv.firstResponseRemainingSeconds ?? null,
    resolutionRemainingSeconds: conv.resolutionRemainingSeconds ?? null,
    version: conv.version,
    lastMessageAt: conv.lastMessageAt.toISOString(),
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString()
  });
}

function serializeMessage(msg: {
  id: string;
  organizationId: string;
  conversationId: string;
  channelId: string;
  direction: string;
  senderType: string;
  senderUserId: string | null;
  providerMessageId: string | null;
  content: string;
  status: string;
  errorDetail: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return MessageSchema.parse({
    id: msg.id,
    organizationId: msg.organizationId,
    conversationId: msg.conversationId,
    channelId: msg.channelId,
    direction: msg.direction,
    senderType: msg.senderType,
    senderUserId: msg.senderUserId,
    providerMessageId: msg.providerMessageId,
    content: msg.content,
    status: msg.status,
    errorDetail: msg.errorDetail,
    sentAt: msg.sentAt ? msg.sentAt.toISOString() : null,
    deliveredAt: msg.deliveredAt ? msg.deliveredAt.toISOString() : null,
    readAt: msg.readAt ? msg.readAt.toISOString() : null,
    createdAt: msg.createdAt.toISOString(),
    updatedAt: msg.updatedAt.toISOString()
  });
}

export function createConversationsRouter(options: ConversationsRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const requireAuth = createRequireAuthMiddleware(options.db);
  const requireIdempotency = createIdempotencyMiddleware(options.db);
  router.use(requireAuth);

  // 1. GET /api/v1/organizations/:orgId/conversations
  router.get(
    "/",
    createRequireOrgPermissionMiddleware(options.db, "conversation:read"),
    async (request: Request, response: Response) => {
      const orgId = request.params["orgId"] as string;
      const parseResult = ListConversationsQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return sendProblem(
          response,
          400,
          "VALIDATION_ERROR",
          "Invalid query parameters",
          parseResult.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")
        );
      }

      const { status, assignedTo, cursor, limit } = parseResult.data;

      let assignedToUserId: string | null | undefined;
      if (assignedTo === "me") {
        assignedToUserId = request.user?.id;
      } else if (assignedTo === "unassigned") {
        assignedToUserId = null;
      } else if (assignedTo) {
        assignedToUserId = assignedTo;
      }

      const result = await runInTenantTransaction(options.db, { organizationId: orgId }, (db) =>
        listConversations(db, {
          organizationId: orgId,
          status,
          assignedToUserId,
          cursor,
          limit
        })
      );

      const payload = ListConversationsResponseSchema.parse({
        items: result.items.map(serializeConversation),
        nextCursor: result.nextCursor
      });

      return response.status(200).json(payload);
    }
  );

  // Tenant-scoped invalidation stream. PostgreSQL remains the source of truth;
  // the browser receives no message payload here and reloads through the same
  // RBAC-protected REST endpoints when the tenant projection changes.
  router.get(
    "/events",
    createRequireOrgPermissionMiddleware(options.db, "conversation:read"),
    (request: Request, response: Response) => {
      const orgId = request.params["orgId"] as string;
      response.status(200);
      response.setHeader("Content-Type", "text/event-stream");
      response.setHeader("Cache-Control", "no-cache, no-transform");
      response.setHeader("Connection", "keep-alive");
      response.flushHeaders();

      let lastVersion: string | null = null;
      let closed = false;
      let ticking = false;

      const poll = async () => {
        if (closed || ticking) return;
        ticking = true;
        try {
          const result = await runInTenantTransaction(options.db, { organizationId: orgId }, (db) =>
            db.query<{ version: string }>(
              `SELECT GREATEST(
                   COALESCE((SELECT max(updated_at) FROM flowdesk.conversations
                     WHERE organization_id = $1), '-infinity'::timestamptz),
                   COALESCE((SELECT max(updated_at) FROM flowdesk.messages
                     WHERE organization_id = $1), '-infinity'::timestamptz)
                 )::text AS version`,
              [orgId]
            )
          );
          const version = result.rows[0]?.version ?? "-infinity";
          if (lastVersion === null) {
            response.write(`event: ready\ndata: ${JSON.stringify({ version })}\n\n`);
          } else if (version !== lastVersion) {
            response.write(`event: conversation.changed\ndata: ${JSON.stringify({ version })}\n\n`);
          } else {
            response.write(": heartbeat\n\n");
          }
          lastVersion = version;
        } catch {
          response.write("event: stream.error\ndata: {}\n\n");
        } finally {
          ticking = false;
        }
      };

      void poll();
      const timer = setInterval(() => void poll(), 2_000);
      request.once("close", () => {
        closed = true;
        clearInterval(timer);
      });
    }
  );

  router.post(
    "/:id/actions",
    (request: Request, response: Response, next) => {
      const parsed = ConversationOperationRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendProblem(
          response,
          400,
          "VALIDATION_ERROR",
          "Invalid conversation operation",
          parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ")
        );
      }
      const elevatedActions = new Set(["handoff", "priority"]);
      const permission: Permission = elevatedActions.has(parsed.data.action)
        ? "conversation:assign"
        : parsed.data.action === "resolve"
          ? "conversation:resolve"
          : "conversation:read";
      return createRequireOrgPermissionMiddleware(options.db, permission)(request, response, next);
    },
    async (request: Request, response: Response) => {
      const organizationId = request.params["orgId"] as string;
      const conversationId = request.params["id"] as string;
      const { version, ...operation } = ConversationOperationRequestSchema.parse(request.body);
      try {
        const conversation = await runInTenantTransaction(options.db, { organizationId }, (db) =>
          performConversationOperation(db, {
            organizationId,
            conversationId,
            actorUserId: request.user!.id,
            expectedVersion: version,
            correlationId: response.getHeader("x-request-id")?.toString() ?? null,
            operation
          })
        );
        return response.status(200).json(serializeConversation(conversation));
      } catch (error: unknown) {
        if (error instanceof OptimisticConcurrencyError) {
          return sendProblem(
            response,
            409,
            "OPTIMISTIC_CONCURRENCY_CONFLICT",
            "Version Conflict",
            "The conversation has changed. Refresh and retry the operation."
          );
        }
        if (error instanceof ConversationAccessRevokedError) {
          return sendProblem(
            response,
            403,
            "CONVERSATION_ACCESS_REVOKED",
            "Conversation Access Revoked",
            error.message
          );
        }
        if (error instanceof ConversationActionError) {
          return sendProblem(
            response,
            409,
            "CONVERSATION_ACTION_CONFLICT",
            "Action Conflict",
            error.message
          );
        }
        if (
          error instanceof Error &&
          error.message.includes("Invalid conversation status transition")
        ) {
          return sendProblem(
            response,
            409,
            "INVALID_STATUS_TRANSITION",
            "Invalid Status Transition",
            error.message
          );
        }
        throw error;
      }
    }
  );

  // 2. GET /api/v1/organizations/:orgId/conversations/:id
  router.get(
    "/:id",
    createRequireOrgPermissionMiddleware(options.db, "conversation:read"),
    async (request: Request, response: Response) => {
      const orgId = request.params["orgId"] as string;
      const id = request.params["id"] as string;

      const detail = await runInTenantTransaction(
        options.db,
        { organizationId: orgId },
        async (db) => {
          const conversation = await getConversationById(db, orgId, id);
          if (!conversation) return null;
          const messages = await listMessagesByConversation(db, orgId, id, 100);
          return { conversation, messages };
        }
      );
      const conversation = detail?.conversation;
      if (!conversation) {
        return sendProblem(
          response,
          404,
          "CONVERSATION_NOT_FOUND",
          "Conversation Not Found",
          `Conversation '${id}' was not found in this organization.`
        );
      }

      const payload = ConversationDetailResponseSchema.parse({
        conversation: serializeConversation(conversation),
        messages: detail.messages.map(serializeMessage)
      });

      return response.status(200).json(payload);
    }
  );

  // 3. PATCH /api/v1/organizations/:orgId/conversations/:id
  router.patch(
    "/:id",
    (request: Request, response: Response, next) => {
      // Dynamic permission checking based on request body
      const parseResult = UpdateConversationRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return sendProblem(
          response,
          400,
          "VALIDATION_ERROR",
          "Invalid request body",
          parseResult.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")
        );
      }

      let requiredPermission: Permission = "conversation:read";
      if (parseResult.data.status === "resolved" || parseResult.data.status === "closed") {
        requiredPermission = "conversation:resolve";
      } else if (parseResult.data.assignedToUserId !== undefined) {
        requiredPermission = "conversation:assign";
      }

      // Run org permission check
      const permMiddleware = createRequireOrgPermissionMiddleware(options.db, requiredPermission);
      return permMiddleware(request, response, next);
    },
    async (request: Request, response: Response) => {
      const orgId = request.params["orgId"] as string;
      const id = request.params["id"] as string;
      const data = UpdateConversationRequestSchema.parse(request.body);

      try {
        const updated = await runInTenantTransaction(options.db, { organizationId: orgId }, (db) =>
          updateConversation(db, {
            organizationId: orgId,
            id,
            expectedVersion: data.version,
            status: data.status,
            assignedToUserId: data.assignedToUserId
          })
        );

        return response.status(200).json(serializeConversation(updated));
      } catch (err: unknown) {
        if (err instanceof OptimisticConcurrencyError) {
          return sendProblem(
            response,
            409,
            "OPTIMISTIC_CONCURRENCY_CONFLICT",
            "Version Conflict",
            "The conversation has been modified by another operator. Please refresh and retry."
          );
        }

        if (
          err instanceof Error &&
          err.message.includes("Invalid conversation status transition")
        ) {
          return sendProblem(
            response,
            400,
            "INVALID_STATUS_TRANSITION",
            "Invalid Status Transition",
            err.message
          );
        }

        if (err instanceof Error && err.message.includes("not found")) {
          return sendProblem(
            response,
            404,
            "CONVERSATION_NOT_FOUND",
            "Conversation Not Found",
            `Conversation '${id}' was not found in this organization.`
          );
        }

        throw err;
      }
    }
  );

  // 4. POST /api/v1/organizations/:orgId/conversations/:id/messages
  router.post(
    "/:id/messages",
    createRequireOrgPermissionMiddleware(options.db, "message:send"),
    requireIdempotency,
    async (request: Request, response: Response) => {
      const orgId = request.params["orgId"] as string;
      const id = request.params["id"] as string;

      const parseResult = CreateOutboundMessageRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return sendProblem(
          response,
          400,
          "VALIDATION_ERROR",
          "Invalid message content",
          parseResult.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")
        );
      }

      const idempotencyKey =
        request.header("idempotency-key")?.trim() ?? request.header("x-idempotency-key")?.trim();
      if (!idempotencyKey) {
        return sendProblem(
          response,
          400,
          "IDEMPOTENCY_KEY_REQUIRED",
          "Idempotency Key Required",
          "Idempotency-Key header is required when sending an outbound message."
        );
      }

      let message;
      try {
        message = await runInTenantTransaction(
          options.db,
          { organizationId: orgId },
          async (db) => {
            const conversation = await getConversationById(db, orgId, id);
            if (!conversation) return null;
            return createOutboundMessageWithOutbox(db, {
              organizationId: orgId,
              conversationId: id,
              senderUserId: request.user!.id,
              content: parseResult.data.content,
              correlationId: response.getHeader("x-request-id")?.toString()
            });
          }
        );
      } catch (error: unknown) {
        if (error instanceof ClosedConversationError) {
          return sendProblem(
            response,
            409,
            "CONVERSATION_CLOSED",
            "Conversation Closed",
            error.message
          );
        }
        throw error;
      }
      if (!message) {
        return sendProblem(
          response,
          404,
          "CONVERSATION_NOT_FOUND",
          "Conversation Not Found",
          `Conversation '${id}' was not found in this organization.`
        );
      }

      return response.status(201).json(serializeMessage(message));
    }
  );

  return router;
}
