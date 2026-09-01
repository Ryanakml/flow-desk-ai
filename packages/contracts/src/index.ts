import { z } from "zod";

export const BuildInfoSchema = z.object({
  service: z.string(),
  version: z.string(),
  gitSha: z.string(),
  environment: z.enum(["local", "preview", "staging", "production"])
});

export type BuildInfo = z.infer<typeof BuildInfoSchema>;

export const ProblemSchema = z.object({
  type: z.url(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: z.string(),
  detail: z.string(),
  requestId: z.string()
});

export type Problem = z.infer<typeof ProblemSchema>;

export const SessionUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1)
});

export type SessionUser = z.infer<typeof SessionUserSchema>;

export const SessionStateSchema = z.object({
  user: SessionUserSchema,
  expiresAt: z.string().datetime()
});

export type SessionState = z.infer<typeof SessionStateSchema>;

export const AuthAuthorizeUrlResponseSchema = z.object({
  authorizationUrl: z.string()
});

export type AuthAuthorizeUrlResponse = z.infer<typeof AuthAuthorizeUrlResponseSchema>;

export const AuthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1)
});

export type AuthCallbackQuery = z.infer<typeof AuthCallbackQuerySchema>;

export const LogoutResponseSchema = z.object({
  status: z.literal("ok")
});

export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;

export const BootstrapOrganizationRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9][a-z0-9-]{1,62}$/,
      "Slug must be 2-63 lowercase alphanumeric characters or hyphens"
    )
});

export type BootstrapOrganizationRequest = z.infer<typeof BootstrapOrganizationRequestSchema>;

export const BootstrapOrganizationResponseSchema = z.object({
  organization: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    displayName: z.string(),
    ownerRoleId: z.string().uuid(),
    membershipId: z.string().uuid()
  })
});

export type BootstrapOrganizationResponse = z.infer<typeof BootstrapOrganizationResponseSchema>;

export const RoleKeySchema = z.enum([
  "owner",
  "admin",
  "supervisor",
  "agent",
  "analyst",
  "billing_admin"
]);

export type RoleKey = z.infer<typeof RoleKeySchema>;

export const CreateInvitationRequestSchema = z.object({
  email: z.string().trim().email(),
  role: RoleKeySchema
});

export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequestSchema>;

export const CreateInvitationResponseSchema = z.object({
  invitation: z.object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    email: z.string().email(),
    role: RoleKeySchema,
    status: z.enum(["pending", "accepted", "revoked", "expired"]),
    expiresAt: z.string().datetime(),
    inviteToken: z.string().min(1)
  })
});

export type CreateInvitationResponse = z.infer<typeof CreateInvitationResponseSchema>;

export const AcceptInvitationRequestSchema = z.object({
  token: z.string().min(1)
});

export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequestSchema>;

export const AcceptInvitationResponseSchema = z.object({
  status: z.literal("ok"),
  organizationId: z.string().uuid(),
  membershipId: z.string().uuid()
});

export type AcceptInvitationResponse = z.infer<typeof AcceptInvitationResponseSchema>;

export const MembershipMemberSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  roleKey: RoleKeySchema,
  roleLabel: z.string(),
  status: z.enum(["invited", "active", "suspended", "revoked"]),
  createdAt: z.string().datetime()
});

export type MembershipMember = z.infer<typeof MembershipMemberSchema>;

export const ListMembersResponseSchema = z.object({
  members: z.array(MembershipMemberSchema)
});

export type ListMembersResponse = z.infer<typeof ListMembersResponseSchema>;

export const UpdateMembershipRoleRequestSchema = z.object({
  role: RoleKeySchema
});

export type UpdateMembershipRoleRequest = z.infer<typeof UpdateMembershipRoleRequestSchema>;

export const CursorPageQuerySchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export type CursorPageQuery = z.infer<typeof CursorPageQuerySchema>;

export const PageInfoSchema = z.object({
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
  startCursor: z.string().nullable(),
  endCursor: z.string().nullable(),
  totalCount: z.number().int().optional()
});

