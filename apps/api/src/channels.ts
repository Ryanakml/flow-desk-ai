import { createHash, randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import {
  CompleteWhatsAppEmbeddedSignupRequestSchema,
  CreateChannelRequestSchema,
  RotateChannelCredentialsRequestSchema,
  UpdateChannelStatusRequestSchema,
  type ChannelVerificationState
} from "@flowdesk/contracts";
import { loadChannelEncryptionConfig, type MetaEmbeddedSignupConfig } from "@flowdesk/config";
import {
  beginWhatsAppEmbeddedSignupAttempt,
  claimWhatsAppBusinessAccount,
  completeWhatsAppEmbeddedSignupAttempt,
  createChannel,
  createWhatsAppEmbeddedSignupAttempt,
  failWhatsAppEmbeddedSignupAttempt,
  getChannelById,
  getChannelByPhoneNumberId,
  listChannels,
  updateChannelStatus,
  updateChannelCredentials,
  updateChannelMetadata,
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
  embeddedSignup?: MetaEmbeddedSignupConfig;
}

function getEncryptionKey(options: ChannelsRouterOptions): string {
  if (options.encryptionKey) return options.encryptionKey;
  return loadChannelEncryptionConfig().ENCRYPTION_KEY;
}

function getProvider(options: ChannelsRouterOptions): WhatsAppProvider {
  return options.provider ?? new MetaWhatsAppProvider();
}

function hashConnectionState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function serializeChannel(channel: {
  id: string;
  organizationId: string;
  type: string;
  name: string;
  phoneNumberId: string;
  wabaId: string;
  status: string;
  statusReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: channel.id,
    organizationId: channel.organizationId,
    type: channel.type,
    name: channel.name,
    phoneNumberId: channel.phoneNumberId,
    wabaId: channel.wabaId,
    status: channel.status,
    statusReason: channel.statusReason,
    metadata: channel.metadata,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString()
  };
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

  // POST /api/v1/organizations/:orgId/channels/whatsapp/embedded-signup/start
  // App Secret stays on the server. The browser only receives public Meta IDs and a one-time state.
  router.post(
    "/whatsapp/embedded-signup/start",
    requireAuth,
    requireWritePermission,
    async (request: Request, response: Response) => {
      if (!options.embeddedSignup || !request.user) {
        return sendProblem(
          response,
          503,
          "META_EMBEDDED_SIGNUP_UNAVAILABLE",
          "Meta connection is not configured",
          "FlowDesk has not configured its Meta Embedded Signup credentials for this environment."
        );
      }

      const orgId = getParam(request.params, "orgId");
      const state = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      const attempt = await runInTenantTransaction(
        options.db,
        { organizationId: orgId },
        async (db) => {
          const created = await createWhatsAppEmbeddedSignupAttempt(db, {
            organizationId: orgId,
            createdByUserId: request.user!.id,
            stateHash: hashConnectionState(state),
            expiresAt
          });
          await recordAuditEvent(db, {
            organizationId: orgId,
            actorUserId: request.user!.id,
            action: "whatsapp.embedded_signup_started",
            targetType: "whatsapp_connection_attempt",
            targetId: created.id,
            result: "allowed"
          });
          return created;
        }
      );

      return response.status(201).json({
        attemptId: attempt.id,
        state,
        appId: options.embeddedSignup.appId,
        configId: options.embeddedSignup.configId,
        expiresAt: attempt.expiresAt.toISOString()
      });
    }
  );

  // POST /api/v1/organizations/:orgId/channels/whatsapp/embedded-signup/complete
  router.post(
    "/whatsapp/embedded-signup/complete",
    requireAuth,
    requireWritePermission,
    async (request: Request, response: Response) => {
      if (!options.embeddedSignup || !request.user) {
        return sendProblem(
          response,
          503,
          "META_EMBEDDED_SIGNUP_UNAVAILABLE",
          "Meta connection is not configured",
          "FlowDesk has not configured its Meta Embedded Signup credentials for this environment."
        );
      }

      const parsed = CompleteWhatsAppEmbeddedSignupRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendProblem(
          response,
          400,
          "VALIDATION_ERROR",
          "Invalid Meta signup completion",
          parsed.error.issues.map((issue) => issue.message).join("; ")
        );
      }

      const orgId = getParam(request.params, "orgId");
      const input = parsed.data;
      const attempt = await runInTenantTransaction(options.db, { organizationId: orgId }, (db) =>
        beginWhatsAppEmbeddedSignupAttempt(db, {
          id: input.attemptId,
          organizationId: orgId,
          stateHash: hashConnectionState(input.state)
        })
      );
      if (!attempt) {
        return sendProblem(
          response,
          409,
          "INVALID_OR_EXPIRED_SIGNUP_ATTEMPT",
          "Meta connection could not be completed",
          "This connection attempt is invalid, expired, or has already been used. Start again from FlowDesk."
        );
      }

      let createdChannelId: string | undefined;
      try {
        const provider = getProvider(options);
        const token = await provider.exchangeEmbeddedSignupCode({
          code: input.code,
          appId: options.embeddedSignup.appId,
          appSecret: options.embeddedSignup.appSecret
        });
        const selectedAccount = await provider.verifyPhoneNumber({
          phoneNumberId: input.phoneNumberId,
          wabaId: input.wabaId,
          accessToken: token.accessToken
        });
        await provider.assignWhatsAppBusinessAccountSystemUser({
          wabaId: selectedAccount.wabaId,
          systemUserId: options.embeddedSignup.systemUserId,
          adminAccessToken: options.embeddedSignup.adminSystemUserAccessToken
        });
        // The user-authorized token proves the customer's selection. Persist and
        // use only the FlowDesk system-user token after Meta has assigned it.
        const verified = await provider.verifyPhoneNumber({
          phoneNumberId: selectedAccount.phoneNumberId,
          wabaId: selectedAccount.wabaId,
          accessToken: options.embeddedSignup.systemUserAccessToken
        });
        const encryptedCredentials = encryptWhatsAppChannelCredentials(
          {
            accessToken: options.embeddedSignup.systemUserAccessToken,
            phoneNumberId: verified.phoneNumberId,
            wabaId: verified.wabaId
          },
          getEncryptionKey(options)
        );

        const connectingChannel = await runInTenantTransaction(
          options.db,
          { organizationId: orgId },
          async (db) => {
            const wabaClaimed = await claimWhatsAppBusinessAccount(db, {
              wabaId: verified.wabaId,
              organizationId: orgId
            });
            if (!wabaClaimed) {
              throw new Error("WABA_OWNED_BY_ANOTHER_ORGANIZATION");
            }
            const existing = await getChannelByPhoneNumberId(db, verified.phoneNumberId);
            const channel = existing
              ? await (async () => {
                  if (existing.organizationId !== orgId || existing.wabaId !== verified.wabaId) {
                    throw new Error("WABA_OWNED_BY_ANOTHER_ORGANIZATION");
                  }
                  await updateChannelCredentials(db, {
                    id: existing.id,
                    organizationId: orgId,
                    encryptedCredentials
                  });
                  return updateChannelStatus(db, existing.id, "connecting");
                })()
              : await createChannel(db, {
                  organizationId: orgId,
                  type: "whatsapp",
                  name:
                    input.name ??
                    verified.displayPhoneNumber ??
                    verified.verifiedName ??
                    "WhatsApp",
                  phoneNumberId: verified.phoneNumberId,
                  wabaId: verified.wabaId,
                  encryptedCredentials,
                  status: "connecting",
                  metadata: {
                    connectionMethod: "meta_embedded_signup",
                    subscriptionStatus: "pending"
                  }
                });
            await recordAuditEvent(db, {
              organizationId: orgId,
              actorUserId: request.user!.id,
              action: existing ? "whatsapp.channel_reconnecting" : "whatsapp.channel_connecting",
              targetType: "channel",
              targetId: channel.id,
              result: "allowed",
              metadata: { phoneNumberId: verified.phoneNumberId, wabaId: verified.wabaId }
            });
            return channel;
          }
        );
        createdChannelId = connectingChannel.id;

        await provider.subscribeWhatsAppBusinessAccount({
          wabaId: verified.wabaId,
          accessToken: options.embeddedSignup.systemUserAccessToken
        });

        const activeChannel = await runInTenantTransaction(
          options.db,
          { organizationId: orgId },
          async (db) => {
            await updateChannelMetadata(db, connectingChannel.id, orgId, {
              subscriptionStatus: "subscribed"
            });
            const activated = await updateChannelStatus(db, connectingChannel.id, "active");
            await completeWhatsAppEmbeddedSignupAttempt(db, {
              id: attempt.id,
              organizationId: orgId
            });
            await recordAuditEvent(db, {
              organizationId: orgId,
              actorUserId: request.user!.id,
              action: "whatsapp.channel_connected",
              targetType: "channel",
              targetId: activated.id,
              result: "allowed",
              metadata: { phoneNumberId: verified.phoneNumberId, wabaId: verified.wabaId }
            });
            return activated;
          }
        );

        return response.status(201).json({
          channel: serializeChannel(activeChannel),
          displayPhoneNumber: verified.displayPhoneNumber,
          verifiedName: verified.verifiedName
        });
      } catch (error) {
        const isProviderError = error instanceof WhatsAppProviderError;
        const failureCode = isProviderError ? error.classification : "connection_failed";
        await runInTenantTransaction(options.db, { organizationId: orgId }, async (db) => {
          if (createdChannelId) {
            await updateChannelStatus(
              db,
              createdChannelId,
              "degraded",
              "Meta webhook subscription could not be completed. Reconnect the channel to try again."
            );
          }
          await failWhatsAppEmbeddedSignupAttempt(db, {
            id: attempt.id,
            organizationId: orgId,
            failureCode
          });
          await recordAuditEvent(db, {
            organizationId: orgId,
            actorUserId: request.user!.id,
            action: "whatsapp.embedded_signup_failed",
            targetType: "whatsapp_connection_attempt",
            targetId: attempt.id,
            result: "denied",
            metadata: { failureCode }
          });
        });

        if (error instanceof Error && error.message === "WABA_OWNED_BY_ANOTHER_ORGANIZATION") {
          return sendProblem(
            response,
            409,
            "WABA_OWNERSHIP_CONFLICT",
            "WhatsApp account is already connected",
            "This WhatsApp Business Account is already connected to another FlowDesk organization."
          );
        }
        return sendProblem(
          response,
          isProviderError && error.classification === "RESOURCE_MISMATCH" ? 409 : 422,
          "META_CONNECTION_FAILED",
          "Meta connection could not be completed",
          "FlowDesk could not verify the selected WhatsApp account or subscribe it to the FlowDesk Meta App."
        );
      }
    }
  );

  // Operator-assisted connection: the exact token verified here is also used
  // for WABA subscription and encrypted storage for worker sends.
  router.post(
    "/",
    requireAuth,
    requireWritePermission,
    async (request: Request, response: Response) => {
      const parsed = CreateChannelRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendProblem(
          response,
          400,
          "VALIDATION_ERROR",
          "Invalid WhatsApp connection input",
          parsed.error.issues.map((issue) => issue.message).join("; ")
        );
      }

      const orgId = getParam(request.params, "orgId");
      const input = parsed.data;
      let channelId: string | undefined;
      try {
        const provider = getProvider(options);
        const verified = await provider.verifyPhoneNumber({
          phoneNumberId: input.phoneNumberId,
          wabaId: input.wabaId,
          accessToken: input.accessToken
        });
        const encryptedCredentials = encryptWhatsAppChannelCredentials(
          {
            accessToken: input.accessToken,
            phoneNumberId: verified.phoneNumberId,
            wabaId: verified.wabaId
          },
          getEncryptionKey(options)
        );

        const connectingChannel = await runInTenantTransaction(
          options.db,
          { organizationId: orgId },
          async (db) => {
            const wabaClaimed = await claimWhatsAppBusinessAccount(db, {
              wabaId: verified.wabaId,
              organizationId: orgId
            });
            if (!wabaClaimed) throw new Error("WABA_OWNED_BY_ANOTHER_ORGANIZATION");

            const existing = await getChannelByPhoneNumberId(db, verified.phoneNumberId);
            if (
              existing &&
              (existing.organizationId !== orgId || existing.wabaId !== verified.wabaId)
            ) {
              throw new Error("WABA_OWNED_BY_ANOTHER_ORGANIZATION");
            }

            const channel = existing
              ? await (async () => {
                  await updateChannelCredentials(db, {
                    id: existing.id,
                    organizationId: orgId,
                    encryptedCredentials
                  });
                  await updateChannelMetadata(db, existing.id, orgId, {
                    connectionMethod: "manual_verified",
                    subscriptionStatus: "pending"
                  });
                  return updateChannelStatus(db, existing.id, "connecting");
                })()
              : await createChannel(db, {
                  organizationId: orgId,
                  type: "whatsapp",
                  name: input.name,
                  phoneNumberId: verified.phoneNumberId,
                  wabaId: verified.wabaId,
                  encryptedCredentials,
                  status: "connecting",
                  metadata: {
                    ...input.metadata,
                    connectionMethod: "manual_verified",
                    subscriptionStatus: "pending"
                  }
                });
            await recordAuditEvent(db, {
              organizationId: orgId,
              actorUserId: request.user!.id,
              action: existing ? "whatsapp.channel_reconnecting" : "whatsapp.channel_connecting",
              targetType: "channel",
              targetId: channel.id,
              result: "allowed",
              metadata: {
                connectionMethod: "manual_verified",
                phoneNumberId: verified.phoneNumberId,
                wabaId: verified.wabaId
              }
            });
            return channel;
          }
        );
        channelId = connectingChannel.id;

        await provider.subscribeWhatsAppBusinessAccount({
          wabaId: verified.wabaId,
          accessToken: input.accessToken
        });

        const activeChannel = await runInTenantTransaction(
          options.db,
          { organizationId: orgId },
          async (db) => {
            await updateChannelMetadata(db, connectingChannel.id, orgId, {
              subscriptionStatus: "subscribed"
            });
            const activated = await updateChannelStatus(db, connectingChannel.id, "active");
            await recordAuditEvent(db, {
              organizationId: orgId,
              actorUserId: request.user!.id,
              action: "whatsapp.channel_connected",
              targetType: "channel",
              targetId: activated.id,
              result: "allowed",
              metadata: {
                connectionMethod: "manual_verified",
                phoneNumberId: verified.phoneNumberId,
                wabaId: verified.wabaId
              }
            });
            return activated;
          }
        );

        return response.status(201).json({
          channel: serializeChannel(activeChannel),
          displayPhoneNumber: verified.displayPhoneNumber,
          verifiedName: verified.verifiedName
        });
      } catch (error) {
        if (channelId) {
          await runInTenantTransaction(options.db, { organizationId: orgId }, async (db) => {
            await updateChannelMetadata(db, channelId!, orgId, { subscriptionStatus: "failed" });
            await updateChannelStatus(
              db,
              channelId!,
              "degraded",
              "Meta webhook subscription failed. Check the token permissions and reconnect."
            );
          });
        }
        if (error instanceof Error && error.message === "WABA_OWNED_BY_ANOTHER_ORGANIZATION") {
          return sendProblem(
            response,
            409,
            "WABA_OWNERSHIP_CONFLICT",
            "WhatsApp account is already connected",
            "This WhatsApp Business Account is already connected to another FlowDesk organization."
          );
        }
        if (error instanceof WhatsAppProviderError) {
          const failure = verificationFailure(error);
          return sendProblem(
            response,
            error.classification === "RESOURCE_MISMATCH" ? 409 : 422,
            "META_CONNECTION_FAILED",
            "Meta connection could not be completed",
            failure.message
          );
        }
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "WhatsApp connection failed",
          error instanceof Error ? error.message : "Internal error"
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

  // Rotate credentials in place so conversations and channel identity are preserved.
  router.patch(
    "/:channelId/credentials",
    requireAuth,
    requireWritePermission,
    async (request: Request, response: Response) => {
      const parsed = RotateChannelCredentialsRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendProblem(
          response,
          400,
          "VALIDATION_ERROR",
          "Invalid credential input",
          parsed.error.issues.map((issue) => issue.message).join("; ")
        );
      }

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

      let credentialsStored = false;
      try {
        const provider = getProvider(options);
        const verified = await provider.verifyPhoneNumber({
          phoneNumberId: channel.phoneNumberId,
          wabaId: channel.wabaId,
          accessToken: parsed.data.accessToken
        });
        const encryptedCredentials = encryptWhatsAppChannelCredentials(
          {
            accessToken: parsed.data.accessToken,
            phoneNumberId: verified.phoneNumberId,
            wabaId: verified.wabaId
          },
          getEncryptionKey(options)
        );

        await runInTenantTransaction(options.db, { organizationId: orgId }, async (db) => {
          await updateChannelCredentials(db, {
            id: channel.id,
            organizationId: orgId,
            encryptedCredentials
          });
          await updateChannelMetadata(db, channel.id, orgId, {
            connectionMethod: "manual_verified",
            subscriptionStatus: "pending"
          });
          await updateChannelStatus(db, channel.id, "connecting");
        });
        credentialsStored = true;

        await provider.subscribeWhatsAppBusinessAccount({
          wabaId: verified.wabaId,
          accessToken: parsed.data.accessToken
        });

        const updated = await runInTenantTransaction(
          options.db,
          { organizationId: orgId },
          async (db) => {
            await updateChannelMetadata(db, channel.id, orgId, {
              subscriptionStatus: "subscribed"
            });
            const activated = await updateChannelStatus(db, channel.id, "active");
            await recordAuditEvent(db, {
              organizationId: orgId,
              actorUserId: request.user!.id,
              action: "whatsapp.channel_credentials_rotated",
              targetType: "channel",
              targetId: channel.id,
              result: "allowed",
              metadata: { connectionMethod: "manual_verified" }
            });
            return activated;
          }
        );

        return response.status(200).json({
          channelId: updated.id,
          organizationId: updated.organizationId,
          updatedAt: updated.updatedAt.toISOString()
        });
      } catch (error) {
        if (credentialsStored) {
          await runInTenantTransaction(options.db, { organizationId: orgId }, async (db) => {
            await updateChannelMetadata(db, channel.id, orgId, { subscriptionStatus: "failed" });
            await updateChannelStatus(
              db,
              channel.id,
              "degraded",
              "Meta webhook subscription failed. Check the token permissions and reconnect."
            );
          });
        }
        if (error instanceof WhatsAppProviderError) {
          const failure = verificationFailure(error);
          return sendProblem(
            response,
            error.classification === "RESOURCE_MISMATCH" ? 409 : 422,
            "META_CONNECTION_FAILED",
            "Meta credential rotation failed",
            failure.message
          );
        }
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Meta credential rotation failed",
          error instanceof Error ? error.message : "Internal error"
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
