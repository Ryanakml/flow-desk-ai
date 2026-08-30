import { Router, type Request, type Response } from "express";
import { type ChannelStatus } from "@flowdesk/domain";
import {
  createChannel,
  getChannelById,
  listChannels,
  updateChannelStatus,
  deleteChannel,
  recordAuditEvent,
  runInTenantTransaction,
  type DbClient
} from "@flowdesk/db";
import { encryptSecret, decryptSecret } from "@flowdesk/security";
import { createRequireAuthMiddleware } from "./auth.js";
import { createRequireOrgPermissionMiddleware } from "./organizations.js";

export interface ChannelsRouterOptions {
  db: DbClient;
  encryptionKey?: string;
}

function getEncryptionKey(options: ChannelsRouterOptions): string {
  if (options.encryptionKey) return options.encryptionKey;
  const envKey = process.env["ENCRYPTION_KEY"];
  if (typeof envKey === "string" && envKey.length > 0) return envKey;
  return "dev-encryption-key-32-bytes-long!!";
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
  return response
    .status(status)
    .type("application/problem+json")
    .json({
      type: `https://flowdesk.dev/problems/${code.toLowerCase().replaceAll("_", "-")}`,
      title,
      status,
      code,
      detail,
      requestId: response.getHeader("x-request-id")?.toString() ?? "unknown"
    });
}

