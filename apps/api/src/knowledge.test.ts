import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadAuthConfig } from "@flowdesk/config";
import type { DbClient } from "@flowdesk/db";
import { hashSessionToken, serializeSessionCookie } from "@flowdesk/security";
import { createApiApp } from "./app.js";

function createMockDb(roleKey = "owner") {
  const rows: Array<Record<string, unknown>> = [];
  const tokenHash = hashSessionToken("knowledge-session-token");
  const now = new Date();
  const db = {
    async query(sql: string, params: unknown[] = []) {
      await Promise.resolve();
      if (sql.includes("FROM flowdesk.auth_sessions") || sql.includes("flowdesk.sessions")) {
        return result(
          params[0] === tokenHash
            ? [
                {
                  id: "session-1",
                  user_id: "user-1",
                  token_hash: tokenHash,
                  created_at: now,
                  expires_at: new Date(Date.now() + 60_000),
                  revoked_at: null,
                  user_email: "owner@example.com",
                  user_display_name: "Owner",
                  user_status: "active"
                }
              ]
            : []
        );
      }
      if (sql.includes("flowdesk.memberships")) {
        return result(
          params[0] === "org-1"
            ? [
                {
                  id: "membership-1",
                  organization_id: "org-1",
                  user_id: "user-1",
                  role_id: "role-1",
                  role_key: roleKey,
                  status: "active",
                  created_at: now
                }
              ]
            : []
        );
      }
      if (sql.includes("INSERT INTO flowdesk.knowledge_sources")) {
        const existing = rows.find((row) => row["dedupe_key"] === params[5]);
        if (existing) return result([existing]);
        const source = {
          id: "10000000-0000-4000-8000-000000000001",
          organization_id: params[0],
          type: params[1],
          name: params[2],
          source_uri: params[3],
          status: "pending",
          status_reason: null,
          content_hash: params[4],
          dedupe_key: params[5],
          byte_size: "0",
          metadata: {},
          last_indexed_at: null,
          created_by_user_id: params[8],
          created_at: now,
          updated_at: now,
          deleted_at: null
        };
        rows.push(source);
        return result([source]);
      }
      if (sql.includes("INSERT INTO flowdesk.knowledge_ingestion_jobs")) {
        return result([
          {
            id: "20000000-0000-4000-8000-000000000001",
            organization_id: params[0],
            source_id: params[1],
            dedupe_key: params[2],
            input_text: params[3],
            status: "queued",
            attempts: 0,
            max_attempts: 3,
            available_at: now,
            error_code: null,
            error_detail: null
          }
        ]);
      }
      if (sql.includes("SELECT * FROM flowdesk.knowledge_sources")) return result(rows);
      if (sql.includes("INSERT INTO flowdesk.audit_logs")) {
        return result([{ id: "audit-1", occurred_at: now }]);
      }
      return result([]);
    }
  } as unknown as DbClient;
  return { db, rows };
}

function result(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
}

function app(db: DbClient) {
  return createApiApp({
    service: "api",
    version: "test",
    gitSha: "test",
    environment: "local",
    auth: { db, config: loadAuthConfig({ AUTH_COOKIE_SECURE: "false" }) }
  });
}

const cookie = serializeSessionCookie("knowledge-session-token", false);

describe("knowledge source API", () => {
  it("persists a text source plus durable job before returning queued state", async () => {
    const { db, rows } = createMockDb();
    const response = await request(app(db))
      .post("/api/v1/organizations/org-1/knowledge/sources")
      .set("Cookie", cookie)
      .send({ type: "text", name: "Refund policy", content: "Refunds take seven days." });

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      jobId: "20000000-0000-4000-8000-000000000001",
      source: { organizationId: "org-1", status: "queued", type: "text" }
    });
    expect(rows).toHaveLength(1);
  });

  it("lists only sources visible through the requested tenant context", async () => {
    const { db } = createMockDb();
    await request(app(db))
      .post("/api/v1/organizations/org-1/knowledge/sources")
      .set("Cookie", cookie)
      .send({ type: "text", name: "Policy", content: "Tenant one knowledge." });

    const own = await request(app(db))
      .get("/api/v1/organizations/org-1/knowledge/sources")
      .set("Cookie", cookie);
    const other = await request(app(db))
      .get("/api/v1/organizations/org-2/knowledge/sources")
      .set("Cookie", cookie);

    expect(own.status).toBe(200);
    expect((own.body as { sources: unknown[] }).sources).toHaveLength(1);
    expect(other.status).toBe(403);
  });

  it("blocks private URLs before any source or job is persisted", async () => {
    const { db, rows } = createMockDb();
    const response = await request(app(db))
      .post("/api/v1/organizations/org-1/knowledge/sources")
      .set("Cookie", cookie)
      .send({ type: "url", name: "Internal", url: "http://127.0.0.1/admin" });

    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe("KNOWLEDGE_URL_BLOCKED");
    expect(rows).toHaveLength(0);
  });

  it("requires an admin-level automation permission", async () => {
    const { db } = createMockDb("agent");
    const response = await request(app(db))
      .post("/api/v1/organizations/org-1/knowledge/sources")
      .set("Cookie", cookie)
      .send({ type: "text", name: "Policy", content: "Not authorized." });

    expect(response.status).toBe(403);
  });
});
