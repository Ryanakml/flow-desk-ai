import { describe, expect, it } from "vitest";
import type { DbClient } from "./auth.js";
import {
  cancelPendingAutomationForConversation,
  resolveAutomationSafety,
  upsertAutomationSafetyControl
} from "./automation-safety.js";

function result<T>(rows: T[], rowCount = rows.length) {
  return { rows, rowCount, command: "SELECT", oid: 0, fields: [] };
}

// These tests guard the durable DB safety boundary used by both AUTO creation and dispatch.
describe("automation safety controls", () => {
  it("resolves the active scoped safety control", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const db = {
      async query(sql: string, params?: unknown[]) {
        await Promise.resolve();
        calls.push(params === undefined ? { sql } : { sql, params });
        return result([
          {
            control_id: "10000000-0000-4000-8000-000000000001",
            scope: "conversation",
            reason: "Operator takeover",
            expires_at: null
          }
        ]);
      }
    } as unknown as DbClient;

    const safety = await resolveAutomationSafety(db, {
      organizationId: "20000000-0000-4000-8000-000000000001",
      conversationId: "30000000-0000-4000-8000-000000000001"
    });

    expect(safety).toEqual({
      controlId: "10000000-0000-4000-8000-000000000001",
      scope: "conversation",
      reason: "Operator takeover",
      expiresAt: null
    });
    expect(calls[0]?.sql).toContain("resolve_automation_safety");
  });

  it("upserts tenant controls with a partial-index conflict target", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const now = new Date();
    const db = {
      async query(sql: string, params?: unknown[]) {
        await Promise.resolve();
        calls.push(params === undefined ? { sql } : { sql, params });
        return result([
          {
            id: "10000000-0000-4000-8000-000000000002",
            organization_id: "20000000-0000-4000-8000-000000000001",
            scope: "tenant",
            scope_id: null,
            disabled: true,
            reason: "Incident response",
            actor_user_id: "40000000-0000-4000-8000-000000000001",
            expires_at: null,
            created_at: now,
            updated_at: now
          }
        ]);
      }
    } as unknown as DbClient;

    const control = await upsertAutomationSafetyControl(db, {
      organizationId: "20000000-0000-4000-8000-000000000001",
      scope: "tenant",
      disabled: true,
      reason: "Incident response",
      actorUserId: "40000000-0000-4000-8000-000000000001"
    });

    expect(control.disabled).toBe(true);
    expect(control.scope).toBe("tenant");
    expect(calls[0]?.sql).toContain("ON CONFLICT (organization_id, scope) WHERE scope = 'tenant'");
  });

  it("cancels active AUTO runs and queued bot outbound work", async () => {
    const sql: string[] = [];
    const now = new Date();
    const db = {
      async query(statement: string) {
        await Promise.resolve();
        sql.push(statement);
        if (statement.includes("UPDATE flowdesk.bot_runs")) return result([], 2);
        if (statement.includes("UPDATE flowdesk.messages AS message")) return result([], 1);
        if (statement.includes("UPDATE flowdesk.outbound_intents")) return result([], 1);
        if (statement.includes("INSERT INTO flowdesk.audit_logs")) {
          return result([
            {
              id: "50000000-0000-4000-8000-000000000001",
              occurred_at: now
            }
          ]);
        }
        return result([], 1);
      }
    } as unknown as DbClient;

    const cancelled = await cancelPendingAutomationForConversation(db, {
      organizationId: "20000000-0000-4000-8000-000000000001",
      conversationId: "30000000-0000-4000-8000-000000000001",
      reason: "Human takeover",
      actorUserId: "40000000-0000-4000-8000-000000000001"
    });

    expect(cancelled).toEqual({ runsCancelled: 2, messagesCancelled: 1 });
    expect(sql.some((statement) => statement.includes("status = 'cancelled'"))).toBe(true);
    expect(sql.some((statement) => statement.includes("intent.state = 'queued'"))).toBe(true);
    expect(sql.some((statement) => statement.includes("INSERT INTO flowdesk.audit_logs"))).toBe(
      true
    );
  });
});
