import { describe, expect, it } from "vitest";
import { listAuditLogs, recordAuditEvent, redactSensitiveMetadata } from "./audit.js";
import type { DbClient } from "./auth.js";

function createMockDb(): DbClient {
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

  const logs: AuditRow[] = [];

  return {
    async query(sqlText: string, values: unknown[] = []) {
      await Promise.resolve();
      const sql = sqlText.replace(/\s+/g, " ").trim();

      // INSERT
      if (sql.includes("INSERT INTO flowdesk.audit_logs")) {
        const [orgId, actorId, action, targetType, targetId, result, corrId, metaJson] = values as [
          string,
          string | null,
          string,
          string,
          string | null,
          "allowed" | "denied" | "failed",
          string | null,
          string
        ];

        const id = `a0000000-0000-4000-8000-${String(logs.length + 1).padStart(12, "0")}`;
        const occurredAt = new Date();
        logs.unshift({
          id,
          organization_id: orgId,
          actor_user_id: actorId,
          action,
          target_type: targetType,
          target_id: targetId,
          result,
          correlation_id: corrId,
          metadata: JSON.parse(metaJson) as Record<string, unknown>,
          occurred_at: occurredAt
        });

        return { rows: [{ id, occurred_at: occurredAt }] };
      }

      // SELECT
      if (sql.includes("FROM flowdesk.audit_logs")) {
        const orgId = values[0] as string;
        let filtered = logs.filter((l) => l.organization_id === orgId);

        // Action filter
        if (sql.includes("action =")) {
          const actionVal = values.find((v) => typeof v === "string" && v.includes(":"));
          if (actionVal) {
            filtered = filtered.filter((l) => l.action === actionVal);
          }
        }

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

describe("Audit DB Repository (M1-06)", () => {
  describe("redactSensitiveMetadata", () => {
    it("redacts sensitive keys while preserving safe fields", () => {
      const input = {
        clientIp: "192.168.1.1",
        apiToken: "super-secret-token",
        passwordHash: "hash-123",
        secretKey: "key-abc",
        sessionCookie: "cookie-xyz",
        nested: {
          authorizationHeader: "Bearer 12345",
          userRole: "admin",
          privateData: "hidden"
        },
        list: [{ token: "token-1" }, { name: "item-1" }]
      };

      const redacted = redactSensitiveMetadata(input) as Record<string, unknown>;

      expect(redacted["clientIp"]).toBe("192.168.1.1");
      expect(redacted["apiToken"]).toBe("[REDACTED]");
      expect(redacted["passwordHash"]).toBe("[REDACTED]");
      expect(redacted["secretKey"]).toBe("[REDACTED]");
      expect(redacted["sessionCookie"]).toBe("[REDACTED]");

      const nested = redacted["nested"] as Record<string, unknown>;
      expect(nested["authorizationHeader"]).toBe("[REDACTED]");
      expect(nested["userRole"]).toBe("admin");
      expect(nested["privateData"]).toBe("[REDACTED]");

      const list = redacted["list"] as Array<Record<string, unknown>>;
      expect(list[0]!["token"]).toBe("[REDACTED]");
      expect(list[1]!["name"]).toBe("item-1");
    });
  });

  describe("recordAuditEvent & listAuditLogs", () => {
    it("records audit events with sensitive metadata redacted", async () => {
      const db = createMockDb();
      const rec = await recordAuditEvent(db, {
        organizationId: "a0000000-0000-4000-8000-000000000001",
        actorUserId: "a0000000-0000-4000-8000-000000000002",
        action: "membership:invited",
        targetType: "invitation",
        targetId: "a0000000-0000-4000-8000-000000000003",
        result: "allowed",
        metadata: {
          invitedEmail: "alice@example.com",
          token: "plaintext-token-should-not-persist"
        }
      });

      expect(rec.id).toBeDefined();
      expect(rec.occurredAt).toBeDefined();

      const list = await listAuditLogs(db, {
        organizationId: "a0000000-0000-4000-8000-000000000001",
        limit: 10
      });

      expect(list.items.length).toBe(1);
      expect(list.items[0]?.action).toBe("membership:invited");
      expect(list.items[0]?.metadata["invitedEmail"]).toBe("alice@example.com");
      expect(list.items[0]?.metadata["token"]).toBe("[REDACTED]");
    });

    it("returns cursor pagination for audit logs", async () => {
      const db = createMockDb();
      const orgId = "a0000000-0000-4000-8000-000000000001";

      for (let i = 0; i < 3; i++) {
        await recordAuditEvent(db, {
          organizationId: orgId,
          action: `action:${i}`,
          targetType: "test",
          result: "allowed"
        });
      }

      const page1 = await listAuditLogs(db, {
        organizationId: orgId,
        limit: 2
      });

      expect(page1.items.length).toBe(2);
      expect(page1.pageInfo.hasNextPage).toBe(true);
      expect(page1.pageInfo.startCursor).toBeDefined();
      expect(page1.pageInfo.endCursor).toBeDefined();
    });
  });
});
