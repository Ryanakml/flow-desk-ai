import { randomBytes } from "node:crypto";
import { type Request, type Response, Router } from "express";
import {
  type DbClient,
  listApiKeys,
  createApiKey,
  revokeApiKey,
  listWebhookSubscriptions,
  createWebhookSubscription,
  deleteWebhookSubscription,
  recordAuditEvent
} from "@flowdesk/db";
import { generateApiKey } from "@flowdesk/security";

import { createRequireAuthMiddleware } from "./auth.js";
import { createRequireOrgPermissionMiddleware } from "./organizations.js";

export interface DeveloperRouterOptions {
  db: DbClient;
}

function getParam(params: Record<string, string | string[] | undefined>, key: string): string {
  const val = params[key];
  if (typeof val === "string") return val;
  if (Array.isArray(val) && typeof val[0] === "string") return val[0];
  return "";
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

export function createDeveloperRouter(options: DeveloperRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const requireAuth = createRequireAuthMiddleware(options.db);
  const requireWritePermission = createRequireOrgPermissionMiddleware(
    options.db,
    "automation:publish"
  );

  // GET /api/v1/organizations/:orgId/developer/api-keys
  router.get("/api-keys", requireAuth, async (request: Request, response: Response) => {
    try {
      const orgId = getParam(request.params, "orgId");
      const keys = await listApiKeys(options.db, orgId);

      return response.status(200).json(
        keys.map((k) => ({
          id: k.id,
          organizationId: k.organizationId,
          name: k.name,
          keyPrefix: k.keyPrefix,
          scopes: k.scopes,
          createdByUserId: k.createdByUserId,
          expiresAt: k.expiresAt,
          revokedAt: k.revokedAt,
          createdAt: k.createdAt
        }))
      );
    } catch (err) {
      return sendProblem(
        response,
        500,
        "INTERNAL_ERROR",
        "Failed to list API keys",
        err instanceof Error ? err.message : "Internal error"
      );
    }
  });

  // POST /api/v1/organizations/:orgId/developer/api-keys
  router.post(
    "/api-keys",
    requireAuth,
    requireWritePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const body = (
          request.body && typeof request.body === "object" ? request.body : {}
        ) as Record<string, unknown>;

        const nameVal: unknown = body["name"];
        const name = typeof nameVal === "string" ? nameVal.trim() : "";
        const scopesVal: unknown = body["scopes"];
        const scopes = Array.isArray(scopesVal)
          ? scopesVal.filter((s): s is string => typeof s === "string")
          : ["*"];

        if (!name) {
          return sendProblem(
            response,
            400,
            "BAD_REQUEST",
            "Invalid API key input",
            "Missing required field: name"
          );
        }

        const generated = generateApiKey("fd_live_");
        const record = await createApiKey(options.db, {
          organizationId: orgId,
          name,
          keyPrefix: generated.keyPrefix,
          keyHash: generated.keyHash,
          scopes,
          createdByUserId: request.user?.id ?? null
        });

        await recordAuditEvent(options.db, {
          organizationId: orgId,
          actorUserId: request.user?.id ?? "unknown",
          action: "api_key.created",
          targetType: "api_key",
          targetId: record.id,
          result: "allowed",
          metadata: { name, keyPrefix: generated.keyPrefix, scopes }
        });

        return response.status(201).json({
          id: record.id,
          organizationId: record.organizationId,
          name: record.name,
          keyPrefix: record.keyPrefix,
          rawKey: generated.rawKey,
          scopes: record.scopes,
          createdAt: record.createdAt
        });
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Failed to create API key",
          err instanceof Error ? err.message : "Internal error"
        );
      }
    }
  );

  // DELETE /api/v1/organizations/:orgId/developer/api-keys/:keyId
  router.delete(
    "/api-keys/:keyId",
    requireAuth,
    requireWritePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const keyId = getParam(request.params, "keyId");

        const revoked = await revokeApiKey(options.db, keyId, orgId);
        if (!revoked) {
          return sendProblem(
            response,
            404,
            "NOT_FOUND",
            "API Key not found or already revoked",
            "API key does not exist or was previously revoked"
          );
        }

        await recordAuditEvent(options.db, {
          organizationId: orgId,
          actorUserId: request.user?.id ?? "unknown",
          action: "api_key.revoked",
          targetType: "api_key",
          targetId: keyId,
          result: "allowed",
          metadata: {}
        });

        return response.status(200).json({ success: true, keyId });
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Failed to revoke API key",
          err instanceof Error ? err.message : "Internal error"
        );
      }
    }
  );

  // GET /api/v1/organizations/:orgId/developer/webhooks
  router.get("/webhooks", requireAuth, async (request: Request, response: Response) => {
    try {
      const orgId = getParam(request.params, "orgId");
      const subs = await listWebhookSubscriptions(options.db, orgId);
      return response.status(200).json(subs);
    } catch (err) {
      return sendProblem(
        response,
        500,
        "INTERNAL_ERROR",
        "Failed to list webhook subscriptions",
        err instanceof Error ? err.message : "Internal error"
      );
    }
  });

  // POST /api/v1/organizations/:orgId/developer/webhooks
  router.post(
    "/webhooks",
    requireAuth,
    requireWritePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const body = (
          request.body && typeof request.body === "object" ? request.body : {}
        ) as Record<string, unknown>;

        const nameVal: unknown = body["name"];
        const urlVal: unknown = body["url"];
        const eventsVal: unknown = body["events"];

        const name = typeof nameVal === "string" ? nameVal.trim() : "";
        const url = typeof urlVal === "string" ? urlVal.trim() : "";
        const events: string[] = Array.isArray(eventsVal)
          ? eventsVal.filter((e): e is string => typeof e === "string")
          : ["*"];

        if (!name || !url || !url.startsWith("http")) {
          return sendProblem(
            response,
            400,
            "BAD_REQUEST",
            "Invalid Webhook Subscription input",
            "Missing or invalid required fields: name, url (must start with http)"
          );
        }

        const secret = `whsec_${randomBytes(16).toString("hex")}`;
        const sub = await createWebhookSubscription(options.db, {
          organizationId: orgId,
          name,
          url,
          secret,
          events
        });

        await recordAuditEvent(options.db, {
          organizationId: orgId,
          actorUserId: request.user?.id ?? "unknown",
          action: "webhook_subscription.created",
          targetType: "webhook_subscription",
          targetId: sub.id,
          result: "allowed",
          metadata: { name, url, events }
        });

        return response.status(201).json(sub);
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Failed to create webhook subscription",
          err instanceof Error ? err.message : "Internal error"
        );
      }
    }
  );

  // DELETE /api/v1/organizations/:orgId/developer/webhooks/:webhookId
  router.delete(
    "/webhooks/:webhookId",
    requireAuth,
    requireWritePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const webhookId = getParam(request.params, "webhookId");

        const deleted = await deleteWebhookSubscription(options.db, webhookId, orgId);
        if (!deleted) {
          return sendProblem(
            response,
            404,
            "NOT_FOUND",
            "Webhook subscription not found",
            "Subscription does not exist"
          );
        }

        await recordAuditEvent(options.db, {
          organizationId: orgId,
          actorUserId: request.user?.id ?? "unknown",
          action: "webhook_subscription.deleted",
          targetType: "webhook_subscription",
          targetId: webhookId,
          result: "allowed",
          metadata: {}
        });

        return response.status(200).json({ success: true, webhookId });
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Failed to delete webhook subscription",
          err instanceof Error ? err.message : "Internal error"
        );
      }
    }
  );

  return router;
}
