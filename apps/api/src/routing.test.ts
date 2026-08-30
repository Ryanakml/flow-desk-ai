import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadAuthConfig } from "@flowdesk/config";
import type { DbClient } from "@flowdesk/db";
import { MockIdentityProvider } from "@flowdesk/providers";
import { hashSessionToken, serializeSessionCookie } from "@flowdesk/security";
import { createApiApp } from "./app.js";

const orgId = "a0000000-0000-4000-8000-000000000001";
const adminUserId = "a0000000-0000-4000-8000-000000000010";
const agentUserId = "a0000000-0000-4000-8000-000000000011";

interface MockRuleRow {
  id: string;
  organization_id: string;
  name: string;
  priority: number;
  conditions: Record<string, unknown>;
  target_queue_id: string | null;
  target_team_id: string | null;
  target_user_id: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface MockLogRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  matched_rule_id: string | null;
  target_queue_id: string | null;
  target_team_id: string | null;
  target_user_id: string | null;
  reason: string;
  routed_at: Date;
}

function createMockDb(): DbClient {
  const rules = new Map<string, MockRuleRow>();
  const logs: MockLogRow[] = [];
  let ruleCounter = 1;

  const users = new Map([
    [adminUserId, { id: adminUserId, email: "admin@flowdesk.dev", display_name: "Admin User" }],
    [agentUserId, { id: agentUserId, email: "agent@flowdesk.dev", display_name: "Agent User" }]
  ]);

  const memberships = new Map([
    [
      `${orgId}:${adminUserId}`,
      { organization_id: orgId, user_id: adminUserId, role_key: "admin" }
    ],
    [`${orgId}:${agentUserId}`, { organization_id: orgId, user_id: agentUserId, role_key: "agent" }]
  ]);

  const sessions = new Map([
    [
      hashSessionToken("admin-token"),
      {
        id: "sess-admin",
        user_id: adminUserId,
        expires_at: new Date(Date.now() + 86400000),
        revoked_at: null
      }
    ],
    [
      hashSessionToken("agent-token"),
      {
        id: "sess-agent",
        user_id: agentUserId,
        expires_at: new Date(Date.now() + 86400000),
        revoked_at: null
      }
    ]
  ]);

  return {
    async query(queryText: string, values: unknown[] = []) {
      await Promise.resolve();
      const sql = queryText.replace(/\s+/g, " ").trim();

      if (sql.includes("FROM flowdesk.auth_sessions")) {
        const tokenHash = values[0] as string;
        const session = sessions.get(tokenHash);
        if (!session) return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
        const user = users.get(session.user_id);
        return {
          rows: [
            {
              id: session.id,
              user_id: user?.id,
              email: user?.email,
              display_name: user?.display_name,
              expires_at: session.expires_at,
              created_at: new Date()
            }
          ],
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }

      if (sql.includes("FROM flowdesk.memberships")) {
        const oId = values[0] as string;
        const uId = values[1] as string;
        const member = memberships.get(`${oId}:${uId}`);
        if (member) {
          return {
            rows: [
              {
                id: `mem-${uId}`,
                role_key: member.role_key,
                status: "active"
              }
            ],
            rowCount: 1,
            command: "SELECT",
            oid: 0,
            fields: []
          };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      if (sql.includes("INSERT INTO flowdesk.routing_rules")) {
        const id = `00000000-0000-7000-8000-00000000000${ruleCounter++}`;
        const row: MockRuleRow = {
          id,
          organization_id: values[0] as string,
          name: values[1] as string,
          priority: values[2] as number,
          conditions: JSON.parse(values[3] as string) as Record<string, unknown>,
          target_queue_id: values[4] as string | null,
          target_team_id: values[5] as string | null,
          target_user_id: values[6] as string | null,
          is_active: values[7] as boolean,
          created_at: new Date(),
          updated_at: new Date()
        };
        rules.set(id, row);
        return { rows: [row], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      if (
        sql.includes("SELECT * FROM flowdesk.routing_rules WHERE organization_id = $1 AND id = $2")
      ) {
        const oId = values[0] as string;
        const rId = values[1] as string;
        const row = rules.get(rId);
        if (row && row.organization_id === oId) {
          return { rows: [row], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      if (
        sql.includes(
          "SELECT * FROM flowdesk.routing_rules WHERE organization_id = $1 ORDER BY priority ASC"
        )
      ) {
        const oId = values[0] as string;
        const matching = Array.from(rules.values())
          .filter((r) => r.organization_id === oId)
          .sort((a, b) => a.priority - b.priority);
        return { rows: matching, rowCount: matching.length, command: "SELECT", oid: 0, fields: [] };
      }

      if (sql.includes("UPDATE flowdesk.routing_rules SET")) {
        const oId = values[7] as string;
        const rId = values[8] as string;
        const row = rules.get(rId);
        if (row && row.organization_id === oId) {
          row.name = values[0] as string;
          row.priority = values[1] as number;
          row.conditions = JSON.parse(values[2] as string) as Record<string, unknown>;
          row.target_queue_id = values[3] as string | null;
          row.target_team_id = values[4] as string | null;
          row.target_user_id = values[5] as string | null;
          row.is_active = values[6] as boolean;
          row.updated_at = new Date();
          return { rows: [row], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "UPDATE", oid: 0, fields: [] };
      }

      if (
        sql.includes("DELETE FROM flowdesk.routing_rules WHERE organization_id = $1 AND id = $2")
      ) {
        const oId = values[0] as string;
        const rId = values[1] as string;
        const row = rules.get(rId);
        if (row && row.organization_id === oId) {
          rules.delete(rId);
          return { rows: [], rowCount: 1, command: "DELETE", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "DELETE", oid: 0, fields: [] };
      }

      if (
        sql.includes(
          "SELECT * FROM flowdesk.routing_logs WHERE organization_id = $1 AND conversation_id = $2"
        )
      ) {
        const oId = values[0] as string;
        const cId = values[1] as string;
        const matching = logs.filter((l) => l.organization_id === oId && l.conversation_id === cId);
        return { rows: matching, rowCount: matching.length, command: "SELECT", oid: 0, fields: [] };
      }

      return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
    }
  } as unknown as DbClient;
}

function makeApp(db: DbClient) {
  const config = loadAuthConfig({
    APP_ENV: "local",
    SESSION_SECRET: "00000000000000000000000000000000",
    OIDC_ISSUER_URL: "https://auth.example.com",
    OIDC_CLIENT_ID: "flowdesk-client",
    OIDC_CLIENT_SECRET: "secret"
  });
  return createApiApp({
    service: "api",
    version: "0.0.0",
    gitSha: "local",
    environment: "local",
    auth: {
      db,
      config,
      identityProvider: new MockIdentityProvider()
    }
  });
}

import type { RoutingRuleResponse } from "@flowdesk/contracts";

const adminCookie = serializeSessionCookie("admin-token", false);
const agentCookie = serializeSessionCookie("agent-token", false);

describe("Routing API Endpoints (M5-01)", () => {
  it("allows admin to create, retrieve, update, and delete routing rules", async () => {
    const db = createMockDb();
    const app = makeApp(db);

    // 1. Create rule
    const createRes = await request(app)
      .post(`/api/v1/organizations/${orgId}/routing/rules`)
      .set("Cookie", [adminCookie])
      .send({
        name: "VIP WhatsApp Route",
        priority: 10,
        conditions: { tag: "vip", language: "id" },
        isActive: true
      });

    expect(createRes.status).toBe(201);
    const createdBody = createRes.body as RoutingRuleResponse;
    expect(createdBody.name).toBe("VIP WhatsApp Route");
    expect(createdBody.priority).toBe(10);
    const ruleId = createdBody.id;

    // 2. List rules
    const listRes = await request(app)
      .get(`/api/v1/organizations/${orgId}/routing/rules`)
      .set("Cookie", [adminCookie]);

    expect(listRes.status).toBe(200);
    const listBody = listRes.body as RoutingRuleResponse[];
    expect(listBody).toHaveLength(1);
    expect(listBody[0]?.id).toBe(ruleId);

    // 3. Get single rule
    const getRes = await request(app)
      .get(`/api/v1/organizations/${orgId}/routing/rules/${ruleId}`)
      .set("Cookie", [adminCookie]);

    expect(getRes.status).toBe(200);
    const getBody = getRes.body as RoutingRuleResponse;
    expect(getBody.name).toBe("VIP WhatsApp Route");

    // 4. Update rule
    const updateRes = await request(app)
      .put(`/api/v1/organizations/${orgId}/routing/rules/${ruleId}`)
      .set("Cookie", [adminCookie])
      .send({
        name: "VIP WhatsApp Route (Updated)",
        priority: 5
      });

    expect(updateRes.status).toBe(200);
    const updateBody = updateRes.body as RoutingRuleResponse;
    expect(updateBody.name).toBe("VIP WhatsApp Route (Updated)");
    expect(updateBody.priority).toBe(5);

    // 5. Delete rule
    const deleteRes = await request(app)
      .delete(`/api/v1/organizations/${orgId}/routing/rules/${ruleId}`)
      .set("Cookie", [adminCookie]);

    expect(deleteRes.status).toBe(204);

    // 6. Get deleted rule returns 404
    const getDeletedRes = await request(app)
      .get(`/api/v1/organizations/${orgId}/routing/rules/${ruleId}`)
      .set("Cookie", [adminCookie]);

    expect(getDeletedRes.status).toBe(404);
  });

  it("restricts rule management permissions to admin/supervisor role", async () => {
    const db = createMockDb();
    const app = makeApp(db);

    // Agent attempts to create rule -> 403 Forbidden (needs automation:publish)
    const res = await request(app)
      .post(`/api/v1/organizations/${orgId}/routing/rules`)
      .set("Cookie", [agentCookie])
      .send({
        name: "Agent Rule",
        priority: 50
      });

    expect(res.status).toBe(403);
  });

  it("allows agents to view routing rules and conversation routing logs", async () => {
    const db = createMockDb();
    const app = makeApp(db);

    // Agent can list rules
    const rulesRes = await request(app)
      .get(`/api/v1/organizations/${orgId}/routing/rules`)
      .set("Cookie", [agentCookie]);

    expect(rulesRes.status).toBe(200);

    // Agent can view routing logs for conversation
    const logsRes = await request(app)
      .get(`/api/v1/organizations/${orgId}/routing/logs/b0000000-0000-7000-8000-000000000001`)
      .set("Cookie", [agentCookie]);

    expect(logsRes.status).toBe(200);
    expect(logsRes.body).toBeInstanceOf(Array);
  });
});