export type PageInfo = z.infer<typeof PageInfoSchema>;

export function createCursorPageResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    pageInfo: PageInfoSchema
  });
}

export interface CursorPayload {
  id: string;
  sortValue: string;
  organizationId?: string | undefined;
}

export function encodeCursor(payload: {
  id: string;
  sortValue: string | number | Date;
  organizationId?: string;
}): string {
  const sortVal =
    payload.sortValue instanceof Date ? payload.sortValue.toISOString() : String(payload.sortValue);
  const data: CursorPayload = {
    id: payload.id,
    sortValue: sortVal,
    ...(payload.organizationId ? { organizationId: payload.organizationId } : {})
  };
  return Buffer.from(JSON.stringify(data), "utf8").toString("base64url");
}

export function decodeCursor(
  cursor: string,
  expectedOrganizationId?: string
): CursorPayload | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>)["id"] !== "string" ||
      typeof (parsed as Record<string, unknown>)["sortValue"] !== "string"
    ) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const orgId =
      typeof record["organizationId"] === "string" ? record["organizationId"] : undefined;

    if (expectedOrganizationId && orgId && orgId !== expectedOrganizationId) {
      return null;
    }

    return {
      id: record["id"] as string,
      sortValue: record["sortValue"] as string,
      organizationId: orgId
    };
  } catch {
    return null;
  }
}

export const AuditLogResultSchema = z.enum(["allowed", "denied", "failed"]);
export type AuditLogResult = z.infer<typeof AuditLogResultSchema>;

export const AuditLogEntrySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  actorUserId: z.string().uuid().nullable(),
  action: z.string().min(1),
  targetType: z.string().min(1),
  targetId: z.string().uuid().nullable(),
  result: AuditLogResultSchema,
  correlationId: z.string().uuid().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  occurredAt: z.string().datetime()
});

export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

export const ListAuditLogsResponseSchema = createCursorPageResponseSchema(AuditLogEntrySchema);
export type ListAuditLogsResponse = z.infer<typeof ListAuditLogsResponseSchema>;

export const ListAuditLogsQuerySchema = CursorPageQuerySchema.extend({
  action: z.string().trim().min(1).optional(),
  actorUserId: z.string().uuid().optional()
});

export type ListAuditLogsQuery = z.infer<typeof ListAuditLogsQuerySchema>;

export const IdempotencyHeaderSchema = z.string().trim().min(1).max(256);

export const UserOrganizationSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  role: z.string(),
  membershipId: z.string().uuid()
});

export type UserOrganization = z.infer<typeof UserOrganizationSchema>;

export const ListUserOrganizationsResponseSchema = z.object({
  organizations: z.array(UserOrganizationSchema)
});

export type ListUserOrganizationsResponse = z.infer<typeof ListUserOrganizationsResponseSchema>;

export const ChannelStatusSchema = z.enum([
  "draft",
  "connecting",
  "active",
  "degraded",
  "disconnected"
]);
export type ChannelStatus = z.infer<typeof ChannelStatusSchema>;

export const ChannelTypeSchema = z.enum(["whatsapp"]);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

export const ChannelSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  type: ChannelTypeSchema,
  name: z.string().min(1).max(100),
  phoneNumberId: z.string().min(1),
  wabaId: z.string().min(1),
  status: ChannelStatusSchema,
  statusReason: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type Channel = z.infer<typeof ChannelSchema>;

export const CreateChannelRequestSchema = z.object({
  type: ChannelTypeSchema.default("whatsapp"),
  name: z.string().trim().min(1).max(100),
  phoneNumberId: z.string().trim().min(1),
  wabaId: z.string().trim().min(1),
  accessToken: z.string().trim().min(1).max(8192),
  metadata: z.record(z.string(), z.unknown()).optional()
});
export type CreateChannelRequest = z.infer<typeof CreateChannelRequestSchema>;

