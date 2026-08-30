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
  updateChannelCredentials,
  deleteChannel,
  type ChannelRecord,
  type CreateChannelInput,
  type UpdateChannelCredentialsInput
} from "./channels.js";
export {
  createWhatsAppEmbeddedSignupAttempt,
  beginWhatsAppEmbeddedSignupAttempt,
  completeWhatsAppEmbeddedSignupAttempt,
  failWhatsAppEmbeddedSignupAttempt,
  claimWhatsAppBusinessAccount,
  type WhatsAppEmbeddedSignupAttempt,
  type WhatsAppEmbeddedSignupAttemptStatus
} from "./whatsapp-embedded-signup.js";
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
  getConversationWithMessages,
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
  type ConversationWithMessagesRecord,
  type FindOrCreateConversationInput,
  type CreateMessageInput,
  type ListConversationsOptions,
  type ListConversationsResult,
  type UpdateConversationOptions,
  type CreateOutboundMessageWithOutboxInput,
  type OutboundTemplateMetadata,
  type ClaimedOutboxEvent
} from "./conversations.js";
export {
  createTeam,
  addTeamMember,
  createQueue,
  addQueueMember,
  removeQueueMember,
  listVisibleQueues,
  listTags,
  listConversationNotes,
  listConversationTags,
  listSavedFilters,
  createSavedFilter,
  deleteSavedFilter,
  type TeamRecord,
  type QueueRecord,
  type QueueRoutingStrategy,
  type QueueStatus,
  type CreateTeamInput,
  type CreateQueueInput,
  type TagRecord,
  type ConversationNoteRecord,
  type SavedFilterRecord
} from "./operational-inbox.js";
export {
  performConversationOperation,
  ConversationAccessRevokedError,
  ConversationActionError,
  type ConversationOperation,
  type PerformConversationOperationInput
} from "./conversation-operations.js";
export { getRealtimeVersion, canAccessRealtimeRoom, type RealtimeRoom } from "./realtime.js";
export {
  idempotentSyncTemplate,
  getTemplateByNameAndLanguage,
  getTemplateSyncCursor,
  setTemplateSyncCursor,
  getTemplateStatusHistory,
  type SyncTemplateVersionParams,
  type SyncTemplateResult,
  type WhatsAppTemplateRecord,
  type WhatsAppTemplateVersionRecord
} from "./whatsapp-templates.js";
export {
  createAttachmentUploadSession,
  getAttachmentById,
  getUploadSessionById,
  completeAttachmentUploadSession,
  updateAttachmentScanResult,
  softDeleteAttachment,
  listExpiredAttachments,
  listAttachmentRetentionCandidates,
  claimAttachmentScanEvents,
  type AttachmentStatus,
  type AttachmentRecord,
  type AttachmentUploadSessionRecord,
  type CreateAttachmentUploadSessionInput,
  type UpdateAttachmentScanResultInput,
  type SoftDeleteAttachmentInput,
  type ExpiredAttachmentRow
} from "./attachments.js";
export {
  createKnowledgeSource,
  getKnowledgeSourceById,
  listKnowledgeSources,
  updateKnowledgeSourceStatus,
  createDocumentWithChunks,
  searchDocumentChunks,
  getBotConfig,
  upsertBotConfig,
  recordBotRun,
  updateBotRunAction,
  type KnowledgeSourceType,
  type KnowledgeSourceStatus,
  type BotMode,
  type BotTone,
  type BotLanguage,
  type BotRunStatus,
  type OperatorAction,
  type KnowledgeSource,
  type DocumentRecord,
  type DocumentChunk,
  type DocumentChunkSearchResult,
  type KnowledgeVersion,
  type BotConfig,
  type BotRun
} from "./knowledge.js";
export {
  createRoutingRule,
  listRoutingRules,
  getRoutingRuleById,
  updateRoutingRule,
  deleteRoutingRule,
  recordRoutingLog,
  listRoutingLogsForConversation,
  type DbRoutingRule,
  type CreateRoutingRuleParams,
  type UpdateRoutingRuleParams,
  type RoutingLogRecord,
  type CreateRoutingLogParams
} from "./routing.js";
export { countRecentAutoReplies } from "./auto-send.js";
export {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  findApiKeyByHash,
  type ApiKeyRecord,
  type CreateApiKeyParams
} from "./api-keys.js";
export {
  listWebhookSubscriptions,
  createWebhookSubscription,
  deleteWebhookSubscription,
  type WebhookSubscriptionRecord,
  type CreateWebhookSubscriptionParams
} from "./webhook-subscriptions.js";
export {
  getAnalyticsOverview,
  getVolumeTimeSeries,
  type AnalyticsOverviewMetrics,
  type VolumeTimeSeriesPoint
} from "./analytics.js";

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
