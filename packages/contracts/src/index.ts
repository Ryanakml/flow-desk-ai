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