/** Browser-to-API contract for a platform-owned Meta Embedded Signup session. */
export const StartWhatsAppEmbeddedSignupResponseSchema = z.object({
  attemptId: z.string().uuid(),
  state: z.string().min(32),
  appId: z.string().min(1),
  configId: z.string().min(1),
  expiresAt: z.string().datetime()
});
export type StartWhatsAppEmbeddedSignupResponse = z.infer<
  typeof StartWhatsAppEmbeddedSignupResponseSchema
>;

export const CompleteWhatsAppEmbeddedSignupRequestSchema = z.object({
  attemptId: z.string().uuid(),
  state: z.string().min(32).max(1024),
  code: z.string().trim().min(1).max(8192),
  phoneNumberId: z.string().trim().min(1).max(255),
  wabaId: z.string().trim().min(1).max(255),
  name: z.string().trim().min(1).max(100).optional()
});
export type CompleteWhatsAppEmbeddedSignupRequest = z.infer<
  typeof CompleteWhatsAppEmbeddedSignupRequestSchema
>;

export const CompleteWhatsAppEmbeddedSignupResponseSchema = z.object({
  channel: ChannelSchema,
  displayPhoneNumber: z.string().nullable(),
  verifiedName: z.string().nullable()
});
export type CompleteWhatsAppEmbeddedSignupResponse = z.infer<
  typeof CompleteWhatsAppEmbeddedSignupResponseSchema
>;

export const UpdateChannelStatusRequestSchema = z.object({
  status: ChannelStatusSchema,
  statusReason: z.string().trim().max(500).optional()
});
export type UpdateChannelStatusRequest = z.infer<typeof UpdateChannelStatusRequestSchema>;

export const RotateChannelCredentialsRequestSchema = z.object({
  accessToken: z.string().trim().min(1).max(8192)
});
export type RotateChannelCredentialsRequest = z.infer<typeof RotateChannelCredentialsRequestSchema>;

export const ChannelVerificationStateSchema = z.enum([
  "valid",
  "revoked_or_expired",
  "permission_failure",
  "identifier_mismatch",
  "meta_unavailable",
  "credential_error"
]);
export type ChannelVerificationState = z.infer<typeof ChannelVerificationStateSchema>;

export const VerifyChannelResponseSchema = z.object({
  channelId: z.string().uuid(),
  verified: z.boolean(),
  state: ChannelVerificationStateSchema,
  status: ChannelStatusSchema,
  message: z.string(),
  displayPhoneNumber: z.string().nullable().optional(),
  verifiedName: z.string().nullable().optional()
});
export type VerifyChannelResponse = z.infer<typeof VerifyChannelResponseSchema>;

export const ListChannelsResponseSchema = z.object({
  channels: z.array(ChannelSchema)
});
export type ListChannelsResponse = z.infer<typeof ListChannelsResponseSchema>;

// Conversations and Messages (M2-07)
export const ConversationStatusSchema = z.enum(["new", "open", "pending", "resolved", "closed"]);
export type ConversationStatusContract = z.infer<typeof ConversationStatusSchema>;

export const ConversationPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type ConversationPriorityContract = z.infer<typeof ConversationPrioritySchema>;

export const MessageStatusSchema = z.enum(["queued", "sent", "delivered", "read", "failed"]);
export type MessageStatusContract = z.infer<typeof MessageStatusSchema>;

export const MessageDirectionSchema = z.enum(["inbound", "outbound"]);
export type MessageDirectionContract = z.infer<typeof MessageDirectionSchema>;

export const MessageSenderTypeSchema = z.enum(["customer", "agent", "system", "bot"]);
export type MessageSenderTypeContract = z.infer<typeof MessageSenderTypeSchema>;

export const ServiceWindowStatusSchema = z.object({
  isOpen: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
  remainingSeconds: z.number().int().nullable()
});
export type ServiceWindowStatus = z.infer<typeof ServiceWindowStatusSchema>;

