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
  const memberships = new Map<
    string,
    { id: string; orgId: string; userId: string; roleKey: string }
  >();
  interface AuditRow {
    id: string;
    organization_id: string;
    actor_user_id: string | null;
    action: string;
    target_type: string;
    target_id: string | null;
    result: "allowed" | "denied" | "failed";
    correlation_id: string | null;
    metadata: Record<string, unknown>;
    occurred_at: Date;
  }
  const auditLogs: AuditRow[] = [];

  const orgId = "a0000000-0000-4000-8000-000000000001";
  users.set("u-owner", {
    id: "u-owner",
    email: "owner@flowdesk.dev",
    displayName: "Owner",
    status: "active"
  });
  users.set("u-agent", {
    id: "u-agent",
    email: "agent@flowdesk.dev",
    displayName: "Agent",
    status: "active"
  });
  users.set("u-stranger", {
    id: "u-stranger",
    email: "stranger@flowdesk.dev",
    displayName: "Stranger",
    status: "active"
  });

  sessions.set(hashSessionToken("owner-token"), {
    id: "s-owner",
    userId: "u-owner",
    tokenHash: hashSessionToken("owner-token"),
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null
  });
  sessions.set(hashSessionToken("agent-token"), {
    id: "s-agent",
    userId: "u-agent",
    tokenHash: hashSessionToken("agent-token"),
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null
  });
  sessions.set(hashSessionToken("stranger-token"), {
    id: "s-stranger",
    userId: "u-stranger",
    tokenHash: hashSessionToken("stranger-token"),
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null
  });

  memberships.set("m-owner", { id: "m-owner", orgId, userId: "u-owner", roleKey: "owner" });
  memberships.set("m-agent", { id: "m-agent", orgId, userId: "u-agent", roleKey: "agent" });

  // Pre-seed some audit logs
  auditLogs.push({
    id: "a0000000-0000-4000-8000-000000000010",
    organization_id: orgId,
    actor_user_id: "u-owner",
    action: "org:bootstrap",
    target_type: "organization",
    target_id: orgId,
    result: "allowed",
    correlation_id: null,
    metadata: { slug: "test-org", name: "Test Org" },
    occurred_at: new Date()
  });

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

      // Member lookup
      if (sql.includes("WHERE m.organization_id = $1 AND m.user_id = $2 AND m.status = 'active'")) {
        const [o, u] = values as [string, string];
        for (const m of memberships.values()) {
          if (m.orgId === o && m.userId === u) {
            return { rows: [{ id: m.id, role_key: m.roleKey, status: "active" }] };
          }
        }
        return { rows: [] };
      }

      // Audit logs select: SELECT id, organization_id... FROM flowdesk.audit_logs
      if (sql.includes("FROM flowdesk.audit_logs")) {
        const orgIdVal = values[0] as string;
        const filtered = auditLogs.filter((l) => l.organization_id === orgIdVal);
        const limit = Number(values[values.length - 1]);
        const sliced = filtered.slice(0, limit);
        return {
          rows: sliced.map((r) => ({
            id: r.id,
            organization_id: r.organization_id,
            actor_user_id: r.actor_user_id,
            action: r.action,
            target_type: r.target_type,
            target_id: r.target_id,
            result: r.result,
            correlation_id: r.correlation_id,
            metadata: r.metadata,
            occurred_at: r.occurred_at
          }))
        };
      }

      return { rows: [] };
    }
  } as unknown as DbClient;
}

describe("API Audit Logs Viewer (M1-06)", () => {
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
  const agentCookie = serializeSessionCookie("agent-token", false);
  const strangerCookie = serializeSessionCookie("stranger-token", false);
  const orgId = "a0000000-0000-4000-8000-000000000001";

  it("denies unauthenticated request with 401", async () => {
    const res = await request(app).get(`/api/v1/organizations/${orgId}/audit-logs`).expect(401);

    const body = res.body as { code: string };
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("denies non-member with 403 NOT_A_MEMBER", async () => {
    const res = await request(app)
      .get(`/api/v1/organizations/${orgId}/audit-logs`)
      .set("Cookie", strangerCookie)
      .expect(403);

    const body = res.body as { code: string };
    expect(body.code).toBe("NOT_A_MEMBER");
  });

  it("denies agent role without audit:view permission with 403 FORBIDDEN", async () => {
    const res = await request(app)
      .get(`/api/v1/organizations/${orgId}/audit-logs`)
      .set("Cookie", agentCookie)
      .expect(403);

    const body = res.body as { code: string };
    expect(body.code).toBe("FORBIDDEN");
  });

  it("allows owner to view audit logs with cursor pagination", async () => {
    const res = await request(app)
      .get(`/api/v1/organizations/${orgId}/audit-logs`)
      .set("Cookie", ownerCookie)
      .expect(200);

    const body = res.body as {
      items: Array<{ id: string; action: string }>;
      pageInfo: { hasNextPage: boolean; hasPreviousPage: boolean };
    };

    expect(body.items.length).toBe(1);
    expect(body.items[0]?.action).toBe("org:bootstrap");
    expect(body.pageInfo).toBeDefined();
  });
});
