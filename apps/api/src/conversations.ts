import {
  type Problem,
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
  updateConversation
} from "@flowdesk/db";
import { type Permission } from "@flowdesk/domain";
import { type Request, type Response, Router } from "express";
import { createRequireAuthMiddleware } from "./auth.js";
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

      const result = await listConversations(options.db, {
        organizationId: orgId,
        status,
        assignedToUserId,
        cursor,
        limit
      });

      const payload = ListConversationsResponseSchema.parse({
        items: result.items.map(serializeConversation),
        nextCursor: result.nextCursor
      });

      return response.status(200).json(payload);
    }
  );

  // 2. GET /api/v1/organizations/:orgId/conversations/:id
  router.get(
    "/:id",
    createRequireOrgPermissionMiddleware(options.db, "conversation:read"),
    async (request: Request, response: Response) => {
      const orgId = request.params["orgId"] as string;
      const id = request.params["id"] as string;

      const conversation = await getConversationById(options.db, orgId, id);
      if (!conversation) {
        return sendProblem(
          response,
          404,
          "CONVERSATION_NOT_FOUND",
          "Conversation Not Found",
          `Conversation '${id}' was not found in this organization.`
        );
      }

      const messages = await listMessagesByConversation(options.db, orgId, id, 100);

      const payload = ConversationDetailResponseSchema.parse({
        conversation: serializeConversation(conversation),
        messages: messages.map(serializeMessage)
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
        const updated = await updateConversation(options.db, {
          organizationId: orgId,
          id,
          expectedVersion: data.version,
          status: data.status,
          assignedToUserId: data.assignedToUserId
        });

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

      const conversation = await getConversationById(options.db, orgId, id);
      if (!conversation) {
        return sendProblem(
          response,
          404,
          "CONVERSATION_NOT_FOUND",
          "Conversation Not Found",
          `Conversation '${id}' was not found in this organization.`
        );
      }

      const message = await createOutboundMessageWithOutbox(options.db, {
        organizationId: orgId,
        conversationId: id,
        senderUserId: request.user!.id,
        content: parseResult.data.content,
        correlationId: response.getHeader("x-request-id")?.toString()
      });

      return response.status(201).json(serializeMessage(message));
    }
  );

  return router;
}