export const ConversationSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  channelId: z.string().uuid(),
  customerPhone: z.string(),
  customerName: z.string().nullable(),
  status: ConversationStatusSchema,
  priority: ConversationPrioritySchema,
  assignedToUserId: z.string().uuid().nullable(),
  queueId: z.string().uuid().nullable(),
  teamId: z.string().uuid().nullable(),
  waitingReason: z.string().nullable(),
  botPaused: z.boolean(),
  firstResponseDueAt: z.string().datetime().nullable(),
  resolutionDueAt: z.string().datetime().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  firstRespondedAt: z.string().datetime().nullable(),
  slaPausedAt: z.string().datetime().nullable(),
  firstResponseRemainingSeconds: z.number().int().min(0).nullable(),
  resolutionRemainingSeconds: z.number().int().min(0).nullable(),
  version: z.number().int(),
  lastMessageAt: z.string().datetime(),
  lastInboundAt: z.string().datetime().nullable().optional(),
  serviceWindow: ServiceWindowStatusSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const MessageSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  conversationId: z.string().uuid(),
  channelId: z.string().uuid(),
  direction: MessageDirectionSchema,
  senderType: MessageSenderTypeSchema,
  senderUserId: z.string().uuid().nullable(),
  providerMessageId: z.string().nullable(),
  content: z.string(),
  status: MessageStatusSchema,
  errorDetail: z.string().nullable(),
  sentAt: z.string().datetime().nullable(),
  deliveredAt: z.string().datetime().nullable(),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type Message = z.infer<typeof MessageSchema>;

export const ListConversationsQuerySchema = z.object({
  status: ConversationStatusSchema.optional(),
  assignedTo: z.string().optional(),
  queueId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});
export type ListConversationsQuery = z.infer<typeof ListConversationsQuerySchema>;

export const ListConversationsResponseSchema = z.object({
  items: z.array(ConversationSchema),
  nextCursor: z.string().nullable()
});
export type ListConversationsResponse = z.infer<typeof ListConversationsResponseSchema>;

export const ConversationDetailResponseSchema = z.object({
  conversation: ConversationSchema,
  messages: z.array(MessageSchema),
  notes: z
    .array(
      z.object({
        id: z.string().uuid(),
        authorUserId: z.string().uuid(),
        body: z.string(),
        createdAt: z.string().datetime()
      })
    )
    .default([]),
  tags: z
    .array(z.object({ id: z.string().uuid(), name: z.string(), color: z.string() }))
    .default([])
});
export type ConversationDetailResponse = z.infer<typeof ConversationDetailResponseSchema>;

export const SavedFilterDefinitionSchema = z.object({
  status: ConversationStatusSchema.optional(),
  assignedTo: z.string().optional(),
  queueId: z.string().uuid().optional(),
  search: z.string().max(200).optional()
});
export type SavedFilterDefinition = z.infer<typeof SavedFilterDefinitionSchema>;

export const InboxWorkspaceResourcesResponseSchema = z.object({
  queues: z.array(z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() })),
  tags: z.array(z.object({ id: z.string().uuid(), name: z.string(), color: z.string() })),
  savedFilters: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      definition: SavedFilterDefinitionSchema,
      isDefault: z.boolean(),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime()
    })
  )
});
export type InboxWorkspaceResourcesResponse = z.infer<typeof InboxWorkspaceResourcesResponseSchema>;

export const CreateSavedFilterRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  definition: SavedFilterDefinitionSchema,
  isDefault: z.boolean().default(false)
});
export type CreateSavedFilterRequest = z.infer<typeof CreateSavedFilterRequestSchema>;

export const UpdateConversationRequestSchema = z
  .object({
    version: z.number().int().min(1),
    status: ConversationStatusSchema.optional(),
    assignedToUserId: z.string().uuid().nullable().optional()
  })
  .refine((data) => data.status !== undefined || data.assignedToUserId !== undefined, {
    message: "At least one update field (status or assignedToUserId) must be provided"
  });
export type UpdateConversationRequest = z.infer<typeof UpdateConversationRequestSchema>;

const ConversationOperationPayloadSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim") }),
  z.object({ action: z.literal("release") }),
  z.object({ action: z.literal("handoff"), targetUserId: z.string().uuid() }),
  z.object({ action: z.literal("note"), body: z.string().trim().min(1).max(10000) }),
  z.object({ action: z.literal("tag.add"), tagId: z.string().uuid() }),
  z.object({ action: z.literal("tag.remove"), tagId: z.string().uuid() }),
  z.object({
    action: z.literal("read"),
    lastReadMessageId: z.string().uuid().nullable().optional()
  }),
  z.object({ action: z.literal("unread") }),
  z.object({ action: z.literal("wait"), reason: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal("resolve") }),
  z.object({ action: z.literal("reopen") }),
  z.object({ action: z.literal("bot.pause") }),
  z.object({ action: z.literal("bot.resume") }),
  z.object({ action: z.literal("priority"), priority: ConversationPrioritySchema })
]);

export const ConversationOperationRequestSchema = z.intersection(
  z.object({ version: z.number().int().min(1) }),
  ConversationOperationPayloadSchema
);
export type ConversationOperationRequest = z.infer<typeof ConversationOperationRequestSchema>;

export const RealtimeConnectAuthSchema = z.object({
  organizationId: z.string().uuid(),
  lastVersion: z.number().int().min(0).optional()
});
export type RealtimeConnectAuth = z.infer<typeof RealtimeConnectAuthSchema>;

export const RealtimeRoomRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("organization") }),
  z.object({ type: z.literal("team"), id: z.string().uuid() }),
  z.object({ type: z.literal("conversation"), id: z.string().uuid() })
]);
export type RealtimeRoomRequest = z.infer<typeof RealtimeRoomRequestSchema>;

export const RealtimeReadySchema = z.object({
  schemaVersion: z.literal(1),
  organizationId: z.string().uuid(),
  currentVersion: z.number().int().min(0),
  reconcileRequired: z.boolean()
});
export type RealtimeReady = z.infer<typeof RealtimeReadySchema>;

export const RealtimeHintSchema = z.object({
  schemaVersion: z.literal(1),
  organizationId: z.string().uuid(),
  resourceType: z.enum([
    "organization",
    "conversation",
    "message",
    "queue",
    "team",
    "template",
    "media"
  ]),
  resourceId: z.string().uuid(),
  version: z.number().int().min(0)
});
export type RealtimeHint = z.infer<typeof RealtimeHintSchema>;

export const OutboundTextMessageRequestSchema = z.object({
  type: z.literal("text").optional(),
  content: z.string().trim().min(1).max(4096)
});
export type OutboundTextMessageRequest = z.infer<typeof OutboundTextMessageRequestSchema>;

export const OutboundTemplateMessageRequestSchema = z.object({
  type: z.literal("template"),
  templateName: z.string().trim().min(1).max(512),
  language: z.string().trim().min(1).max(32),
  variables: z.record(z.string(), z.string()).optional()
});
export type OutboundTemplateMessageRequest = z.infer<typeof OutboundTemplateMessageRequestSchema>;

export const OutboundMediaMessageRequestSchema = z.object({
  type: z.literal("media"),
  attachmentId: z.string().uuid(),
  caption: z.string().trim().max(1024).optional()
});
export type OutboundMediaMessageRequest = z.infer<typeof OutboundMediaMessageRequestSchema>;

export const CreateOutboundMessageRequestSchema = z.union([
  OutboundTemplateMessageRequestSchema,
  OutboundMediaMessageRequestSchema,
  OutboundTextMessageRequestSchema
]);
export type CreateOutboundMessageRequest = z.infer<typeof CreateOutboundMessageRequestSchema>;

// WhatsApp Template Schemas (M3-04)
export const WhatsAppTemplateCategorySchema = z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]);
export type WhatsAppTemplateCategory = z.infer<typeof WhatsAppTemplateCategorySchema>;

export const WhatsAppTemplateStatusSchema = z.enum([
  "APPROVED",
  "PENDING",
  "REJECTED",
  "PAUSED",
  "DISABLED",
  "IN_APPEAL"
]);
export type WhatsAppTemplateStatus = z.infer<typeof WhatsAppTemplateStatusSchema>;

