import { describe, expect, it } from "vitest";
import type { DbClient } from "./auth.js";
import {
  createPolicyDraft,
  publishPolicyDraft,
  recordRoutingLogWithTrace
} from "./automation-policy.js";

describe("automation policy database layer", () => {
  it("creates policy draft with incremented version and audits", async () => {
    const sql: string[] = [];
    const db = {
      async query(text: string, params?: unknown[]) {
        await Promise.resolve();
        sql.push(text);
        if (text.includes("COALESCE(MAX(version), 0)")) {
          return {
            rows: [{ next_version: 1 }],
            rowCount: 1,
            command: "SELECT",
            oid: 0,
            fields: []
          };
        }
        if (text.includes("INSERT INTO flowdesk.automation_policies")) {
          const parsedRules =
            typeof params?.[3] === "string"
              ? (JSON.parse(params[3]) as Record<string, unknown>[])
              : [];
          const parsedMeta =
            typeof params?.[4] === "string"
              ? (JSON.parse(params[4]) as Record<string, unknown>)
              : {};
          return {
            rows: [
              {
                id: "policy-1",
                organization_id: params?.[0],
                version: params?.[1],
                status: "draft",
                name: params?.[2],
                rules: parsedRules,
                metadata: parsedMeta,
                created_by_user_id: params?.[5],
                published_by_user_id: null,
                published_at: null,
                created_at: new Date(),
                updated_at: new Date()
              }
            ],
            rowCount: 1,
            command: "INSERT",
            oid: 0,
            fields: []
          };
        }
        return { rows: [{ id: "audit-1" }], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }
    } as unknown as DbClient;

    const draft = await createPolicyDraft(db, {
      organizationId: "org-1",
      name: "Policy Beta",
      rules: [
        {
          id: "r1",
          organizationId: "org-1",
          name: "VIP Support",
          priority: 10,
          conditions: { tag: "vip" },
          targetQueueId: "q-vip",
          targetTeamId: null,
          targetUserId: null,
          isActive: true
        }
      ],
      userId: "user-1"
    });

    expect(draft.id).toBe("policy-1");
    expect(draft.version).toBe(1);
    expect(draft.status).toBe("draft");
    expect(draft.rules).toHaveLength(1);
    expect(sql.some((s) => s.includes("INSERT INTO flowdesk.audit_logs"))).toBe(true);
  });

  it("publishes draft policy transactionally and archives previous published", async () => {
    const sql: string[] = [];
    const db = {
      async query(text: string, params?: unknown[]) {
        await Promise.resolve();
        sql.push(text);
        if (text.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: "draft-1",
                organization_id: "org-1",
                version: 2,
                status: "draft",
                name: "Draft 2",
                rules: [],
                metadata: {},
                created_by_user_id: "user-1",
                published_by_user_id: null,
                published_at: null,
                created_at: new Date(),
                updated_at: new Date()
              }
            ],
            rowCount: 1,
            command: "SELECT",
            oid: 0,
            fields: []
          };
        }
        if (text.includes("SET status = 'published'")) {
          return {
            rows: [
              {
                id: "draft-1",
                organization_id: "org-1",
                version: 2,
                status: "published",
                name: "Draft 2",
                rules: [],
                metadata: { publishNotes: "Live release" },
                created_by_user_id: "user-1",
                published_by_user_id: params?.[2],
                published_at: new Date(),
                created_at: new Date(),
                updated_at: new Date()
              }
            ],
            rowCount: 1,
            command: "UPDATE",
            oid: 0,
            fields: []
          };
        }
        return { rows: [{ id: "audit-1" }], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
      }
    } as unknown as DbClient;

    const published = await publishPolicyDraft(db, {
      organizationId: "org-1",
      policyId: "draft-1",
      userId: "admin-1",
      notes: "Live release"
    });

    expect(published.status).toBe("published");
    expect(published.version).toBe(2);
    expect(sql.some((s) => s.includes("SET status = 'archived'"))).toBe(true);
    expect(sql.some((s) => s.includes("action = 'automation_policy:published'"))).toBe(false);
  });

  it("records routing log with structured decision trace", async () => {
    const sql: string[] = [];
    const db = {
      async query(text: string, params?: unknown[]) {
        await Promise.resolve();
        sql.push(text);
        const parsedTrace =
          typeof params?.[10] === "string"
            ? (JSON.parse(params[10]) as Record<string, unknown>[])
            : [];
        const parsedInputs =
          typeof params?.[11] === "string"
            ? (JSON.parse(params[11]) as Record<string, unknown>)
            : {};
        return {
          rows: [
            {
              id: "log-1",
              organization_id: params?.[0],
              conversation_id: params?.[1],
              matched_rule_id: params?.[2],
              matched_policy_rule_id: params?.[3],
              target_queue_id: params?.[4],
              target_team_id: params?.[5],
              target_user_id: params?.[6],
              reason: params?.[7],
              routed_at: new Date(),
              policy_id: params?.[8],
              policy_version: params?.[9],
              decision_trace: parsedTrace,
              inputs_snapshot: parsedInputs
            }
          ],
          rowCount: 1,
          command: "INSERT",
          oid: 0,
          fields: []
        };
      }
    } as unknown as DbClient;

    const log = await recordRoutingLogWithTrace(db, {
      organizationId: "org-1",
      conversationId: "conv-1",
      matchedRuleId: null,
      matchedPolicyRuleId: "rule-z1wfsei",
      targetQueueId: "q-1",
      reason: "Matched VIP",
      policyId: "pol-1",
      policyVersion: 2,
      decisionTrace: [
        {
          ruleId: "rule-z1wfsei",
          ruleName: "VIP Rule",
          priority: 10,
          matched: true,
          reason: "All conditions matched",
          conditionsEvaluated: { tag: { expected: "vip", actual: "vip", passed: true } }
        }
      ],
      inputsSnapshot: { tags: ["vip"] }
    });

    expect(log.id).toBe("log-1");
    expect(log.matchedRuleId).toBeNull();
    expect(log.matchedPolicyRuleId).toBe("rule-z1wfsei");
    expect(log.policyId).toBe("pol-1");
    expect(log.policyVersion).toBe(2);
    expect(log.decisionTrace).toHaveLength(1);
    expect(sql.some((s) => s.includes("INSERT INTO flowdesk.routing_logs"))).toBe(true);
  });
});
