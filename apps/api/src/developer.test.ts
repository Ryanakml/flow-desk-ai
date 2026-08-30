import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadAuthConfig } from "@flowdesk/config";
import type { DbClient } from "@flowdesk/db";
import { serializeSessionCookie, hashSessionToken } from "@flowdesk/security";
import { createApiApp } from "./app.js";

function createMockDb(): DbClient {
  const adminToken = "admin-token-12345";
  const expectedHash = hashSessionToken(adminToken);

  const apiKeys = new Map<
    string,
    {
      id: string;
      organization_id: string;
      name: string;
      key_prefix: string;
      key_hash: string;
      scopes: string[];
      created_by_user_id: string | null;
      expires_at: Date | null;
      revoked_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }
  >();

  const webhooks = new Map<
    string,
    {
      id: string;
      organization_id: string;
      name: string;
      url: string;
      secret: string;
      events: string[];
      is_active: boolean;
      created_at: Date;
      updated_at: Date;
    }
  >();

  return {
    async query(sql: string, params: unknown[] = []) {
      await Promise.resolve();
      if (sql.includes("FROM flowdesk.auth_sessions") || sql.includes("flowdesk.sessions")) {
        const tokenHashParam = params[0] as string;
        if (tokenHashParam === expectedHash) {
          return {
            rows: [
              {
                id: "s-admin",
                user_id: "u-admin",
                token_hash: expectedHash,
                created_at: new Date(),
                expires_at: new Date(Date.now() + 86400000),
                revoked_at: null,
                user_email: "admin@flowdesk.dev",
                user_display_name: "Admin Developer",
                user_status: "active"
              }
            ],
            rowCount: 1,
            command: "SELECT",
            oid: 0,
            fields: []
          };
        }
      }

      if (
        sql.includes("SELECT * FROM flowdesk.memberships") ||
        sql.includes("flowdesk.memberships")
      ) {
        return {
          rows: [
            {
              id: "m-admin",
              organization_id: "org-123",
              user_id: "u-admin",
              role_id: "r-owner",
              role_key: "owner",
              status: "active",
              created_at: new Date()
            }
          ],
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }

      if (sql.includes("SELECT * FROM flowdesk.api_keys")) {
        return {
          rows: Array.from(apiKeys.values()),
          rowCount: apiKeys.size,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }

      if (sql.includes("INSERT INTO flowdesk.api_keys")) {
        const newId = `key-${apiKeys.size + 1}`;
        const row = {
          id: newId,
          organization_id: params[0] as string,
          name: params[1] as string,
          key_prefix: params[2] as string,
          key_hash: params[3] as string,
          scopes: JSON.parse((params[4] as string) || "[]") as string[],
          created_by_user_id: (params[5] as string) || null,
          expires_at: (params[6] as Date) || null,
          revoked_at: null,
          created_at: new Date(),
          updated_at: new Date()
        };
        apiKeys.set(newId, row);
        return { rows: [row], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      if (sql.includes("UPDATE flowdesk.api_keys")) {
        const idParam = params[0] as string;
        const k = apiKeys.get(idParam);
        if (k) {
          k.revoked_at = new Date();
          k.updated_at = new Date();
          return { rows: [k], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "UPDATE", oid: 0, fields: [] };
      }

      if (sql.includes("SELECT * FROM flowdesk.webhook_subscriptions")) {
        return {
          rows: Array.from(webhooks.values()),
          rowCount: webhooks.size,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }

      if (sql.includes("INSERT INTO flowdesk.webhook_subscriptions")) {
        const newId = `wh-${webhooks.size + 1}`;
        const row = {
          id: newId,
          organization_id: params[0] as string,
          name: params[1] as string,
          url: params[2] as string,
          secret: params[3] as string,
          events: JSON.parse((params[4] as string) || "[]") as string[],
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        };
        webhooks.set(newId, row);
        return { rows: [row], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      if (sql.includes("DELETE FROM flowdesk.webhook_subscriptions")) {
        const idParam = params[0] as string;
        const deleted = webhooks.delete(idParam);
        return { rows: [], rowCount: deleted ? 1 : 0, command: "DELETE", oid: 0, fields: [] };
      }

      if (sql.includes("flowdesk.audit_events") || sql.includes("audit")) {
        return {
          rows: [{ id: "audit-1", occurred_at: new Date() }],
          rowCount: 1,
          command: "INSERT",
          oid: 0,
          fields: []
        };
      }

      return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
    }
  } as unknown as DbClient;
}

describe("Developer API Keys & Webhooks REST API (M6-02)", () => {
  const config = loadAuthConfig({ NODE_ENV: "test" });
  const mockDb = createMockDb();
  const app = createApiApp({
    service: "api",
    version: "dev",
    gitSha: "dev",
    environment: "local",
    auth: { db: mockDb, config }
  });

  const adminCookie = serializeSessionCookie("admin-token-12345", false);
  const orgId = "org-123";

  it("POST /api/v1/organizations/:orgId/developer/api-keys creates scoped API key", async () => {
    const res = (await request(app)
      .post(`/api/v1/organizations/${orgId}/developer/api-keys`)
      .set("Cookie", adminCookie)
      .send({
        name: "CI System Key",
        scopes: ["read:conversations", "write:messages"]
      })) as unknown as { status: number; body: Record<string, unknown> };

    expect(res.status).toBe(201);
    expect(res.body["id"]).toBeDefined();
    expect(res.body["keyPrefix"]).toBe("fd_live_");
    expect((res.body["rawKey"] as string).startsWith("fd_live_")).toBe(true);
    expect(res.body["scopes"]).toEqual(["read:conversations", "write:messages"]);
  });

  it("GET /api/v1/organizations/:orgId/developer/api-keys lists tenant API keys", async () => {
    const res = (await request(app)
      .get(`/api/v1/organizations/${orgId}/developer/api-keys`)
      .set("Cookie", adminCookie)) as unknown as { status: number; body: unknown[] };

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  it("DELETE /api/v1/organizations/:orgId/developer/api-keys/:keyId revokes key", async () => {
    const res = (await request(app)
      .delete(`/api/v1/organizations/${orgId}/developer/api-keys/key-1`)
      .set("Cookie", adminCookie)) as unknown as { status: number; body: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(res.body["success"]).toBe(true);
  });

  it("POST /api/v1/organizations/:orgId/developer/webhooks registers outbound webhook", async () => {
    const res = (await request(app)
      .post(`/api/v1/organizations/${orgId}/developer/webhooks`)
      .set("Cookie", adminCookie)
      .send({
        name: "Production Webhook",
        url: "https://example.com/webhooks/flowdesk",
        events: ["conversation.created", "message.received"]
      })) as unknown as { status: number; body: Record<string, unknown> };

    expect(res.status).toBe(201);
    expect(res.body["id"]).toBeDefined();
    expect(res.body["url"]).toBe("https://example.com/webhooks/flowdesk");
    expect((res.body["secret"] as string).startsWith("whsec_")).toBe(true);
  });

  it("GET /api/v1/organizations/:orgId/developer/webhooks lists webhooks", async () => {
    const res = (await request(app)
      .get(`/api/v1/organizations/${orgId}/developer/webhooks`)
      .set("Cookie", adminCookie)) as unknown as { status: number; body: unknown[] };

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  it("DELETE /api/v1/organizations/:orgId/developer/webhooks/:webhookId deletes webhook", async () => {
    const res = (await request(app)
      .delete(`/api/v1/organizations/${orgId}/developer/webhooks/wh-1`)
      .set("Cookie", adminCookie)) as unknown as { status: number; body: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(res.body["success"]).toBe(true);
  });
});