export const WhatsAppTemplateComponentTypeSchema = z.enum(["HEADER", "BODY", "FOOTER", "BUTTONS"]);
export type WhatsAppTemplateComponentType = z.infer<typeof WhatsAppTemplateComponentTypeSchema>;

export const WhatsAppTemplateHeaderFormatSchema = z.enum([
  "TEXT",
  "IMAGE",
  "DOCUMENT",
  "VIDEO",
  "LOCATION"
]);
export type WhatsAppTemplateHeaderFormat = z.infer<typeof WhatsAppTemplateHeaderFormatSchema>;

export const WhatsAppTemplateButtonTypeSchema = z.enum([
  "QUICK_REPLY",
  "URL",
  "PHONE_NUMBER",
  "COPY_CODE",
  "FLOW"
]);
export type WhatsAppTemplateButtonType = z.infer<typeof WhatsAppTemplateButtonTypeSchema>;

export const WhatsAppTemplateButtonSchema = z.object({
  type: WhatsAppTemplateButtonTypeSchema,
  text: z.string(),
  url: z.string().optional(),
  phoneNumber: z.string().optional(),
  example: z.array(z.string()).optional()
});
export type WhatsAppTemplateButton = z.infer<typeof WhatsAppTemplateButtonSchema>;

export const WhatsAppTemplateComponentSchema = z.object({
  type: WhatsAppTemplateComponentTypeSchema,
  format: WhatsAppTemplateHeaderFormatSchema.optional(),
  text: z.string().optional(),
  buttons: z.array(WhatsAppTemplateButtonSchema).optional(),
  example: z.record(z.string(), z.unknown()).optional()
});
export type WhatsAppTemplateComponent = z.infer<typeof WhatsAppTemplateComponentSchema>;

export const WhatsAppTemplateVersionSchema = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid(),
  organizationId: z.string().uuid(),
  providerTemplateId: z.string(),
  language: z.string(),
  status: WhatsAppTemplateStatusSchema,
  rejectedReason: z.string().nullable().optional(),
  components: z.array(WhatsAppTemplateComponentSchema),
  variableCount: z.number().int().min(0),
  payloadHash: z.string(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});
export type WhatsAppTemplateVersion = z.infer<typeof WhatsAppTemplateVersionSchema>;

export const WhatsAppTemplateSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  channelId: z.string().uuid(),
  name: z.string(),
  category: WhatsAppTemplateCategorySchema,
  versions: z.array(WhatsAppTemplateVersionSchema).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});
export type WhatsAppTemplate = z.infer<typeof WhatsAppTemplateSchema>;

export const WhatsAppTemplateSyncResultSchema = z.object({
  channelId: z.string().uuid(),
  syncedCount: z.number().int().min(0),
  cursor: z.string().nullable()
});
export type WhatsAppTemplateSyncResult = z.infer<typeof WhatsAppTemplateSyncResultSchema>;

export const TemplatePreviewRequestSchema = z.object({
  templateName: z.string().trim().min(1).max(512),
  language: z.string().trim().min(1).max(32),
  variables: z.record(z.string(), z.string()).optional()
});
export type TemplatePreviewRequest = z.infer<typeof TemplatePreviewRequestSchema>;

export const TemplatePreviewResponseSchema = z.object({
  templateName: z.string(),
  language: z.string(),
  status: WhatsAppTemplateStatusSchema,
  isEligible: z.boolean(),
  ineligibilityReason: z.string().nullable(),
  renderedBody: z.string(),
  renderedHeader: z.string().nullable(),
  renderedComponents: z.array(WhatsAppTemplateComponentSchema),
  renderedPayloadHash: z.string()
});
export type TemplatePreviewResponse = z.infer<typeof TemplatePreviewResponseSchema>;

// Attachments and Media Quarantine (M3-06)
export const AttachmentStatusSchema = z.enum(["quarantine", "clean", "rejected"]);
export type AttachmentStatus = z.infer<typeof AttachmentStatusSchema>;