export function createChannelsRouter(options: ChannelsRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const requireAuth = createRequireAuthMiddleware(options.db);
  const requireReadPermission = createRequireOrgPermissionMiddleware(
    options.db,
    "conversation:read"
  );
  const requireWritePermission = createRequireOrgPermissionMiddleware(
    options.db,
    "automation:publish"
  );

  // GET /api/v1/organizations/:orgId/channels
  router.get(
    "/",
    requireAuth,
    requireReadPermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const channels = await listChannels(options.db, orgId);

        const sanitized = channels.map((c) => ({
          id: c.id,
          organizationId: c.organizationId,
          type: c.type,
          name: c.name,
          phoneNumberId: c.phoneNumberId,
          wabaId: c.wabaId,
          status: c.status,
          statusReason: c.statusReason,
          metadata: c.metadata,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt
        }));

        return response.status(200).json(sanitized);
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Failed to list channels",
          err instanceof Error ? err.message : "Internal error"
        );
      }
    }
  );

  // POST /api/v1/organizations/:orgId/channels
  router.post(
    "/",
    requireAuth,
    requireWritePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const { name, phoneNumberId, wabaId, accessToken } = request.body as {
          name?: string;
          phoneNumberId?: string;
          wabaId?: string;
          accessToken?: string;
        };

        if (!name || !phoneNumberId || !wabaId || !accessToken) {
          return sendProblem(
            response,
            400,
            "BAD_REQUEST",
            "Invalid channel input",
            "Missing required fields: name, phoneNumberId, wabaId, accessToken"
          );
        }

        const encryptionKey = getEncryptionKey(options);

        const encrypted = encryptSecret(
          JSON.stringify({ accessToken, phoneNumberId, wabaId }),
          encryptionKey
        );

        // Authentication and organization permission middleware have completed
        // before this handler runs. Establish a fresh transaction-scoped tenant
        // context for the write itself so pooled connections cannot leak or omit
        // app.organization_id and the runtime role remains subject to RLS.
        const channel = await runInTenantTransaction(
          options.db,
          { organizationId: orgId },
          async (db) => {
            const created = await createChannel(db, {
              organizationId: orgId,
              type: "whatsapp",
              name,
              phoneNumberId,
              wabaId,
              encryptedCredentials: JSON.stringify(encrypted),
              status: "active"
            });

            await recordAuditEvent(db, {
              organizationId: orgId,
              actorUserId: request.user?.id ?? "unknown",
              action: "channel.created",
              targetType: "channel",
              targetId: created.id,
              result: "allowed",
              metadata: { name, phoneNumberId, wabaId }
            });

            return created;
          }
        );

        return response.status(201).json({
          id: channel.id,
          organizationId: channel.organizationId,
          type: channel.type,
          name: channel.name,
          phoneNumberId: channel.phoneNumberId,
          wabaId: channel.wabaId,
          status: channel.status,
          createdAt: channel.createdAt,
          updatedAt: channel.updatedAt
        });
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Failed to create channel",
          err instanceof Error ? err.message : "Internal error"
        );
      }
    }
  );

  // POST /api/v1/organizations/:orgId/channels/:channelId/verify
  router.post(
    "/:channelId/verify",
    requireAuth,
    requireWritePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const channelId = getParam(request.params, "channelId");

        const channel = await getChannelById(options.db, channelId, orgId);
        if (!channel) {
          return sendProblem(
            response,
            404,
            "NOT_FOUND",
            "Channel not found",
            "Channel does not exist"
          );
        }

        let verified = false;
        let message = "Verification failed";

        try {
          const encryptionKey = getEncryptionKey(options);
          const parsedEncrypted = JSON.parse(channel.encryptedCredentials) as Parameters<
            typeof decryptSecret
          >[0];
          const decryptedJson = decryptSecret(parsedEncrypted, encryptionKey);
          const creds = JSON.parse(decryptedJson) as { accessToken: string };

          if (creds.accessToken) {
            verified = true;
            message = "Meta WhatsApp Business Account credentials verified successfully";
          }
        } catch {
          verified = false;
          message = "Failed to decrypt or validate access token credentials";
        }

        if (verified && channel.status !== "active") {
          await updateChannelStatus(
            options.db,
            channelId,
            "active",
            "Verified successfully via UI"
          );
        }

        return response.status(200).json({
          channelId,
          verified,
          status: verified ? "active" : channel.status,
          message
        });
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Verification error",
          err instanceof Error ? err.message : "Internal error"
        );
      }
    }
  );

  // PATCH /api/v1/organizations/:orgId/channels/:channelId
  router.patch(
    "/:channelId",
    requireAuth,
    requireWritePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const channelId = getParam(request.params, "channelId");
        const body = (
          request.body && typeof request.body === "object" ? request.body : {}
        ) as Record<string, unknown>;
        const statusVal: unknown = body["status"];
        const targetStatus: ChannelStatus | undefined =
          typeof statusVal === "string" ? (statusVal as ChannelStatus) : undefined;
        const reasonVal: unknown = body["statusReason"];
        const statusReason: string | undefined =
          typeof reasonVal === "string" ? reasonVal : undefined;

        const existing = await getChannelById(options.db, channelId, orgId);
        if (!existing) {
          return sendProblem(
            response,
            404,
            "NOT_FOUND",
            "Channel not found",
            "Channel does not exist"
          );
        }

        let updated = existing;
        if (targetStatus) {
          updated = await updateChannelStatus(options.db, channelId, targetStatus, statusReason);
        }

        return response.status(200).json({
          id: updated.id,
          organizationId: updated.organizationId,
          type: updated.type,
          name: updated.name,
          phoneNumberId: updated.phoneNumberId,
          wabaId: updated.wabaId,
          status: updated.status,
          statusReason: updated.statusReason,
          updatedAt: updated.updatedAt
        });
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Failed to update channel",
          err instanceof Error ? err.message : "Internal error"
        );
      }
    }
  );

  // DELETE /api/v1/organizations/:orgId/channels/:channelId
  router.delete(
    "/:channelId",
    requireAuth,
    requireWritePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const channelId = getParam(request.params, "channelId");

        const deleted = await deleteChannel(options.db, channelId, orgId);
        if (!deleted) {
          return sendProblem(
            response,
            404,
            "NOT_FOUND",
            "Channel not found",
            "Channel does not exist"
          );
        }

        await recordAuditEvent(options.db, {
          organizationId: orgId,
          actorUserId: request.user?.id ?? "unknown",
          action: "channel.deleted",
          targetType: "channel",
          targetId: channelId,
          result: "allowed",
          metadata: {}
        });

        return response.status(200).json({ success: true, channelId });
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Failed to delete channel",
          err instanceof Error ? err.message : "Internal error"
        );
      }
    }
  );

  return router;
}
