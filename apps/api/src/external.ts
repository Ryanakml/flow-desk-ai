import { Router, type Request, type Response, type RequestHandler } from "express";
import {
  type DbClient,
  type ApiKeyRecord,
  findApiKeyByHash,
  listConversations,
  getConversationById,
  createOutboundMessageWithOutbox,
  runInTenantTransaction
} from "@flowdesk/db";
import { computeSha256, hasRequiredScope } from "@flowdesk/security";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: ApiKeyRecord;
    }
  }
}

export interface ExternalApiRouterOptions {
  db: DbClient;
}

function sendProblem(
  response: Response,
  status: number,
  title: string,
  detail: string,
  instance?: string
): Response {
  return response.status(status).json({
    type: `https://flowdesk.dev/errors/${status}`,
    title,
    status,
    detail,
    instance: instance ?? undefined
  });
}

export function createRequireApiKeyAuthMiddleware(
  db: DbClient,
  requiredScope?: string
): RequestHandler {
  return async (request: Request, response: Response, next) => {
    const authHeader = request.header("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return sendProblem(
        response,
        401,
        "UNAUTHORIZED",
        "Missing or malformed Authorization header. Expected Bearer <api_key>"
      );
    }

    const rawKey = authHeader.slice(7).trim();
    if (!rawKey.startsWith("fd_live_")) {
      return sendProblem(response, 401, "UNAUTHORIZED", "Invalid API key format");
    }

    const keyHash = computeSha256(rawKey);
    try {
      const apiKey = await findApiKeyByHash(db, keyHash);
      if (!apiKey) {
        return sendProblem(response, 401, "UNAUTHORIZED", "Invalid, expired, or revoked API key");
      }

      if (requiredScope && !hasRequiredScope(apiKey.scopes, requiredScope)) {
        return sendProblem(
          response,
          403,
          "FORBIDDEN",
          `API key lacks required scope: ${requiredScope}`
        );
      }

      request.apiKey = apiKey;
      next();
    } catch (err) {
      return sendProblem(
        response,
        500,
        "INTERNAL_ERROR",
        "Failed to authenticate API key",
        err instanceof Error ? err.message : "Internal error"
      );
    }
  };
}

export function createExternalApiRouter(options: ExternalApiRouterOptions): Router {
  const router = Router();

  // GET /api/v1/external/conversations
  router.get(
    "/conversations",
    createRequireApiKeyAuthMiddleware(options.db, "conversation:read"),
    async (request: Request, response: Response) => {
      const apiKey = request.apiKey!;
      try {
        const result = await runInTenantTransaction(
          options.db,
          { organizationId: apiKey.organizationId },
          (db) => listConversations(db, { organizationId: apiKey.organizationId, limit: 50 })
        );

        return response.status(200).json(result);
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Failed to list conversations",
          err instanceof Error ? err.message : "Internal error"
        );
      }
    }
  );

  // GET /api/v1/external/conversations/:id
  router.get(
    "/conversations/:id",
    createRequireApiKeyAuthMiddleware(options.db, "conversation:read"),
    async (request: Request, response: Response) => {
      const apiKey = request.apiKey!;
      const convId = request.params["id"] as string;

      try {
        const conv = await runInTenantTransaction(
          options.db,
          { organizationId: apiKey.organizationId },
          (db) => getConversationById(db, apiKey.organizationId, convId)
        );

        if (!conv) {
          return sendProblem(
            response,
            404,
            "NOT_FOUND",
            "Conversation not found",
            `Conversation '${convId}' does not exist in this organization`
          );
        }

        return response.status(200).json(conv);
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Failed to get conversation",
          err instanceof Error ? err.message : "Internal error"
        );
      }
    }
  );

  // POST /api/v1/external/conversations/:id/messages
  router.post(
    "/conversations/:id/messages",
    createRequireApiKeyAuthMiddleware(options.db, "message:write"),
    async (request: Request, response: Response) => {
      const apiKey = request.apiKey!;
      const convId = request.params["id"] as string;
      const body = (request.body && typeof request.body === "object" ? request.body : {}) as Record<
        string,
        unknown
      >;

      const content = typeof body["content"] === "string" ? body["content"].trim() : "";
      if (!content) {
        return sendProblem(
          response,
          400,
          "BAD_REQUEST",
          "Missing message content",
          "Content field is required and cannot be empty"
        );
      }

      try {
        const message = await runInTenantTransaction(
          options.db,
          { organizationId: apiKey.organizationId },
          async (db) => {
            const conv = await getConversationById(db, apiKey.organizationId, convId);
            if (!conv) {
              return null;
            }

            return createOutboundMessageWithOutbox(db, {
              organizationId: apiKey.organizationId,
              conversationId: conv.id,
              senderType: "agent",
              senderUserId: apiKey.createdByUserId,
              content,
              correlationId: request.header("x-correlation-id") ?? undefined
            });
          }
        );

        if (!message) {
          return sendProblem(
            response,
            404,
            "NOT_FOUND",
            "Conversation not found",
            `Conversation '${convId}' does not exist in this organization`
          );
        }

        return response.status(201).json(message);
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Failed to create outbound message",
          err instanceof Error ? err.message : "Internal error"
        );
      }
    }
  );

  return router;
}