export const CreateUploadSessionRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(100),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024),
  sha256Checksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional()
});
export type CreateUploadSessionRequest = z.infer<typeof CreateUploadSessionRequestSchema>;

export const CreateUploadSessionResponseSchema = z.object({
  attachmentId: z.string().uuid(),
  uploadSessionId: z.string().uuid(),
  uploadUrl: z.string().url(),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string().datetime({ offset: true })
});
export type CreateUploadSessionResponse = z.infer<typeof CreateUploadSessionResponseSchema>;

export const CompleteUploadRequestSchema = z.object({
  sha256Checksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional()
});
export type CompleteUploadRequest = z.infer<typeof CompleteUploadRequestSchema>;

export const AttachmentDetailResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  uploaderUserId: z.string().uuid().nullable(),
  fileName: z.string(),
  contentType: z.string(),
  detectedMimeType: z.string().nullable(),
  byteSize: z.number().int().positive(),
  sha256Checksum: z.string().nullable(),
  status: AttachmentStatusSchema,
  quarantineReason: z.string().nullable(),
  scannedAt: z.string().datetime({ offset: true }).nullable(),
  scannerName: z.string().nullable(),
  deletedAt: z.string().datetime({ offset: true }).nullable(),
  deletionReason: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});
export type AttachmentDetailResponse = z.infer<typeof AttachmentDetailResponseSchema>;

// M3-07: Authorized download URL generation
export const GenerateDownloadUrlResponseSchema = z.object({
  downloadUrl: z.string().url(),
  expiresAt: z.string().datetime({ offset: true })
});
export type GenerateDownloadUrlResponse = z.infer<typeof GenerateDownloadUrlResponseSchema>;

// M4: Knowledge ingestion, Bot Configuration and AI Draft schemas
export const KnowledgeSourceStateSchema = z.enum([
  "queued",
  "processing",
  "ready",
  "failed",
  "archived"
]);

export const KnowledgeSourceSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  type: z.enum(["text", "file", "url"]),
  name: z.string(),
  sourceUri: z.string().url().nullable(),
  status: KnowledgeSourceStateSchema,
  statusReason: z.string().nullable(),
  byteSize: z.number().int().nonnegative(),
  lastIndexedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});
export type KnowledgeSourceResponse = z.infer<typeof KnowledgeSourceSchema>;

export const ListKnowledgeSourcesResponseSchema = z.object({
  sources: z.array(KnowledgeSourceSchema)
});
export type ListKnowledgeSourcesResponse = z.infer<typeof ListKnowledgeSourcesResponseSchema>;

export const CreateKnowledgeSourceRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    name: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(500_000)
  }),
  z.object({
    type: z.literal("url"),
    name: z.string().trim().min(1).max(200),
    url: z.string().url().max(2_048)
  })
]);
export type CreateKnowledgeSourceRequest = z.infer<typeof CreateKnowledgeSourceRequestSchema>;

export const CreateKnowledgeSourceResponseSchema = z.object({
  source: KnowledgeSourceSchema,
  jobId: z.string().uuid()
});
export type CreateKnowledgeSourceResponse = z.infer<typeof CreateKnowledgeSourceResponseSchema>;

export const BotConfigSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  instructions: z.string(),
  tone: z.string(),
  language: z.string(),
  model: z.string(),
  confidenceThreshold: z.number().min(0).max(1),
  topK: z.number().int().positive(),
  mode: z.enum(["off", "draft"]),
  emergencyDisabled: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});
export type BotConfigResponse = z.infer<typeof BotConfigSchema>;

export const UpdateBotConfigRequestSchema = z.object({
  instructions: z.string().min(1).max(2000).optional(),
  tone: z.enum(["professional", "friendly", "concise", "formal"]).optional(),
  language: z.enum(["id", "en", "auto"]).optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  topK: z.number().int().min(1).max(10).optional(),
  mode: z.enum(["off", "draft"]).optional(),
  emergencyDisabled: z.boolean().optional()
});
export type UpdateBotConfigRequest = z.infer<typeof UpdateBotConfigRequestSchema>;

