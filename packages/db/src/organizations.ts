import type { DbClient } from "./auth.js";

export class LastOwnerProtectionError extends Error {
  constructor(message = "Cannot remove or demote the last active owner of an organization") {
    super(message);
    this.name = "LastOwnerProtectionError";
  }
}

export interface BootstrapOrganizationInput {
  name: string;
  slug: string;
  userId: string;
}

export interface BootstrapOrganizationResult {
  organizationId: string;
  slug: string;
  displayName: string;
  ownerRoleId: string;
  membershipId: string;
}

export interface CreateInvitationInput {
  organizationId: string;
  email: string;
  roleKey: string;
  tokenHash: string;
  invitedByUserId: string;
  ttlHours?: number;
}

export interface InvitationRecord {
  id: string;
  organizationId: string;
  email: string;
  roleKey: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: Date;
}

export interface MembershipRecord {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  roleKey: string;
  roleLabel: string;
  status: "invited" | "active" | "suspended" | "revoked";
  createdAt: Date;
}

export async function bootstrapOrganization(
  db: DbClient,
  input: BootstrapOrganizationInput
): Promise<BootstrapOrganizationResult> {
  const result = await db.query<{
    organization_id: string;
    slug: string;
    display_name: string;
    owner_role_id: string;
    membership_id: string;
  }>("SELECT * FROM flowdesk.bootstrap_organization($1, $2, $3)", [
    input.slug,
    input.name,
    input.userId
  ]);

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to bootstrap organization");
  }

  return {
    organizationId: row.organization_id,
    slug: row.slug,
    displayName: row.display_name,
    ownerRoleId: row.owner_role_id,
    membershipId: row.membership_id
  };
}

export async function createInvitation(
  db: DbClient,
  input: CreateInvitationInput
): Promise<InvitationRecord> {
  // 1. Resolve role_id from roleKey in this organization
  const roleRes = await db.query<{ id: string }>(
    "SELECT id FROM flowdesk.roles WHERE organization_id = $1 AND key = $2",
    [input.organizationId, input.roleKey]
  );
  const roleRow = roleRes.rows[0];
  if (!roleRow) {
    throw new Error(`Role ${input.roleKey} not found for organization`);
  }

  const ttlHours = input.ttlHours ?? 72; // default 3 days expiry
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  const insertRes = await db.query<{ id: string; status: string; expires_at: Date }>(
    `INSERT INTO flowdesk.invitations (
      organization_id, email, role_id, token_hash, invited_by_user_id, status, expires_at
    ) VALUES ($1, $2, $3, $4, $5, 'pending', $6)
    RETURNING id, status, expires_at`,
    [
      input.organizationId,
      input.email.toLowerCase(),
      roleRow.id,
      input.tokenHash,
      input.invitedByUserId,
      expiresAt
    ]
  );

  const inv = insertRes.rows[0];
  if (!inv) {
    throw new Error("Failed to insert invitation");
  }

  return {
    id: inv.id,
    organizationId: input.organizationId,
    email: input.email.toLowerCase(),
    roleKey: input.roleKey,
    status: inv.status as InvitationRecord["status"],
    expiresAt: inv.expires_at
  };
}

export async function consumeInvitation(
  db: DbClient,
  input: { tokenHash: string; userId: string }
): Promise<{ organizationId: string; roleId: string; membershipId: string } | null> {
  const res = await db.query<{
    organization_id: string;
    role_id: string;
    membership_id: string;
  }>("SELECT * FROM flowdesk.consume_invitation($1, $2)", [input.tokenHash, input.userId]);

  const row = res.rows[0];
  if (!row) return null;

  return {
    organizationId: row.organization_id,
    roleId: row.role_id,
    membershipId: row.membership_id
  };
}

export async function revokeInvitation(
  db: DbClient,
  input: { organizationId: string; invitationId: string }
): Promise<boolean> {
  const res = await db.query(
    `UPDATE flowdesk.invitations
     SET status = 'revoked', revoked_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE organization_id = $1 AND id = $2 AND status = 'pending'`,
    [input.organizationId, input.invitationId]
  );

  return (res.rowCount ?? 0) > 0;
}

export async function listMemberships(
  db: DbClient,
  organizationId: string
): Promise<MembershipRecord[]> {
  const res = await db.query<{
    id: string;
    user_id: string;
    email: string;
    display_name: string;
    role_key: string;
    role_label: string;
    status: string;
    created_at: Date;
  }>(
    `SELECT m.id, m.user_id, u.email, u.display_name, r.key AS role_key, r.label AS role_label, m.status, m.created_at
     FROM flowdesk.memberships m
     JOIN flowdesk.users u ON m.user_id = u.id
     JOIN flowdesk.roles r ON m.role_id = r.id
     WHERE m.organization_id = $1 AND m.status != 'revoked'
     ORDER BY m.created_at ASC`,
    [organizationId]
  );

  return res.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    roleKey: row.role_key,
    roleLabel: row.role_label,
    status: row.status as MembershipRecord["status"],
    createdAt: row.created_at
  }));
}

