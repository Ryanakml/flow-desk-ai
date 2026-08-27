import { describe, expect, it } from "vitest";
import type { DbClient } from "./auth.js";
import {
  bootstrapOrganization,
  createInvitation,
  consumeInvitation,
  revokeInvitation,
  listMemberships,
  getMemberRole,
  updateMembershipRole,
  revokeMembership,
  listUserOrganizations,
  LastOwnerProtectionError
} from "./organizations.js";

function createMockDb(): DbClient {
  const orgs = new Map<string, { id: string; slug: string; name: string }>();
  const roles = new Map<string, { id: string; orgId: string; key: string; label: string }>();
  const memberships = new Map<
    string,
    { id: string; orgId: string; userId: string; roleId: string; status: string; createdAt: Date }
  >();
  const users = new Map<string, { id: string; email: string; displayName: string }>();
  const invitations = new Map<
    string,
    {
      id: string;
      orgId: string;
      email: string;
      roleId: string;
      tokenHash: string;
      status: string;
      expiresAt: Date;
    }
  >();

  // Pre-populate users
  users.set("u1", { id: "u1", email: "alice@flowdesk.dev", displayName: "Alice" });
  users.set("u2", { id: "u2", email: "bob@flowdesk.dev", displayName: "Bob" });

  return {
    async query(queryText: string, values: unknown[] = []) {
      await Promise.resolve();
      const sql = queryText.replace(/\s+/g, " ").trim();

      // SELECT * FROM flowdesk.bootstrap_organization($1, $2, $3)
      if (sql.includes("bootstrap_organization")) {
        const [slug, name, userId] = values as [string, string, string];
        const orgId = `org-${orgs.size + 1}`;
        orgs.set(orgId, { id: orgId, slug, name });

        const ownerRoleId = `role-${roles.size + 1}`;
        roles.set(ownerRoleId, { id: ownerRoleId, orgId, key: "owner", label: "Owner" });
        roles.set(`role-${roles.size + 1}`, {
          id: `role-${roles.size + 1}`,
          orgId,
          key: "admin",
          label: "Administrator"
        });
        roles.set(`role-${roles.size + 1}`, {
          id: `role-${roles.size + 1}`,
          orgId,
          key: "supervisor",
          label: "Supervisor"
        });
        roles.set(`role-${roles.size + 1}`, {
          id: `role-${roles.size + 1}`,
          orgId,
          key: "agent",
          label: "Agent"
        });
        roles.set(`role-${roles.size + 1}`, {
          id: `role-${roles.size + 1}`,
          orgId,
          key: "analyst",
          label: "Analyst"
        });
        roles.set(`role-${roles.size + 1}`, {
          id: `role-${roles.size + 1}`,
          orgId,
          key: "billing_admin",
          label: "Billing Administrator"
        });

        const membershipId = `mem-${memberships.size + 1}`;
        memberships.set(membershipId, {
          id: membershipId,
          orgId,
          userId,
          roleId: ownerRoleId,
          status: "active",
          createdAt: new Date()
        });

        return {
          rows: [
            {
              organization_id: orgId,
              slug,
              display_name: name,
              owner_role_id: ownerRoleId,
              membership_id: membershipId
            }
          ]
        };
      }

      // SELECT id FROM flowdesk.roles WHERE organization_id = $1 AND key = $2
      if (sql.includes("FROM flowdesk.roles WHERE organization_id = $1 AND key = $2")) {
        const [orgId, key] = values as [string, string];
        for (const role of roles.values()) {
          if (role.orgId === orgId && role.key === key) {
            return { rows: [{ id: role.id }] };
          }
        }
        return { rows: [] };
      }

      // INSERT INTO flowdesk.invitations
      if (sql.includes("INSERT INTO flowdesk.invitations")) {
        const [orgId, email, roleId, tokenHash, , expiresAt] = values as [
          string,
          string,
          string,
          string,
          string,
          Date
        ];
        const id = `inv-${invitations.size + 1}`;
        invitations.set(id, {
          id,
          orgId,
          email,
          roleId,
          tokenHash,
          status: "pending",
          expiresAt
        });
        return { rows: [{ id, status: "pending", expires_at: expiresAt }] };
      }

      // SELECT * FROM flowdesk.consume_invitation($1, $2)
      if (sql.includes("consume_invitation")) {
        const [tokenHash, userId] = values as [string, string];
        for (const inv of invitations.values()) {
          if (
            inv.tokenHash === tokenHash &&
            inv.status === "pending" &&
            inv.expiresAt.getTime() > Date.now()
          ) {
            inv.status = "accepted";
            const memId = `mem-${memberships.size + 1}`;
            memberships.set(memId, {
              id: memId,
              orgId: inv.orgId,
              userId,
              roleId: inv.roleId,
              status: "active",
              createdAt: new Date()
            });
            return {
              rows: [
                {
                  organization_id: inv.orgId,
                  role_id: inv.roleId,
                  membership_id: memId
                }
              ]
            };
          }
        }
        return { rows: [] };
      }

      // UPDATE flowdesk.invitations (revoke)
      if (sql.includes("UPDATE flowdesk.invitations") && sql.includes("status = 'revoked'")) {
        const [orgId, invId] = values as [string, string];
        const inv = invitations.get(invId);
        if (inv && inv.orgId === orgId && inv.status === "pending") {
          inv.status = "revoked";
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      }

      // SELECT count(*) AS count FROM flowdesk.memberships m JOIN flowdesk.roles r ...
      if (sql.includes("count(*) AS count FROM flowdesk.memberships")) {
        const [orgId] = values as [string];
        let count = 0;
        for (const mem of memberships.values()) {
          if (mem.orgId === orgId && mem.status === "active") {
            const role = roles.get(mem.roleId);
            if (role?.key === "owner") {
              count++;
            }
          }
        }
        return { rows: [{ count }] };
      }

      // SELECT r.key AS role_key, m.status FROM flowdesk.memberships m JOIN flowdesk.roles r ...
      if (
        sql.includes(
          "FROM flowdesk.memberships m JOIN flowdesk.roles r ON m.role_id = r.id WHERE m.organization_id = $1 AND m.id = $2"
        )
      ) {
        const [orgId, memId] = values as [string, string];
        const mem = memberships.get(memId);
        if (mem && mem.orgId === orgId) {
          const role = roles.get(mem.roleId);
          return { rows: [{ role_key: role?.key ?? "", status: mem.status }] };
        }
        return { rows: [] };
      }

      // SELECT m.id, r.key AS role_key, m.status FROM flowdesk.memberships m JOIN flowdesk.roles r WHERE m.organization_id = $1 AND m.user_id = $2 AND m.status = 'active'
      if (sql.includes("WHERE m.organization_id = $1 AND m.user_id = $2 AND m.status = 'active'")) {
        const [orgId, userId] = values as [string, string];
        for (const mem of memberships.values()) {
          if (mem.orgId === orgId && mem.userId === userId && mem.status === "active") {
            const role = roles.get(mem.roleId);
            return { rows: [{ id: mem.id, role_key: role?.key ?? "", status: mem.status }] };
          }
        }
        return { rows: [] };
      }

      // SELECT m.id, m.user_id, u.email, u.display_name, r.key AS role_key ... FROM flowdesk.memberships
      if (
        sql.includes(
          "FROM flowdesk.memberships m JOIN flowdesk.users u ON m.user_id = u.id JOIN flowdesk.roles r ON m.role_id = r.id"
        )
      ) {
        const [orgId] = values as [string];
        const rows: unknown[] = [];
        for (const mem of memberships.values()) {
          if (mem.orgId === orgId && mem.status !== "revoked") {
            const user = users.get(mem.userId);
            const role = roles.get(mem.roleId);
            rows.push({
              id: mem.id,
              user_id: mem.userId,
              email: user?.email ?? "",
              display_name: user?.displayName ?? "",
              role_key: role?.key ?? "",
              role_label: role?.label ?? "",
              status: mem.status,
              created_at: mem.createdAt
            });
          }
        }
        return { rows };
      }

      // SELECT o.id, o.slug, o.display_name, r.key AS role_key, m.id AS membership_id FROM flowdesk.organizations o JOIN flowdesk.memberships m
      if (sql.includes("FROM flowdesk.organizations o JOIN flowdesk.memberships m")) {
        const [userId] = values as [string];
        const rows: unknown[] = [];
        for (const mem of memberships.values()) {
          if (mem.userId === userId && mem.status === "active") {
            const org = orgs.get(mem.orgId);
            const role = roles.get(mem.roleId);
            if (org && role) {
              rows.push({
                id: org.id,
                slug: org.slug,
                display_name: org.name,
                role_key: role.key,
                membership_id: mem.id
              });
            }
          }
        }
        return { rows };
      }

      // UPDATE flowdesk.memberships SET role_id = $1
      if (sql.includes("UPDATE flowdesk.memberships SET role_id = $1")) {
        const [newRoleId, orgId, memId] = values as [string, string, string];
        const mem = memberships.get(memId);
        if (mem && mem.orgId === orgId) {
          mem.roleId = newRoleId;
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      }

      // UPDATE flowdesk.memberships SET status = 'revoked'
      if (sql.includes("UPDATE flowdesk.memberships SET status = 'revoked'")) {
        const [orgId, memId] = values as [string, string];
        const mem = memberships.get(memId);
        if (mem && mem.orgId === orgId && mem.status !== "revoked") {
          mem.status = "revoked";
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      }

      return { rows: [] };
    }
  } as unknown as DbClient;
}

describe("Organizations and Memberships DB repository (M1-05)", () => {
  const db = createMockDb();
  let orgId = "";
  let ownerMemId = "";

  it("bootstraps organization with standard roles and initial owner", async () => {
    const result = await bootstrapOrganization(db, {
      name: "Acme Corp",
      slug: "acme-corp",
      userId: "u1"
    });

    expect(result.slug).toBe("acme-corp");
    expect(result.displayName).toBe("Acme Corp");
    expect(result.organizationId).toBeTruthy();
    expect(result.membershipId).toBeTruthy();

    orgId = result.organizationId;
    ownerMemId = result.membershipId;

    const role = await getMemberRole(db, { organizationId: orgId, userId: "u1" });
    expect(role?.roleKey).toBe("owner");
    expect(role?.status).toBe("active");
  });

  it("creates, accepts, and revokes invitations", async () => {
    const invite = await createInvitation(db, {
      organizationId: orgId,
      email: "bob@flowdesk.dev",
      roleKey: "agent",
      tokenHash: "invite-token-hash-1",
      invitedByUserId: "u1"
    });

    expect(invite.email).toBe("bob@flowdesk.dev");
    expect(invite.roleKey).toBe("agent");
    expect(invite.status).toBe("pending");

    // Accept invitation as user u2 (Bob)
    const accepted = await consumeInvitation(db, {
      tokenHash: "invite-token-hash-1",
      userId: "u2"
    });

    expect(accepted).not.toBeNull();
    expect(accepted?.organizationId).toBe(orgId);

    // Verify Bob is now an active agent
    const bobRole = await getMemberRole(db, { organizationId: orgId, userId: "u2" });
    expect(bobRole?.roleKey).toBe("agent");

    // Creating another invite to test revocation
    const invite2 = await createInvitation(db, {
      organizationId: orgId,
      email: "carol@flowdesk.dev",
      roleKey: "analyst",
      tokenHash: "invite-token-hash-2",
      invitedByUserId: "u1"
    });

    const revoked = await revokeInvitation(db, {
      organizationId: orgId,
      invitationId: invite2.id
    });
    expect(revoked).toBe(true);

    // Consuming revoked invite should return null
    const failAccept = await consumeInvitation(db, {
      tokenHash: "invite-token-hash-2",
      userId: "u3"
    });
    expect(failAccept).toBeNull();
  });

  it("lists active members of the organization", async () => {
    const members = await listMemberships(db, orgId);
    expect(members.length).toBe(2);
    expect(members[0]?.email).toBe("alice@flowdesk.dev");
    expect(members[0]?.roleKey).toBe("owner");
    expect(members[1]?.email).toBe("bob@flowdesk.dev");
    expect(members[1]?.roleKey).toBe("agent");
  });

  it("enforces last-owner protection when demoting or removing the single owner", async () => {
    // Demoting Alice (the only owner) to admin should throw LastOwnerProtectionError
    await expect(
      updateMembershipRole(db, {
        organizationId: orgId,
        membershipId: ownerMemId,
        newRoleKey: "admin"
      })
    ).rejects.toThrow(LastOwnerProtectionError);

    // Revoking Alice (the only owner) should throw LastOwnerProtectionError
    await expect(
      revokeMembership(db, {
        organizationId: orgId,
        membershipId: ownerMemId
      })
    ).rejects.toThrow(LastOwnerProtectionError);
  });

  it("allows updating role of non-owner members", async () => {
    const members = await listMemberships(db, orgId);
    const bob = members.find((m) => m.email === "bob@flowdesk.dev")!;

    const updated = await updateMembershipRole(db, {
      organizationId: orgId,
      membershipId: bob.id,
      newRoleKey: "supervisor"
    });
    expect(updated.roleKey).toBe("supervisor");

    // Revoking Bob should succeed
    const revoked = await revokeMembership(db, {
      organizationId: orgId,
      membershipId: bob.id
    });
    expect(revoked).toBe(true);
  });

  it("lists organizations where a user is an active member", async () => {
    const orgs = await listUserOrganizations(db, "u1");
    expect(orgs.length).toBe(1);
    expect(orgs[0]?.name).toBe("Acme Corp");
    expect(orgs[0]?.roleKey).toBe("owner");
  });
});