export const CitationSchema = z.object({
  chunkId: z.string(),
  documentTitle: z.string(),
  snippet: z.string(),
  score: z.number()
});
export type CitationResponse = z.infer<typeof CitationSchema>;

export const GenerateBotDraftResponseSchema = z.object({
  runId: z.string().uuid(),
  status: z.enum([
    "queued",
    "processing",
    "drafted",
    "no_evidence",
    "safety_blocked",
    "budget_exceeded",
    "provider_failed",
    "stale",
    "cancelled",
    "off"
  ]),
  suggestedContent: z.string(),
  citations: z.array(CitationSchema),
  confidence: z.number(),
  reasoning: z.string().optional(),
  sendable: z.boolean(),
  errorCode: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});
export type GenerateBotDraftResponse = z.infer<typeof GenerateBotDraftResponseSchema>;

export const BotDraftActionRequestSchema = z
  .object({
    action: z.enum(["approved", "edited", "rejected"]),
    editedContent: z.string().trim().min(1).max(4000).optional()
  })
  .superRefine((value, context) => {
    if (value.action === "edited" && !value.editedContent) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["editedContent"],
        message: "editedContent is required for an edited draft"
      });
    }
    if (value.action !== "edited" && value.editedContent !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["editedContent"],
        message: "editedContent is only accepted for an edited draft"
      });
    }
  });
export type BotDraftActionRequest = z.infer<typeof BotDraftActionRequestSchema>;

// M5: Routing Rules schemas
export const RoutingConditionSchema = z.object({
  channelId: z.string().uuid().optional(),
  tag: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
  intent: z.string().min(1).optional(),
  customerPhonePrefix: z.string().min(1).optional(),
  isWithinBusinessHours: z.boolean().optional()
});
export type RoutingCondition = z.infer<typeof RoutingConditionSchema>;

export const RoutingRuleSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(200),
  priority: z.number().int().min(0),
  conditions: RoutingConditionSchema,
  targetQueueId: z.string().uuid().nullable(),
  targetTeamId: z.string().uuid().nullable(),
  targetUserId: z.string().uuid().nullable(),
  isActive: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});
export type RoutingRuleResponse = z.infer<typeof RoutingRuleSchema>;

export const CreateRoutingRuleRequestSchema = z.object({
  name: z.string().min(1).max(200),
  priority: z.number().int().min(0).optional(),
  conditions: RoutingConditionSchema.optional(),
  targetQueueId: z.string().uuid().nullable().optional(),
  targetTeamId: z.string().uuid().nullable().optional(),
  targetUserId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional()
});
export type CreateRoutingRuleRequest = z.infer<typeof CreateRoutingRuleRequestSchema>;

export const UpdateRoutingRuleRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  priority: z.number().int().min(0).optional(),
  conditions: RoutingConditionSchema.optional(),
  targetQueueId: z.string().uuid().nullable().optional(),
  targetTeamId: z.string().uuid().nullable().optional(),
  targetUserId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional()
});
export type UpdateRoutingRuleRequest = z.infer<typeof UpdateRoutingRuleRequestSchema>;

export const ListRoutingRulesResponseSchema = z.array(RoutingRuleSchema);
export type ListRoutingRulesResponse = z.infer<typeof ListRoutingRulesResponseSchema>;

export const RoutingLogSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  conversationId: z.string().uuid(),
  matchedRuleId: z.string().uuid().nullable(),
  targetQueueId: z.string().uuid().nullable(),
  targetTeamId: z.string().uuid().nullable(),
  targetUserId: z.string().uuid().nullable(),
  reason: z.string(),
  routedAt: z.string().datetime({ offset: true })
});
export type RoutingLogResponse = z.infer<typeof RoutingLogSchema>;

export const ListRoutingLogsResponseSchema = z.array(RoutingLogSchema);
export type ListRoutingLogsResponse = z.infer<typeof ListRoutingLogsResponseSchema>;
