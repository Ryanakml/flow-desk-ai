import { Router, type Request, type Response } from "express";
import {
  CreateChannelRequestSchema,
  RotateChannelCredentialsRequestSchema,
  UpdateChannelStatusRequestSchema,
  type ChannelVerificationState
} from "@flowdesk/contracts";
import { loadChannelEncryptionConfig } from "@flowdesk/config";
import {
  createChannel,
  getChannelById,
  listChannels,
  updateChannelStatus,
  updateChannelCredentials,
  deleteChannel,
  recordAuditEvent,
  runInTenantTransaction,
  type DbClient
} from "@flowdesk/db";
import {
  MetaWhatsAppProvider,
  WhatsAppProviderError,
  type WhatsAppProvider
} from "@flowdesk/providers";
import {
  decryptWhatsAppChannelCredentials,
  encryptWhatsAppChannelCredentials,
  WhatsAppCredentialError
} from "@flowdesk/security";
import { createRequireAuthMiddleware } from "./auth.js";
import { createRequireOrgPermissionMiddleware } from "./organizations.js";

export interface ChannelsRouterOptions {
  db: DbClient;
  encryptionKey?: string;
  provider?: WhatsAppProvider;
}

function getEncryptionKey(options: ChannelsRouterOptions): string {
  if (options.encryptionKey) return options.encryptionKey;
  return loadChannelEncryptionConfig().ENCRYPTION_KEY;
}

function getProvider(options: ChannelsRouterOptions): WhatsAppProvider {
  return options.provider ?? new MetaWhatsAppProvider();
}

