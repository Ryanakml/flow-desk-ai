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
