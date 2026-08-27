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
    { id: string; orgId: string; userId: string; roleId: string; status: string }
  >();
  const invitations = new Map<
    string,
    { id: string; orgId: string; email: string; roleId: string }
  >();
  const idempotencyKeys = new Map<
    string,
    {
      id: string;
      orgId: string;
      actorUserId: string;
      route: string;
      key: string;
      fingerprint: string;
      responseStatus: number | null;
      responseBody: unknown;
      completedAt: Date | null;
      expiresAt: Date;
    }
  >();

  const orgId = "a0000000-0000-4000-8000-000000000001";
  const userId = "u1";
  users.set(userId, {
    id: userId,
    email: "owner@flowdesk.dev",
    displayName: "Owner",
    status: "active"
  });
  orgs.set(orgId, { id: orgId, slug: "test-org", name: "Test Org" });
  roles.set("role-owner", { id: "role-owner", orgId, key: "owner", label: "Owner" });
  roles.set("role-agent", { id: "role-agent", orgId, key: "agent", label: "Agent" });
  memberships.set("mem-1", { id: "mem-1", orgId, userId, roleId: "role-owner", status: "active" });

  sessions.set(hashSessionToken("owner-token"), {
    id: "s1",
    userId,
    tokenHash: hashSessionToken("owner-token"),
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null
  });

  const makeIdempKey = (o: string, a: string, r: string, k: string) => `${o}:${a}:${r}:${k}`;

  return {
    async query(queryText: string, values: unknown[] = []) {
      await Promise.resolve();
      const sql = queryText.replace(/\s+/g, " ").trim();

      // Session lookup
      if (sql.includes("FROM flowdesk.auth_sessions s JOIN flowdesk.users u")) {
        const [tokenHash] = values as [string];
        const session = sessions.get(tokenHash);
        if (!session || session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) {
          return { rows: [] };
        }
        const user = users.get(session.userId);
        return {
          rows: [
            {
              id: session.id,
              user_id: session.userId,
              email: user!.email,
              display_name: user!.displayName,
              expires_at: session.expiresAt,
              created_at: new Date()
            }
          ]
        };
      }

      // Member role check
      if (sql.includes("WHERE m.organization_id = $1 AND m.user_id = $2 AND m.status = 'active'")) {
        return { rows: [{ id: "mem-1", role_key: "owner", status: "active" }] };
      }

      // Resolve role ID
      if (sql.includes("FROM flowdesk.roles WHERE organization_id = $1 AND key = $2")) {
        return { rows: [{ id: "role-agent" }] };
      }

      // Idempotency check: SELECT id, request_fingerprint...
      if (sql.startsWith("SELECT") && sql.includes("FROM flowdesk.idempotency_keys")) {
        const [o, a, r, k] = values as [string, string, string, string];
        const row = idempotencyKeys.get(makeIdempKey(o, a, r, k));
        if (!row) {
          return { rows: [] };
        }
        return {
          rows: [
            {
              id: row.id,
              request_fingerprint: row.fingerprint,
              response_status: row.responseStatus,
              response_body: row.responseBody,
              completed_at: row.completedAt,
              expires_at: row.expiresAt
            }
          ]
        };
      }

      // Idempotency insert: INSERT INTO flowdesk.idempotency_keys
      if (sql.includes("INSERT INTO flowdesk.idempotency_keys")) {
        const [o, a, r, k, fp] = values as [string, string, string, string, string];
        const key = makeIdempKey(o, a, r, k);
        if (idempotencyKeys.has(key)) {
          const err = new Error("unique_violation") as Error & { code: string };
          err.code = "23505";
          throw err;
        }
        idempotencyKeys.set(key, {
          id: `idemp-${idempotencyKeys.size + 1}`,
          orgId: o,
          actorUserId: a,
          route: r,
          key: k,
          fingerprint: fp,
          responseStatus: null,
          responseBody: null,
          completedAt: null,
          expiresAt: new Date(Date.now() + 86400000)
        });
        return { rowCount: 1 };
      }

      // Idempotency complete: UPDATE flowdesk.idempotency_keys
      if (
        sql.includes("UPDATE flowdesk.idempotency_keys") &&
        sql.includes("completed_at = clock_timestamp()")
      ) {
        const [status, bodyJson, o, a, r, k] = values as [
          number,
          string,
          string,
          string,
          string,
          string
        ];
        const row = idempotencyKeys.get(makeIdempKey(o, a, r, k));
        if (row) {
          row.responseStatus = status;
          row.responseBody = JSON.parse(bodyJson);
          row.completedAt = new Date();
        }
        return { rowCount: 1 };
      }

      // Insert invitation
      if (sql.includes("INSERT INTO flowdesk.invitations")) {
        const [o, email, roleId] = values as [string, string, string];
        const id = `inv-${invitations.size + 1}`;
        invitations.set(id, { id, orgId: o, email, roleId });
        return { rows: [{ id, status: "pending", expires_at: new Date() }] };
      }

      // Insert audit log
      if (sql.includes("INSERT INTO flowdesk.audit_logs")) {
        return { rows: [{ id: "audit-1", occurred_at: new Date() }] };
      }

      return { rows: [] };
    }
  } as unknown as DbClient;
}

describe("API Idempotency Middleware (M1-06)", () => {
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

  const ownerCookie = serializeSessionCookie("owner-token", false);
  const orgId = "a0000000-0000-4000-8000-000000000001";

  it("fails on invalid Idempotency-Key length", async () => {
    const res = await request(app)
      .post(`/api/v1/organizations/${orgId}/invitations`)
      .set("Cookie", ownerCookie)
      .set("Idempotency-Key", "a".repeat(257))
      .send({ email: "bob@flowdesk.dev", role: "agent" })
      .expect(400);

    const body = res.body as { code: string };
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("executes mutation on first request and returns 201", async () => {
    const res = await request(app)
      .post(`/api/v1/organizations/${orgId}/invitations`)
      .set("Cookie", ownerCookie)
      .set("Idempotency-Key", "first-key-123")
      .send({ email: "bob@flowdesk.dev", role: "agent" })
      .expect(201);

    const body = res.body as { invitation: { email: string; role: string } };
    expect(body.invitation.email).toBe("bob@flowdesk.dev");
    expect(res.headers["idempotent-replay"]).toBeUndefined();
  });

  it("replays cached response with Idempotent-Replay header when key is repeated", async () => {
    // Wait briefly for finish event
    await new Promise((resolve) => setTimeout(resolve, 50));

    const res = await request(app)
      .post(`/api/v1/organizations/${orgId}/invitations`)
      .set("Cookie", ownerCookie)
      .set("Idempotency-Key", "first-key-123")
      .send({ email: "bob@flowdesk.dev", role: "agent" })
      .expect(201);

    expect(res.headers["idempotent-replay"]).toBe("true");
    const body = res.body as { invitation: { email: string; role: string } };
    expect(body.invitation.email).toBe("bob@flowdesk.dev");
  });

  it("returns 422 if key is reused with a different payload", async () => {
    const res = await request(app)
      .post(`/api/v1/organizations/${orgId}/invitations`)
      .set("Cookie", ownerCookie)
      .set("Idempotency-Key", "first-key-123")
      .send({ email: "charlie@flowdesk.dev", role: "agent" })
      .expect(422);

    const body = res.body as { code: string };
    expect(body.code).toBe("IDEMPOTENCY_FINGERPRINT_MISMATCH");
  });
});