export async function getMemberRole(
  db: DbClient,
  input: { organizationId: string; userId: string }
): Promise<{ membershipId: string; roleKey: string; status: string } | null> {
  const res = await db.query<{
    id: string;
    role_key: string;
    status: string;
  }>(
    `SELECT m.id, r.key AS role_key, m.status
     FROM flowdesk.memberships m
     JOIN flowdesk.roles r ON m.role_id = r.id
     WHERE m.organization_id = $1 AND m.user_id = $2 AND m.status = 'active'`,
    [input.organizationId, input.userId]
  );

  const row = res.rows[0];
  if (!row) return null;

  return {
    membershipId: row.id,
    roleKey: row.role_key,
    status: row.status
  };
}

async function countActiveOwners(db: DbClient, organizationId: string): Promise<number> {
  const res = await db.query<{ count: string | number }>(
    `SELECT count(*) AS count
     FROM flowdesk.memberships m
     JOIN flowdesk.roles r ON m.role_id = r.id
     WHERE m.organization_id = $1 AND r.key = 'owner' AND m.status = 'active'`,
    [organizationId]
  );
  return Number(res.rows[0]?.count ?? 0);
}

export async function updateMembershipRole(
  db: DbClient,
  input: { organizationId: string; membershipId: string; newRoleKey: string }
): Promise<{ membershipId: string; roleKey: string }> {
  // 1. Fetch current membership role
  const currentRes = await db.query<{ role_key: string; status: string }>(
    `SELECT r.key AS role_key, m.status
     FROM flowdesk.memberships m
     JOIN flowdesk.roles r ON m.role_id = r.id
     WHERE m.organization_id = $1 AND m.id = $2`,
    [input.organizationId, input.membershipId]
  );
  const current = currentRes.rows[0];
  if (!current) {
    throw new Error("Membership not found");
  }

  // 2. Last-owner protection: if demoting an active owner
  if (current.role_key === "owner" && input.newRoleKey !== "owner" && current.status === "active") {
    const ownerCount = await countActiveOwners(db, input.organizationId);
    if (ownerCount <= 1) {
      throw new LastOwnerProtectionError("Cannot demote the last active owner of an organization");
    }
  }

  // 3. Resolve target role ID
  const roleRes = await db.query<{ id: string }>(
    "SELECT id FROM flowdesk.roles WHERE organization_id = $1 AND key = $2",
    [input.organizationId, input.newRoleKey]
  );
  const targetRole = roleRes.rows[0];
  if (!targetRole) {
    throw new Error(`Role ${input.newRoleKey} not found for organization`);
  }

  await db.query(
    `UPDATE flowdesk.memberships
     SET role_id = $1, updated_at = clock_timestamp()
     WHERE organization_id = $2 AND id = $3`,
    [targetRole.id, input.organizationId, input.membershipId]
  );

  return {
    membershipId: input.membershipId,
    roleKey: input.newRoleKey
  };
}

export async function revokeMembership(
  db: DbClient,
  input: { organizationId: string; membershipId: string }
): Promise<boolean> {
  // 1. Fetch current role
  const currentRes = await db.query<{ role_key: string; status: string }>(
    `SELECT r.key AS role_key, m.status
     FROM flowdesk.memberships m
     JOIN flowdesk.roles r ON m.role_id = r.id
     WHERE m.organization_id = $1 AND m.id = $2`,
    [input.organizationId, input.membershipId]
  );
  const current = currentRes.rows[0];
  if (!current) {
    return false;
  }

  // 2. Last-owner protection: if revoking an active owner
  if (current.role_key === "owner" && current.status === "active") {
    const ownerCount = await countActiveOwners(db, input.organizationId);
    if (ownerCount <= 1) {
      throw new LastOwnerProtectionError("Cannot remove the last active owner of an organization");
    }
  }

  const res = await db.query(
    `UPDATE flowdesk.memberships
     SET status = 'revoked', revoked_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE organization_id = $1 AND id = $2 AND status != 'revoked'`,
    [input.organizationId, input.membershipId]
  );

  return (res.rowCount ?? 0) > 0;
}

export interface UserOrganizationRecord {
  id: string;
  slug: string;
  name: string;
  roleKey: string;
  membershipId: string;
}

export async function listUserOrganizations(
  db: DbClient,
  userId: string
): Promise<UserOrganizationRecord[]> {
  const result = await db.query<{
    id: string;
    slug: string;
    display_name: string;
    role_key: string;
    membership_id: string;
  }>("SELECT * FROM flowdesk.list_user_organizations($1)", [userId]);

  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.display_name,
    roleKey: row.role_key,
    membershipId: row.membership_id
  }));
}

export async function listActiveOrganizationIds(db: DbClient): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    "SELECT id FROM flowdesk.list_active_organization_ids()"
  );
  return result.rows.map((row) => row.id);
}
