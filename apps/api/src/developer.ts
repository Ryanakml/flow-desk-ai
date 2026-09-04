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
  getWebhookSubscriptionById,
  listWebhookDeliveries,
  recordAuditEvent,
  runInTenantTransaction
} from "@flowdesk/db";
import { generateApiKey, encryptWebhookSecret, validateWebhookUrl } from "@flowdesk/security";

import { createRequireAuthMiddleware } from "./auth.js";
import { createRequireOrgPermissionMiddleware } from "./organizations.js";

export interface DeveloperRouterOptions {
  db: DbClient;
  encryptionKey?: string;
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
  router.get(
    "/api-keys",
    requireAuth,
    requireWritePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const keys = await runInTenantTransaction(options.db, { organizationId: orgId }, (db) =>
          listApiKeys(db, orgId)
        );

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
    }
  );

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
        const record = await runInTenantTransaction(
          options.db,
          { organizationId: orgId },
          async (db) => {
            const record = await createApiKey(db, {
              organizationId: orgId,
              name,
              keyPrefix: generated.keyPrefix,
              keyHash: generated.keyHash,
              scopes,
              createdByUserId: request.user?.id ?? null
            });

            await recordAuditEvent(db, {
              organizationId: orgId,
              actorUserId: request.user?.id ?? "unknown",
              action: "api_key.created",
              targetType: "api_key",
              targetId: record.id,
              result: "allowed",
              metadata: { name, keyPrefix: generated.keyPrefix, scopes }
            });

            return record;
          }
        );

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

        const revoked = await runInTenantTransaction(
          options.db,
          { organizationId: orgId },
          async (db) => {
            const revoked = await revokeApiKey(db, keyId, orgId);
            if (revoked) {
              await recordAuditEvent(db, {
                organizationId: orgId,
                actorUserId: request.user?.id ?? "unknown",
                action: "api_key.revoked",
                targetType: "api_key",
                targetId: keyId,
                result: "allowed",
                metadata: {}
              });
            }
            return revoked;
          }
        );
        if (!revoked) {
          return sendProblem(
            response,
            404,
            "NOT_FOUND",
            "API Key not found or already revoked",
            "API key does not exist or was previously revoked"
          );
        }

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
  router.get(
    "/webhooks",
    requireAuth,
    requireWritePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const subs = await runInTenantTransaction(options.db, { organizationId: orgId }, (db) =>
          listWebhookSubscriptions(db, orgId)
        );
        return response.status(200).json(
          subs.map((s) => ({
            id: s.id,
            organizationId: s.organizationId,
            name: s.name,
            url: s.url,
            secret: "whsec_****************",
            events: s.events,
            isActive: s.isActive,
            verificationStatus: s.verificationStatus,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt
          }))
        );
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Failed to list webhook subscriptions",
          err instanceof Error ? err.message : "Internal error"
        );
      }
    }
  );

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

        if (!name || !url) {
          return sendProblem(
            response,
            400,
            "BAD_REQUEST",
            "Invalid Webhook Subscription input",
            "Missing required fields: name, url"
          );
        }

        try {
          await validateWebhookUrl(url);
        } catch (ssrfErr) {
          return sendProblem(
            response,
            400,
            "BAD_REQUEST",
            "Invalid Webhook URL",
            ssrfErr instanceof Error ? ssrfErr.message : "SSRF validation failed for target URL"
          );
        }

        const rawSecret = `whsec_${randomBytes(16).toString("hex")}`;
        const encryptionKey =
          options.encryptionKey ??
          process.env["ENCRYPTION_KEY"] ??
          "flowdesk-local-dev-encryption-key-32b";
        const encryptedSecret = encryptWebhookSecret(rawSecret, encryptionKey);

        const sub = await runInTenantTransaction(
          options.db,
          { organizationId: orgId },
          async (db) => {
            const sub = await createWebhookSubscription(db, {
              organizationId: orgId,
              name,
              url,
              secret: encryptedSecret,
              events,
              verificationStatus: "unverified"
            });

            await recordAuditEvent(db, {
              organizationId: orgId,
              actorUserId: request.user?.id ?? "unknown",
              action: "webhook_subscription.created",
              targetType: "webhook_subscription",
              targetId: sub.id,
              result: "allowed",
              metadata: { name, url, events }
            });

            return sub;
          }
        );

        return response.status(201).json({
          ...sub,
          secret: rawSecret
        });
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

  // POST /api/v1/organizations/:orgId/developer/webhooks/:webhookId/test
  router.post(
    "/webhooks/:webhookId/test",
    requireAuth,
    requireWritePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const webhookId = getParam(request.params, "webhookId");

        const result = await runInTenantTransaction(
          options.db,
          { organizationId: orgId },
          async (db) => {
            const sub = await getWebhookSubscriptionById(db, webhookId, orgId);
            if (!sub) return null;

            const testEventId = `evt_test_${randomBytes(8).toString("hex")}`;
            const testPayload = {
              event: "endpoint.test",
              timestamp: new Date().toISOString(),
              organizationId: orgId,
              subscriptionId: webhookId,
              message: "FlowDesk developer webhook test ping"
            };

            await db.query(
              `INSERT INTO flowdesk.outbox_events
               (organization_id, aggregate_type, aggregate_id, event_type, schema_version, payload)
               VALUES ($1, 'webhook_subscription', $2, 'developer.webhook.dispatch', 1, $3::jsonb)`,
              [
                orgId,
                webhookId,
                JSON.stringify({
                  subscriptionId: webhookId,
                  eventId: testEventId,
                  eventType: "endpoint.test",
                  payload: testPayload
                })
              ]
            );

            await recordAuditEvent(db, {
              organizationId: orgId,
              actorUserId: request.user?.id ?? "unknown",
              action: "webhook_subscription.tested",
              targetType: "webhook_subscription",
              targetId: webhookId,
              result: "allowed",
              metadata: { eventId: testEventId }
            });

            return { enqueued: true, eventId: testEventId };
          }
        );

        if (!result) {
          return sendProblem(
            response,
            404,
            "NOT_FOUND",
            "Webhook subscription not found",
            "Subscription does not exist"
          );
        }

        return response.status(200).json(result);
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Failed to dispatch test webhook",
          err instanceof Error ? err.message : "Internal error"
        );
      }
    }
  );

  // GET /api/v1/organizations/:orgId/developer/webhooks/:webhookId/deliveries
  router.get(
    "/webhooks/:webhookId/deliveries",
    requireAuth,
    requireWritePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const webhookId = getParam(request.params, "webhookId");

        const deliveries = await runInTenantTransaction(
          options.db,
          { organizationId: orgId },
          (db) => listWebhookDeliveries(db, orgId, webhookId)
        );

        return response.status(200).json(deliveries);
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Failed to list webhook deliveries",
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

        const deleted = await runInTenantTransaction(
          options.db,
          { organizationId: orgId },
          async (db) => {
            const deleted = await deleteWebhookSubscription(db, webhookId, orgId);
            if (deleted) {
              await recordAuditEvent(db, {
                organizationId: orgId,
                actorUserId: request.user?.id ?? "unknown",
                action: "webhook_subscription.deleted",
                targetType: "webhook_subscription",
                targetId: webhookId,
                result: "allowed",
                metadata: {}
              });
            }
            return deleted;
          }
        );
        if (!deleted) {
          return sendProblem(
            response,
            404,
            "NOT_FOUND",
            "Webhook subscription not found",
            "Subscription does not exist"
          );
        }

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
