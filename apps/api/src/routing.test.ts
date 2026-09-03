import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadAuthConfig } from "@flowdesk/config";
import type { DbClient } from "@flowdesk/db";
import { MockIdentityProvider } from "@flowdesk/providers";
import { hashSessionToken, serializeSessionCookie } from "@flowdesk/security";
import { createApiApp } from "./app.js";
import type {
  AutomationPolicyResponse,
  SimulatePolicyResponse,
  RoutingRuleResponse,
  RoutingLogResponse
} from "@flowdesk/contracts";

const orgId = "a0000000-0000-4000-8000-000000000001";
const otherOrgId = "b0000000-0000-4000-8000-000000000002";
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

interface MockPolicyRow {
  id: string;
  organization_id: string;
  version: number;
  status: "draft" | "published" | "archived";
  name: string;
  rules: Record<string, unknown>[];
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  published_by_user_id: string | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface MockLogRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  matched_rule_id: string | null;
  matched_policy_rule_id?: string | null;
  target_queue_id: string | null;
  target_team_id: string | null;
  target_user_id: string | null;
  reason: string;
  routed_at: Date;
  policy_id?: string | null;
  policy_version?: number | null;
  decision_trace?: unknown[];
  inputs_snapshot?: Record<string, unknown>;
}

function createMockDb(initialLogs: MockLogRow[] = []): DbClient {
  const rules = new Map<string, MockRuleRow>();
  const policies = new Map<string, MockPolicyRow>();
  const logs: MockLogRow[] = [...initialLogs];
  let ruleCounter = 1;
  let policyCounter = 1;

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

      // ==========================================
      // Automation Policy Mock Handlers
      // ==========================================

      if (sql.includes("COALESCE(MAX(version), 0) + 1 AS next_version")) {
        const oId = values[0] as string;
        const maxV = Array.from(policies.values())
          .filter((p) => p.organization_id === oId)
          .reduce((max, p) => Math.max(max, p.version), 0);
        return {
          rows: [{ next_version: maxV + 1 }],
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }

      if (sql.includes("INSERT INTO flowdesk.automation_policies")) {
        const id = `00000000-0000-5000-8000-00000000000${policyCounter++}`;
        const isPublished = sql.includes("'published'");
        const row: MockPolicyRow = {
          id,
          organization_id: values[0] as string,
          version: values[1] as number,
          status: isPublished ? "published" : "draft",
          name: values[2] as string,
          rules: JSON.parse(values[3] as string) as Record<string, unknown>[],
          metadata: JSON.parse(values[4] as string) as Record<string, unknown>,
          created_by_user_id: values[5] as string | null,
          published_by_user_id: isPublished ? (values[5] as string | null) : null,
          published_at: isPublished ? new Date() : null,
          created_at: new Date(),
          updated_at: new Date()
        };
        policies.set(id, row);
        return { rows: [row], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      if (
        sql.includes(
          "FROM flowdesk.automation_policies WHERE organization_id = $1 AND status = 'published'"
        )
      ) {
        const oId = values[0] as string;
        const published = Array.from(policies.values()).find(
          (p) => p.organization_id === oId && p.status === "published"
        );
        return {
          rows: published ? [published] : [],
          rowCount: published ? 1 : 0,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }

      if (
        sql.includes(
          "FROM flowdesk.automation_policies WHERE organization_id = $1 ORDER BY version DESC"
        )
      ) {
        const oId = values[0] as string;
        const orgPolicies = Array.from(policies.values())
          .filter((p) => p.organization_id === oId)
          .sort((a, b) => b.version - a.version);
        return {
          rows: orgPolicies,
          rowCount: orgPolicies.length,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }

      if (
        sql.includes("FROM flowdesk.automation_policies WHERE organization_id = $1 AND id = $2")
      ) {
        const oId = values[0] as string;
        const pId = values[1] as string;
        const policy = policies.get(pId);
        if (policy && policy.organization_id === oId) {
          return { rows: [policy], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      if (sql.includes("UPDATE flowdesk.automation_policies SET status = 'archived'")) {
        const oId = values[0] as string;
        for (const p of policies.values()) {
          if (p.organization_id === oId && p.status === "published") {
            p.status = "archived";
            p.updated_at = new Date();
          }
        }
        return { rows: [], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
      }

      if (sql.includes("UPDATE flowdesk.automation_policies SET status = 'published'")) {
        const oId = values[0] as string;
        const pId = values[1] as string;
        const policy = policies.get(pId);
        if (policy && policy.organization_id === oId) {
          policy.status = "published";
          policy.published_by_user_id = values[2] as string | null;
          policy.published_at = new Date();
          policy.updated_at = new Date();
          return { rows: [policy], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "UPDATE", oid: 0, fields: [] };
      }

      if (sql.includes("UPDATE flowdesk.automation_policies SET name = COALESCE($3, name)")) {
        const oId = values[0] as string;
        const pId = values[1] as string;
        const policy = policies.get(pId);
        if (policy && policy.organization_id === oId && policy.status === "draft") {
          if (values[2]) policy.name = values[2] as string;
          if (values[3])
            policy.rules = JSON.parse(values[3] as string) as Record<string, unknown>[];
          if (values[4])
            policy.metadata = JSON.parse(values[4] as string) as Record<string, unknown>;
          policy.updated_at = new Date();
          return { rows: [policy], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "UPDATE", oid: 0, fields: [] };
      }

      // ==========================================
      // Legacy Routing Rules Handlers
      // ==========================================

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

      if (sql.includes("INSERT INTO flowdesk.audit_logs")) {
        return { rows: [{ id: "audit-1" }], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
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

const adminCookie = serializeSessionCookie("admin-token", false);
const agentCookie = serializeSessionCookie("agent-token", false);

describe("Routing Rules & Automation Policy API (M5-01 / #180)", () => {
  describe("Automation Policy Versioning, Simulator, and Rollback", () => {
    it("manages complete policy lifecycle: create draft, update, publish, and simulate", async () => {
      const db = createMockDb();
      const app = makeApp(db);

      // 1. Create policy draft as admin
      const draftRes = await request(app)
        .post(`/api/v1/organizations/${orgId}/routing/policies/draft`)
        .set("Cookie", [adminCookie])
        .send({
          name: "M5 Automation Policy",
          rules: [
            {
              id: "r-vip",
              name: "VIP Direct Routing",
              priority: 10,
              conditions: { tag: "vip", intent: "support" },
              targetQueueId: "00000000-0000-7000-8000-000000000099",
              action: "route",
              isActive: true
            }
          ]
        });

      expect(draftRes.status).toBe(201);
      const draftBody = draftRes.body as AutomationPolicyResponse;
      expect(draftBody.status).toBe("draft");
      expect(draftBody.version).toBe(1);
      const policyId = draftBody.id;

      // 2. Update draft
      const updateRes = await request(app)
        .put(`/api/v1/organizations/${orgId}/routing/policies/draft/${policyId}`)
        .set("Cookie", [adminCookie])
        .send({
          name: "M5 Automation Policy Updated"
        });

      expect(updateRes.status).toBe(200);
      const updateBody = updateRes.body as AutomationPolicyResponse;
      expect(updateBody.name).toBe("M5 Automation Policy Updated");

      // 3. Publish draft
      const publishRes = await request(app)
        .post(`/api/v1/organizations/${orgId}/routing/policies/${policyId}/publish`)
        .set("Cookie", [adminCookie])
        .send({ notes: "Production launch" });

      expect(publishRes.status).toBe(200);
      const publishBody = publishRes.body as AutomationPolicyResponse;
      expect(publishBody.status).toBe("published");

      // 4. Fetch active published policy
      const activeRes = await request(app)
        .get(`/api/v1/organizations/${orgId}/routing/policies/active`)
        .set("Cookie", [agentCookie]);

      expect(activeRes.status).toBe(200);
      const activeBody = activeRes.body as AutomationPolicyResponse;
      expect(activeBody.id).toBe(policyId);
      expect(activeBody.status).toBe("published");

      // 5. Run Simulator with matching VIP context -> verified decision trace
      const simMatchRes = await request(app)
        .post(`/api/v1/organizations/${orgId}/routing/policies/simulate`)
        .set("Cookie", [agentCookie])
        .send({
          context: {
            tags: ["vip"],
            intent: "support"
          }
        });

      expect(simMatchRes.status).toBe(200);
      const simMatchBody = simMatchRes.body as SimulatePolicyResponse;
      expect(simMatchBody.matchedRule?.name).toBe("VIP Direct Routing");
      expect(simMatchBody.targetQueueId).toBe("00000000-0000-7000-8000-000000000099");
      expect(simMatchBody.decisionTrace).toHaveLength(1);
      expect(simMatchBody.decisionTrace[0]?.matched).toBe(true);

      // 6. Run Simulator with missing context -> fail-closed trace
      const simFailRes = await request(app)
        .post(`/api/v1/organizations/${orgId}/routing/policies/simulate`)
        .set("Cookie", [agentCookie])
        .send({
          context: {
            tags: ["general"]
          }
        });

      expect(simFailRes.status).toBe(200);
      const simFailBody = simFailRes.body as SimulatePolicyResponse;
      expect(simFailBody.matchedRule).toBeNull();
      expect(simFailBody.action).toBe("default");
      expect(simFailBody.decisionTrace[0]?.matched).toBe(false);
    });

    it("detects and surfaces policy conflicts in simulator", async () => {
      const db = createMockDb();
      const app = makeApp(db);

      const simRes = await request(app)
        .post(`/api/v1/organizations/${orgId}/routing/policies/simulate`)
        .set("Cookie", [agentCookie])
        .send({
          rules: [
            {
              id: "r1",
              name: "Catch-All",
              priority: 10,
              conditions: {},
              targetQueueId: "00000000-0000-7000-8000-000000000091",
              action: "route",
              isActive: true
            },
            {
              id: "r2",
              name: "Unreachable Rule",
              priority: 20,
              conditions: { tag: "vip" },
              targetQueueId: "00000000-0000-7000-8000-000000000092",
              action: "route",
              isActive: true
            }
          ],
          context: { tags: ["vip"] }
        });

      expect(simRes.status).toBe(200);
      const simBody = simRes.body as SimulatePolicyResponse;
      expect(simBody.conflicts.some((c: { type: string }) => c.type === "unreachable_rule")).toBe(
        true
      );
    });

    it("enforces RBAC on policy management and prevents tenant cross-access", async () => {
      const db = createMockDb();
      const app = makeApp(db);

      // Agent lacks automation:publish -> 403
      const draftRes = await request(app)
        .post(`/api/v1/organizations/${orgId}/routing/policies/draft`)
        .set("Cookie", [agentCookie])
        .send({
          name: "Agent Draft",
          rules: []
        });

      expect(draftRes.status).toBe(403);

      // Accessing other org -> 403
      const crossOrgRes = await request(app)
        .get(`/api/v1/organizations/${otherOrgId}/routing/policies`)
        .set("Cookie", [adminCookie]);

      expect(crossOrgRes.status).toBe(403);
    });
  });

  describe("Legacy Routing Rules CRUD", () => {
    it("handles full lifecycle of routing rule CRUD and logs", async () => {
      const db = createMockDb();
      const app = makeApp(db);

      // 1. Create routing rule as admin
      const createRes = await request(app)
        .post(`/api/v1/organizations/${orgId}/routing/rules`)
        .set("Cookie", [adminCookie])
        .send({
          name: "VIP VIP WhatsApp Routing",
          priority: 10,
          conditions: {
            channelId: "00000000-0000-7000-8000-000000000001",
            tag: "vip"
          },
          targetQueueId: "00000000-0000-7000-8000-000000000002",
          isActive: true
        });

      expect(createRes.status).toBe(201);
      const createBody = createRes.body as RoutingRuleResponse;
      expect(createBody.name).toBe("VIP VIP WhatsApp Routing");
      const ruleId = createBody.id;

      // 2. Fetch created rule
      const getRes = await request(app)
        .get(`/api/v1/organizations/${orgId}/routing/rules/${ruleId}`)
        .set("Cookie", [adminCookie]);

      expect(getRes.status).toBe(200);
      const getBody = getRes.body as RoutingRuleResponse;
      expect(getBody.id).toBe(ruleId);

      // 3. List rules
      const listRes = await request(app)
        .get(`/api/v1/organizations/${orgId}/routing/rules`)
        .set("Cookie", [adminCookie]);

      expect(listRes.status).toBe(200);
      const listBody = listRes.body as RoutingRuleResponse[];
      expect(listBody).toHaveLength(1);

      // 4. Update rule
      const updateRes = await request(app)
        .put(`/api/v1/organizations/${orgId}/routing/rules/${ruleId}`)
        .set("Cookie", [adminCookie])
        .send({
          name: "VIP Updated Name",
          priority: 5
        });

      expect(updateRes.status).toBe(200);
      const updateRuleBody = updateRes.body as RoutingRuleResponse;
      expect(updateRuleBody.name).toBe("VIP Updated Name");
      expect(updateRuleBody.priority).toBe(5);

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

    it("restricts rule management permissions to admin role", async () => {
      const db = createMockDb();
      const app = makeApp(db);

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

      const rulesRes = await request(app)
        .get(`/api/v1/organizations/${orgId}/routing/rules`)
        .set("Cookie", [agentCookie]);

      expect(rulesRes.status).toBe(200);

      const logsRes = await request(app)
        .get(`/api/v1/organizations/${orgId}/routing/logs/b0000000-0000-7000-8000-000000000001`)
        .set("Cookie", [agentCookie]);

      expect(logsRes.status).toBe(200);
      expect(logsRes.body).toBeInstanceOf(Array);
    });

    it("returns policy rule IDs and legacy rule IDs in routing log responses (#180)", async () => {
      const convId = "b0000000-0000-7000-8000-000000000001";
      const legacyRuleUuid = "00000000-0000-7000-8000-000000000088";
      const db = createMockDb([
        {
          id: "log-policy-1",
          organization_id: orgId,
          conversation_id: convId,
          matched_rule_id: null,
          matched_policy_rule_id: "rule-z1wfsei",
          target_queue_id: "00000000-0000-7000-8000-000000000099",
          target_team_id: null,
          target_user_id: null,
          reason: "Policy rule matched",
          routed_at: new Date(),
          policy_id: "a38989b5-1007-4637-91fe-f98f4b41658f",
          policy_version: 1
        },
        {
          id: "log-legacy-1",
          organization_id: orgId,
          conversation_id: convId,
          matched_rule_id: legacyRuleUuid,
          matched_policy_rule_id: null,
          target_queue_id: null,
          target_team_id: null,
          target_user_id: null,
          reason: "Legacy rule matched",
          routed_at: new Date()
        }
      ]);
      const app = makeApp(db);

      const logsRes = await request(app)
        .get(`/api/v1/organizations/${orgId}/routing/logs/${convId}`)
        .set("Cookie", [agentCookie]);

      expect(logsRes.status).toBe(200);
      const returnedLogs = logsRes.body as RoutingLogResponse[];
      expect(returnedLogs).toHaveLength(2);

      // Policy rule log: effective matchedRuleId is string ID, matchedPolicyRuleId is string ID
      const policyLog = returnedLogs.find((l) => l.id === "log-policy-1")!;
      expect(policyLog.matchedRuleId).toBe("rule-z1wfsei");
      expect(policyLog.matchedPolicyRuleId).toBe("rule-z1wfsei");
      expect(policyLog.policyId).toBe("a38989b5-1007-4637-91fe-f98f4b41658f");
      expect(policyLog.policyVersion).toBe(1);

      // Legacy rule log: effective matchedRuleId is UUID, matchedPolicyRuleId is null
      const legacyLog = returnedLogs.find((l) => l.id === "log-legacy-1")!;
      expect(legacyLog.matchedRuleId).toBe(legacyRuleUuid);
      expect(legacyLog.matchedPolicyRuleId).toBeNull();
    });
  });

  describe("Tenant context and RLS regression tests (#180)", () => {
    it("creates draft, lists policies, publishes, and simulates under tenant context", async () => {
      const db = createMockDb();
      const app = makeApp(db);

      // 1. POST /policies/draft returns 201
      const draftRes = await request(app)
        .post(`/api/v1/organizations/${orgId}/routing/policies/draft`)
        .set("Cookie", [adminCookie])
        .send({
          name: "Tenant Scoped Policy",
          rules: [
            {
              id: "r-tenant",
              name: "Tenant VIP",
              priority: 1,
              conditions: { plan: "enterprise" },
              targetQueueId: "00000000-0000-7000-8000-000000000099",
              action: "route",
              isActive: true
            }
          ]
        });

      expect(draftRes.status).toBe(201);
      const draft = draftRes.body as AutomationPolicyResponse;
      expect(draft.organizationId).toBe(orgId);
      expect(draft.version).toBe(1);
      expect(draft.status).toBe("draft");

      // 2. GET /policies reads only tenant rows
      const listRes = await request(app)
        .get(`/api/v1/organizations/${orgId}/routing/policies`)
        .set("Cookie", [adminCookie]);
      expect(listRes.status).toBe(200);
      const list = listRes.body as AutomationPolicyResponse[];
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe(draft.id);

      // 3. PUT /policies/draft/:id updates draft
      const updateRes = await request(app)
        .put(`/api/v1/organizations/${orgId}/routing/policies/draft/${draft.id}`)
        .set("Cookie", [adminCookie])
        .send({ name: "Tenant Scoped Policy Renamed" });
      expect(updateRes.status).toBe(200);
      expect((updateRes.body as AutomationPolicyResponse).name).toBe(
        "Tenant Scoped Policy Renamed"
      );

      // 4. POST /policies/:id/publish publishes draft atomically
      const publishRes = await request(app)
        .post(`/api/v1/organizations/${orgId}/routing/policies/${draft.id}/publish`)
        .set("Cookie", [adminCookie])
        .send({ notes: "Publishing under tenant context" });
      expect(publishRes.status).toBe(200);
      expect((publishRes.body as AutomationPolicyResponse).status).toBe("published");

      // 5. GET /policies/active returns the published policy
      const activeRes = await request(app)
        .get(`/api/v1/organizations/${orgId}/routing/policies/active`)
        .set("Cookie", [adminCookie]);
      expect(activeRes.status).toBe(200);
      expect((activeRes.body as AutomationPolicyResponse).id).toBe(draft.id);

      // 6. POST /policies/:id/rollback restores version
      const rollbackRes = await request(app)
        .post(`/api/v1/organizations/${orgId}/routing/policies/${draft.id}/rollback`)
        .set("Cookie", [adminCookie])
        .send({ notes: "Rollback test" });
      expect(rollbackRes.status).toBe(200);

      // 7. POST /policies/simulate loads tenant policy
      const simRes = await request(app)
        .post(`/api/v1/organizations/${orgId}/routing/policies/simulate`)
        .set("Cookie", [adminCookie])
        .send({
          context: {
            customerPhone: "+6281234567890",
            messageBody: "Urgent enterprise issue",
            tags: [],
            extractedEntities: { plan: "enterprise" }
          }
        });
      expect(simRes.status).toBe(200);
      const sim = simRes.body as SimulatePolicyResponse;
      expect(sim.matchedRule?.name).toBe("Tenant VIP");
    });

    it("denies cross-tenant policy access", async () => {
      const db = createMockDb();
      const app = makeApp(db);

      // admin is member of orgId, but NOT otherOrgId
      const res = await request(app)
        .get(`/api/v1/organizations/${otherOrgId}/routing/policies`)
        .set("Cookie", [adminCookie]);

      expect(res.status).toBe(403);
    });

    it("successfully creates policy draft when db is a pg.Pool using runInTenantTransaction", async () => {
      const mockDb = createMockDb();
      const poolClient = {
        query: mockDb.query.bind(mockDb),
        release: () => {},
        connect: () =>
          Promise.reject(new Error("Client has already been connected. You cannot reuse a client."))
      };
      const pool = {
        query: mockDb.query.bind(mockDb),
        connect: () => Promise.resolve(poolClient),
        totalCount: 5,
        idleCount: 3,
        waitingCount: 0
      };

      const app = makeApp(pool as unknown as DbClient);

      const res = await request(app)
        .post(`/api/v1/organizations/${orgId}/routing/policies/draft`)
        .set("Cookie", [adminCookie])
        .send({
          name: "Pool Tenant Policy",
          rules: []
        });

      expect(res.status).toBe(201);
      expect((res.body as AutomationPolicyResponse).name).toBe("Pool Tenant Policy");
    });
  });
});