function verificationFailure(error: WhatsAppProviderError): {
  state: ChannelVerificationState;
  message: string;
} {
  switch (error.classification) {
    case "AUTH_FAILED":
      return {
        state: "revoked_or_expired",
        message: "Meta rejected the access token because it is expired, revoked, or invalid."
      };
    case "PERMISSION_DENIED":
      return {
        state: "permission_failure",
        message: "The access token does not have permission to inspect this WhatsApp phone number."
      };
    case "RESOURCE_MISMATCH":
      return {
        state: "identifier_mismatch",
        message: "The configured Phone Number ID does not belong to the configured WABA ID."
      };
    default:
      return {
        state: "meta_unavailable",
        message: "Meta could not complete credential verification at this time."
      };
  }
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
        const channels = await runInTenantTransaction(options.db, { organizationId: orgId }, (db) =>
          listChannels(db, orgId)
        );

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
        const parsed = CreateChannelRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          return sendProblem(
            response,
            400,
            "VALIDATION_ERROR",
            "Invalid channel input",
            parsed.error.issues.map((issue) => issue.message).join("; ")
          );
        }
        const { name, phoneNumberId, wabaId, accessToken, metadata } = parsed.data;

        const encryptionKey = getEncryptionKey(options);
        const encryptedCredentials = encryptWhatsAppChannelCredentials(
          { accessToken, phoneNumberId, wabaId },
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
              encryptedCredentials,
              status: "active",
              metadata
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
        const channel = await runInTenantTransaction(options.db, { organizationId: orgId }, (db) =>
          getChannelById(db, channelId, orgId)
        );
        if (!channel) {
          return sendProblem(
            response,
            404,
            "NOT_FOUND",
            "Channel not found",
            "Channel does not exist"
          );
        }

        let credentials;
        try {
          credentials = decryptWhatsAppChannelCredentials(
            channel.encryptedCredentials,
            getEncryptionKey(options),
            { phoneNumberId: channel.phoneNumberId, wabaId: channel.wabaId }
          );
        } catch (error) {
          if (!(error instanceof WhatsAppCredentialError)) throw error;
          return response.status(200).json({
            channelId,
            verified: false,
            state: "credential_error" satisfies ChannelVerificationState,
            status: channel.status,
            message: "Stored channel credentials could not be decrypted or parsed."
          });
        }

        try {
          const result = await getProvider(options).verifyPhoneNumber({
            phoneNumberId: channel.phoneNumberId,
            wabaId: channel.wabaId,
            accessToken: credentials.accessToken
          });
          return response.status(200).json({
            channelId,
            verified: true,
            state: "valid" satisfies ChannelVerificationState,
            status: channel.status,
            message: "Meta confirmed the access token and channel identifiers.",
            displayPhoneNumber: result.displayPhoneNumber,
            verifiedName: result.verifiedName
          });
        } catch (error) {
          if (!(error instanceof WhatsAppProviderError)) throw error;
          const failure = verificationFailure(error);
          return response.status(200).json({
            channelId,
            verified: false,
            state: failure.state,
            status: channel.status,
            message: failure.message
          });
        }
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

  // PATCH /api/v1/organizations/:orgId/channels/:channelId/credentials
  router.patch(
    "/:channelId/credentials",
    requireAuth,
    requireWritePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const channelId = getParam(request.params, "channelId");
        const parsed = RotateChannelCredentialsRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          return sendProblem(
            response,
            400,
            "VALIDATION_ERROR",
            "Invalid credential rotation input",
            parsed.error.issues.map((issue) => issue.message).join("; ")
          );
        }

        const rotated = await runInTenantTransaction(
          options.db,
          { organizationId: orgId },
          async (db) => {
            const existing = await getChannelById(db, channelId, orgId);
            if (!existing) return null;
            const encryptedCredentials = encryptWhatsAppChannelCredentials(
              {
                accessToken: parsed.data.accessToken,
                phoneNumberId: existing.phoneNumberId,
                wabaId: existing.wabaId
              },
              getEncryptionKey(options)
            );
            const updated = await updateChannelCredentials(db, {
              id: channelId,
              organizationId: orgId,
              encryptedCredentials
            });
            if (!updated) return null;
            await recordAuditEvent(db, {
              organizationId: orgId,
              actorUserId: request.user!.id,
              action: "channel.credentials_rotated",
              targetType: "channel",
              targetId: channelId,
              result: "allowed",
              metadata: {
                phoneNumberId: existing.phoneNumberId,
                wabaId: existing.wabaId
              }
            });
            return updated;
          }
        );

        if (!rotated) {
          return sendProblem(
            response,
            404,
            "NOT_FOUND",
            "Channel not found",
            "Channel does not exist"
          );
        }

        return response.status(200).json({
          channelId: rotated.id,
          organizationId: rotated.organizationId,
          updatedAt: rotated.updatedAt
        });
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Failed to rotate channel credentials",
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
        const parsed = UpdateChannelStatusRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          return sendProblem(
            response,
            400,
            "VALIDATION_ERROR",
            "Invalid channel status input",
            parsed.error.issues.map((issue) => issue.message).join("; ")
          );
        }

        const updated = await runInTenantTransaction(
          options.db,
          { organizationId: orgId },
          async (db) => {
            const existing = await getChannelById(db, channelId, orgId);
            if (!existing) return null;
            return updateChannelStatus(db, channelId, parsed.data.status, parsed.data.statusReason);
          }
        );
        if (!updated) {
          return sendProblem(
            response,
            404,
            "NOT_FOUND",
            "Channel not found",
            "Channel does not exist"
          );
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

        const deleted = await runInTenantTransaction(
          options.db,
          { organizationId: orgId },
          async (db) => {
            const wasDeleted = await deleteChannel(db, channelId, orgId);
            if (wasDeleted) {
              await recordAuditEvent(db, {
                organizationId: orgId,
                actorUserId: request.user!.id,
                action: "channel.deleted",
                targetType: "channel",
                targetId: channelId,
                result: "allowed",
                metadata: {}
              });
            }
            return wasDeleted;
          }
        );
        if (!deleted) {
          return sendProblem(
            response,
            404,
            "NOT_FOUND",
            "Channel not found",
            "Channel does not exist"
          );
        }

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
