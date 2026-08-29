import { v7 as uuidv7 } from "uuid";
export {
  withTenantTransaction,
  runInTenantTransaction,
  type TenantContext
} from "./tenant-context.js";
export {
  createOidcTransaction,
  consumeOidcTransaction,
  findOrCreateUserFromIdentity,
  createAuthSession,
  getActiveSessionByTokenHash,
  revokeAuthSession,
  type DbClient,
  type OidcTransactionInput,
  type OidcTransactionRecord,
  type UpsertIdentityUserInput,
  type UserRecord,
  type CreateAuthSessionInput,
  type AuthSessionRecord
} from "./auth.js";
export {
  bootstrapOrganization,
  createInvitation,
  consumeInvitation,
  revokeInvitation,
  listMemberships,
  getMemberRole,
  updateMembershipRole,
  revokeMembership,
  listUserOrganizations,
  LastOwnerProtectionError,
  type BootstrapOrganizationInput,
  type BootstrapOrganizationResult,
  type CreateInvitationInput,
  type InvitationRecord,
  type MembershipRecord,
  type UserOrganizationRecord
} from "./organizations.js";
export {
  acquireIdempotencyKey,
  completeIdempotencyKey,
  releaseIdempotencyKey,
  type IdempotencyStatus,
  type AcquireIdempotencyResult,
  type AcquireIdempotencyParams,
  type CompleteIdempotencyParams,
  type ReleaseIdempotencyParams
} from "./idempotency.js";
export {
  recordAuditEvent,
  listAuditLogs,
  redactSensitiveMetadata,
  type RecordAuditEventParams,
  type RecordAuditEventResult,
  type ListAuditLogsParams
} from "./audit.js";
export {
  createChannel,
  getChannelById,
  getChannelByPhoneNumberId,
  listChannels,
  updateChannelStatus,
  type ChannelRecord,
  type CreateChannelInput
} from "./channels.js";
export {
  recordWebhookEvent,
  getWebhookEventById,
  type WebhookEventRecord,
  type WebhookEventStatus,
  type RecordWebhookEventInput,
  type RecordWebhookEventResult
} from "./webhooks.js";
export {
  findOrCreateConversation,
  getConversationById,
  getMessageById,
  updateConversationStatus,
  assignConversation,
  createMessage,
  updateMessageStatus,
  listMessagesByConversation,
  listConversations,
  updateConversation,
  createOutboundMessageWithOutbox,
  claimUnpublishedOutboxEvents,
  markOutboxEventPublished,
  recordOutboxEventFailure,
  OptimisticConcurrencyError,
  ClosedConversationError,
  type ConversationRecord,
  type MessageRecord,
  type FindOrCreateConversationInput,
  type CreateMessageInput,
  type ListConversationsOptions,
  type ListConversationsResult,
  type UpdateConversationOptions,
  type CreateOutboundMessageWithOutboxInput,
  type ClaimedOutboxEvent
} from "./conversations.js";
export {
  createTeam,
  addTeamMember,
  createQueue,
  addQueueMember,
  removeQueueMember,
  listVisibleQueues,
  type TeamRecord,
  type QueueRecord,
  type QueueRoutingStrategy,
  type QueueStatus,
  type CreateTeamInput,
  type CreateQueueInput
} from "./operational-inbox.js";
export {
  performConversationOperation,
  ConversationAccessRevokedError,
  ConversationActionError,
  type ConversationOperation,
  type PerformConversationOperationInput
} from "./conversation-operations.js";

export const DATABASE_PACKAGE_STATE = "m1-foundation-ready" as const;

export const DATABASE_ROLE_NAMES = {
  migrator: "flowdesk_migrator",
  runtime: "flowdesk_runtime",
  reporting: "flowdesk_reporting",
  breakGlass: "flowdesk_break_glass"
} as const;

export function createDatabaseId(): string {
  return uuidv7();
}

export function assertLocalDatabaseReset(appEnvironment: string): void {
  if (appEnvironment !== "local") throw new Error("Database reset is restricted to APP_ENV=local");
}
