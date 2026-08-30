import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadAuthConfig } from "@flowdesk/config";
import type { DbClient } from "@flowdesk/db";
import { MockIdentityProvider } from "@flowdesk/providers";
import { hashSessionToken, serializeSessionCookie } from "@flowdesk/security";
import { createApiApp } from "./app.js";

function createMockDb(): DbClient {
  const users = new Map<
    string,
    { id: string; email: string; displayName: string; status: string }
  >();
  const sessions = new Map<
    string,
    { id: string; userId: string; tokenHash: string; expiresAt: Date; revokedAt: Date | null }
  >();
  const orgs = new Map<string, { id: string; slug: string; name: string }>();
  const roles = new Map<string, { id: string; orgId: string; key: string; label: string }>();
  const memberships = new Map<
    string,
    { id: string; orgId: string; userId: string; roleId: string; status: string; createdAt: Date }
  >();
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
  users.set("u1", {
    id: "u1",
    email: "alice@flowdesk.dev",
    displayName: "Alice",
    status: "active"
  });
  users.set("u2", { id: "u2", email: "bob@flowdesk.dev", displayName: "Bob", status: "active" });
  users.set("u3", {
    id: "u3",
    email: "charlie@flowdesk.dev",
    displayName: "Charlie",
    status: "active"
  });

  // Pre-populate sessions
  sessions.set(hashSessionToken("alice-token"), {
    id: "s1",
    userId: "u1",
    tokenHash: hashSessionToken("alice-token"),
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null
  });
  sessions.set(hashSessionToken("bob-token"), {
    id: "s2",
    userId: "u2",
    tokenHash: hashSessionToken("bob-token"),
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null
  });
  sessions.set(hashSessionToken("charlie-token"), {
    id: "s3",
    userId: "u3",
    tokenHash: hashSessionToken("charlie-token"),
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null
  });

  return {
    async query(queryText: string, values: unknown[] = []) {
      await Promise.resolve();
      const sql = queryText.replace(/\s+/g, " ").trim();

      // Session lookup: SELECT s.id, s.user_id, u.email, u.display_name, s.expires_at, s.created_at FROM flowdesk.auth_sessions s JOIN flowdesk.users u
      if (sql.includes("FROM flowdesk.auth_sessions s JOIN flowdesk.users u")) {
        const [tokenHash] = values as [string];
        const session = sessions.get(tokenHash);
        if (!session || session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) {
          return { rows: [] };
        }
        const user = users.get(session.userId);
        if (!user || user.status !== "active") {
          return { rows: [] };
        }
        return {
          rows: [
            {
              id: session.id,
              user_id: session.userId,
              email: user.email,
              display_name: user.displayName,
              expires_at: session.expiresAt,
              created_at: new Date()
            }
          ]
        };
      }

      // SELECT * FROM flowdesk.bootstrap_organization($1, $2, $3)
      if (sql.includes("bootstrap_organization")) {
        const [slug, name, userId] = values as [string, string, string];
        if ([...orgs.values()].some((organization) => organization.slug === slug)) {
          throw Object.assign(new Error("duplicate key value violates unique constraint"), {
            code: "23505",
            constraint: "organizations_slug_key"
          });
        }
        const orgId = `00000000-0000-7000-8000-${String(orgs.size + 1).padStart(12, "0")}`;
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

      // SELECT count(*) AS count FROM flowdesk.memberships
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

      // SELECT r.key AS role_key, m.status FROM flowdesk.memberships m JOIN flowdesk.roles r ON m.role_id = r.id WHERE m.organization_id = $1 AND m.id = $2
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

      // SELECT m.id, r.key AS role_key, m.status FROM flowdesk.memberships m JOIN flowdesk.roles r ... WHERE m.organization_id = $1 AND m.user_id = $2 AND m.status = 'active'
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

      if (sql.includes("INSERT INTO flowdesk.audit_logs")) {
        return { rows: [{ id: randomUUID(), occurred_at: new Date() }] };
      }

      return { rows: [] };
    }
  } as unknown as DbClient;
}

describe("API Organizations and Memberships (M1-05)", () => {
  const db = createMockDb();
  const config = loadAuthConfig({
    AUTH_COOKIE_SECURE: "false",
    AUTH_MOCK_ENABLED: "true"
  });

  const app = createApiApp({
    service: "api",
    version: "test",
    gitSha: "test-sha",
    environment: "local",
    auth: {
      db,
      config,
      identityProvider: new MockIdentityProvider()
    }
  });

  const aliceCookie = serializeSessionCookie("alice-token", false);
  const bobCookie = serializeSessionCookie("bob-token", false);
  const charlieCookie = serializeSessionCookie("charlie-token", false);

  let orgId = "";
  let aliceMemberId = "";
  let inviteToken = "";

  it("POST /api/v1/organizations fails without authentication", async () => {
    const res = await request(app)
      .post("/api/v1/organizations")
      .send({ name: "FlowDesk Team", slug: "flowdesk-team" })
      .expect(401);

    const body = res.body as { code: string };
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("POST /api/v1/organizations fails with invalid slug format", async () => {
    const res = await request(app)
      .post("/api/v1/organizations")
      .set("Cookie", aliceCookie)
      .send({ name: "Bad Org", slug: "-invalid-slug" })
      .expect(400);

    const body = res.body as { code: string };
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("POST /api/v1/organizations successfully bootstraps new organization", async () => {
    const res = await request(app)
      .post("/api/v1/organizations")
      .set("Cookie", aliceCookie)
      .send({ name: "Acme Corp", slug: "acme-corp" })
      .expect(201);

    const body = res.body as {
      organization: {
        id: string;
        slug: string;
        displayName: string;
        ownerRoleId: string;
        membershipId: string;
      };
    };

    expect(body.organization.slug).toBe("acme-corp");
    expect(body.organization.displayName).toBe("Acme Corp");
    expect(body.organization.id).toBeDefined();

    orgId = body.organization.id;
    aliceMemberId = body.organization.membershipId;
  });

  it("POST /api/v1/organizations returns a useful conflict for a duplicate slug", async () => {
    const res = await request(app)
      .post("/api/v1/organizations")
      .set("Cookie", aliceCookie)
      .send({ name: "Another Acme", slug: "acme-corp" })
      .expect(409);

    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.body).toMatchObject({
      code: "ORGANIZATION_SLUG_CONFLICT",
      status: 409,
      detail: "Choose a different organization slug and try again."
    });
  });

  it("POST /api/v1/organizations/:orgId/invitations denies non-member", async () => {
    const res = await request(app)
      .post(`/api/v1/organizations/${orgId}/invitations`)
      .set("Cookie", bobCookie)
      .send({ email: "dave@flowdesk.dev", role: "agent" })
      .expect(403);

    const body = res.body as { code: string };
    expect(body.code).toBe("NOT_A_MEMBER");
  });

  it("POST /api/v1/organizations/:orgId/invitations allows owner to invite an agent", async () => {
    const res = await request(app)
      .post(`/api/v1/organizations/${orgId}/invitations`)
      .set("Cookie", aliceCookie)
      .send({ email: "bob@flowdesk.dev", role: "agent" })
      .expect(201);

    const body = res.body as {
      invitation: {
        id: string;
        email: string;
        role: string;
        status: string;
        inviteToken: string;
      };
    };

    expect(body.invitation.email).toBe("bob@flowdesk.dev");
    expect(body.invitation.role).toBe("agent");
    expect(body.invitation.inviteToken).toBeDefined();

    inviteToken = body.invitation.inviteToken;
  });

  it("POST /api/v1/invitations/accept accepts invitation for logged-in user", async () => {
    const res = await request(app)
      .post("/api/v1/invitations/accept")
      .set("Cookie", bobCookie)
      .send({ token: inviteToken })
      .expect(200);

    const body = res.body as { status: string; organizationId: string; membershipId: string };
    expect(body.status).toBe("ok");
    expect(body.organizationId).toBe(orgId);
  });

  it("POST /api/v1/invitations/accept fails on replayed token", async () => {
    const res = await request(app)
      .post("/api/v1/invitations/accept")
      .set("Cookie", charlieCookie)
      .send({ token: inviteToken })
      .expect(400);

    const body = res.body as { code: string };
    expect(body.code).toBe("INVITATION_INVALID");
  });

  it("POST /api/v1/organizations/:orgId/invitations denies agent without membership:invite", async () => {
    // Bob is now an agent in Acme Corp, agents cannot invite
    const res = await request(app)
      .post(`/api/v1/organizations/${orgId}/invitations`)
      .set("Cookie", bobCookie)
      .send({ email: "charlie@flowdesk.dev", role: "analyst" })
      .expect(403);

    const body = res.body as { code: string };
    expect(body.code).toBe("FORBIDDEN");
  });

  it("GET /api/v1/organizations/:orgId/members lists organization members", async () => {
    const res = await request(app)
      .get(`/api/v1/organizations/${orgId}/members`)
      .set("Cookie", bobCookie)
      .expect(200);

    const body = res.body as { members: Array<{ email: string; roleKey: string }> };
    expect(body.members.length).toBe(2);
    expect(
      body.members.some((m) => m.email === "alice@flowdesk.dev" && m.roleKey === "owner")
    ).toBe(true);
    expect(body.members.some((m) => m.email === "bob@flowdesk.dev" && m.roleKey === "agent")).toBe(
      true
    );
  });

  it("PATCH /api/v1/organizations/:orgId/members/:memberId enforces last-owner protection", async () => {
    // Alice is the sole owner. Demoting Alice must fail!
    const res = await request(app)
      .patch(`/api/v1/organizations/${orgId}/members/${aliceMemberId}`)
      .set("Cookie", aliceCookie)
      .send({ role: "admin" })
      .expect(400);

    const body = res.body as { code: string };
    expect(body.code).toBe("LAST_OWNER_PROTECTION_VIOLATION");
  });

  it("DELETE /api/v1/organizations/:orgId/members/:memberId enforces last-owner protection", async () => {
    // Alice is the sole owner. Removing Alice must fail!
    const res = await request(app)
      .delete(`/api/v1/organizations/${orgId}/members/${aliceMemberId}`)
      .set("Cookie", aliceCookie)
      .expect(400);

    const body = res.body as { code: string };
    expect(body.code).toBe("LAST_OWNER_PROTECTION_VIOLATION");
  });

  it("DELETE /api/v1/organizations/:orgId/invitations/:inviteId revokes invitation", async () => {
    // 1. Create invite for Charlie
    const inviteRes = await request(app)
      .post(`/api/v1/organizations/${orgId}/invitations`)
      .set("Cookie", aliceCookie)
      .send({ email: "charlie@flowdesk.dev", role: "analyst" })
      .expect(201);

    const inviteData = (inviteRes.body as { invitation: { id: string } }).invitation;

    // 2. Revoke invite
    const revokeRes = await request(app)
      .delete(`/api/v1/organizations/${orgId}/invitations/${inviteData.id}`)
      .set("Cookie", aliceCookie)
      .expect(200);

    const revokeBody = revokeRes.body as { status: string };
    expect(revokeBody.status).toBe("ok");

    // 3. Revoking non-existent invite returns 404
    const notFoundRes = await request(app)
      .delete(`/api/v1/organizations/${orgId}/invitations/invalid-id`)
      .set("Cookie", aliceCookie)
      .expect(404);

    const notFoundBody = notFoundRes.body as { code: string };
    expect(notFoundBody.code).toBe("INVITATION_NOT_FOUND");
  });

  it("GET /api/v1/organizations lists organizations for authenticated user", async () => {
    const res = await request(app)
      .get("/api/v1/organizations")
      .set("Cookie", aliceCookie)
      .expect(200);

    const body = res.body as {
      organizations: Array<{ id: string; slug: string; name: string; role: string }>;
    };
    expect(body.organizations.length).toBeGreaterThanOrEqual(1);
    expect(body.organizations[0]?.role).toBe("owner");
  });
});
