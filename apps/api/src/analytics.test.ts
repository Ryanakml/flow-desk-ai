import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadAuthConfig } from "@flowdesk/config";
import type { DbClient } from "@flowdesk/db";
import { serializeSessionCookie, hashSessionToken } from "@flowdesk/security";
import { createApiApp } from "./app.js";

function createMockDb(): DbClient {
  const adminToken = "admin-token-12345";
  const expectedHash = hashSessionToken(adminToken);

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
                user_display_name: "Admin Analytics",
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

      if (sql.includes("flowdesk.conversations")) {
        return {
          rows: [{ total: "45", open: "12", assigned: "25", resolved: "33" }],
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }

      if (sql.includes("flowdesk.messages") && sql.includes("GROUP BY")) {
        return {
          rows: [
            { day: "2026-08-28", inbound: "20", outbound: "15", bot: "10" },
            { day: "2026-08-29", inbound: "25", outbound: "20", bot: "18" }
          ],
          rowCount: 2,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }

      if (sql.includes("flowdesk.messages")) {
        return {
          rows: [{ total: "180", inbound: "90", outbound: "90", bot: "120", human: "60" }],
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: []
        };
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

describe("Analytics REST API Router (M6-04)", () => {
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

  it("GET /api/v1/organizations/:orgId/analytics/metrics returns metrics overview and volume series", async () => {
    const res = (await request(app)
      .get(`/api/v1/organizations/${orgId}/analytics/metrics?days=30`)
      .set("Cookie", adminCookie)) as unknown as {
      status: number;
      body: { overview: Record<string, unknown>; volumeSeries: unknown[] };
    };

    expect(res.status).toBe(200);
    expect(res.body.overview["totalConversations"]).toBe(45);
    expect(res.body.overview["openConversations"]).toBe(12);
    expect(res.body.overview["botAutomationRate"]).toBe(66.7);
    expect(res.body.volumeSeries).toHaveLength(2);
  });

  it("POST /api/v1/organizations/:orgId/analytics/export returns CSV file stream and records audit event", async () => {
    const res = (await request(app)
      .post(`/api/v1/organizations/${orgId}/analytics/export`)
      .set("Cookie", adminCookie)) as unknown as {
      status: number;
      headers: Record<string, string>;
      text: string;
    };

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("flowdesk-analytics-org-123.csv");
    expect(res.text).toContain("Category,Metric,Value");
    expect(res.text).toContain("Conversations,Total,45");
    expect(res.text).toContain("Automation,Bot Automation Rate (%),66.7%");
  });
});
