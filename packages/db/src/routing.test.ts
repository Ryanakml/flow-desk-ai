import { describe, expect, it } from "vitest";
import type { DbClient } from "./auth.js";
import {
  createRoutingRule,
  listRoutingRules,
  getRoutingRuleById,
  updateRoutingRule,
  deleteRoutingRule,
  recordRoutingLog,
  listRoutingLogsForConversation
} from "./routing.js";

const mockOrgId = "a0000000-0000-4000-8000-000000000001";
const mockConvId = "b0000000-0000-7000-8000-000000000001";

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
  matched_policy_rule_id?: string | null;
  target_queue_id: string | null;
  target_team_id: string | null;
  target_user_id: string | null;
  reason: string;
  routed_at: Date;
}

function createMockDb(): DbClient {
  const rules = new Map<string, MockRuleRow>();
  const logs: MockLogRow[] = [];
  let counter = 1;

  return {
    async query(queryText: string, values: unknown[] = []) {
      await Promise.resolve();
      const sql = queryText.replace(/\s+/g, " ").trim();

      if (sql.includes("INSERT INTO flowdesk.routing_rules")) {
        const id = `rule-${counter++}`;
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
        const orgId = values[0] as string;
        const ruleId = values[1] as string;
        const row = rules.get(ruleId);
        if (row && row.organization_id === orgId) {
          return { rows: [row], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      if (
        sql.includes(
          "SELECT * FROM flowdesk.routing_rules WHERE organization_id = $1 ORDER BY priority ASC"
        )
      ) {
        const orgId = values[0] as string;
        const matching = Array.from(rules.values())
          .filter((r) => r.organization_id === orgId)
          .sort((a, b) => a.priority - b.priority);
        return { rows: matching, rowCount: matching.length, command: "SELECT", oid: 0, fields: [] };
      }

      if (sql.includes("UPDATE flowdesk.routing_rules SET")) {
        const orgId = values[7] as string;
        const ruleId = values[8] as string;
        const row = rules.get(ruleId);
        if (row && row.organization_id === orgId) {
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
        const orgId = values[0] as string;
        const ruleId = values[1] as string;
        const row = rules.get(ruleId);
        if (row && row.organization_id === orgId) {
          rules.delete(ruleId);
          return { rows: [], rowCount: 1, command: "DELETE", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "DELETE", oid: 0, fields: [] };
      }

      if (sql.includes("INSERT INTO flowdesk.routing_logs")) {
        const id = `log-${counter++}`;
        const row: MockLogRow = {
          id,
          organization_id: values[0] as string,
          conversation_id: values[1] as string,
          matched_rule_id: values[2] as string | null,
          matched_policy_rule_id: values[3] as string | null,
          target_queue_id: values[4] as string | null,
          target_team_id: values[5] as string | null,
          target_user_id: values[6] as string | null,
          reason: values[7] as string,
          routed_at: new Date()
        };
        logs.push(row);
        return { rows: [row], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      if (
        sql.includes(
          "SELECT * FROM flowdesk.routing_logs WHERE organization_id = $1 AND conversation_id = $2"
        )
      ) {
        const orgId = values[0] as string;
        const convId = values[1] as string;
        const matching = logs.filter(
          (l) => l.organization_id === orgId && l.conversation_id === convId
        );
        return { rows: matching, rowCount: matching.length, command: "SELECT", oid: 0, fields: [] };
      }

      return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
    }
  } as unknown as DbClient;
}

describe("Routing Repository (M5-01)", () => {
  it("creates, retrieves, and lists routing rules sorted by priority", async () => {
    const db = createMockDb();

    const rule1 = await createRoutingRule(db, {
      organizationId: mockOrgId,
      name: "Default Wa Queue",
      priority: 100,
      conditions: { channelId: "ch-wa" }
    });

    const rule2 = await createRoutingRule(db, {
      organizationId: mockOrgId,
      name: "VIP High Priority",
      priority: 10,
      conditions: { tag: "vip" }
    });

    expect(rule1.name).toBe("Default Wa Queue");
    expect(rule2.priority).toBe(10);

    const fetched = await getRoutingRuleById(db, mockOrgId, rule2.id);
    expect(fetched?.name).toBe("VIP High Priority");

    const rulesList = await listRoutingRules(db, mockOrgId);
    expect(rulesList).toHaveLength(2);
    expect(rulesList[0]?.id).toBe(rule2.id); // Priority 10 comes first
    expect(rulesList[1]?.id).toBe(rule1.id); // Priority 100 comes second
  });

  it("updates and deletes a routing rule", async () => {
    const db = createMockDb();
    const created = await createRoutingRule(db, {
      organizationId: mockOrgId,
      name: "Initial Rule",
      priority: 50
    });

    const updated = await updateRoutingRule(db, mockOrgId, created.id, {
      name: "Updated Rule",
      priority: 20,
      isActive: false
    });

    expect(updated?.name).toBe("Updated Rule");
    expect(updated?.priority).toBe(20);
    expect(updated?.isActive).toBe(false);

    const deleted = await deleteRoutingRule(db, mockOrgId, created.id);
    expect(deleted).toBe(true);

    const afterDelete = await getRoutingRuleById(db, mockOrgId, created.id);
    expect(afterDelete).toBeNull();
  });

  it("records and retrieves routing execution logs", async () => {
    const db = createMockDb();
    const log = await recordRoutingLog(db, {
      organizationId: mockOrgId,
      conversationId: mockConvId,
      matchedRuleId: "rule-1",
      targetQueueId: "queue-1",
      reason: "Matched VIP rule"
    });

    expect(log.conversationId).toBe(mockConvId);
    expect(log.reason).toBe("Matched VIP rule");

    const logs = await listRoutingLogsForConversation(db, mockOrgId, mockConvId);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.matchedRuleId).toBe("rule-1");
  });
});
