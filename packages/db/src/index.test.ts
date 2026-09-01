import { describe, expect, it, vi } from "vitest";
import {
  assertLocalDatabaseReset,
  createDatabaseId,
  DATABASE_ROLE_NAMES,
  getConversationWithMessages,
  runInTenantTransaction
} from "./index.js";
import type { Pool, PoolClient } from "pg";

describe("assertLocalDatabaseReset", () => {
  it("rejects non-local environments", () =>
    expect(() => assertLocalDatabaseReset("staging")).toThrow());

  it("creates UUIDv7 identifiers", () => {
    expect(createDatabaseId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("keeps the runtime role explicitly non-privileged", () => {
    expect(DATABASE_ROLE_NAMES.runtime).toBe("flowdesk_runtime");
  });
});

describe("runInTenantTransaction nested client reuse", () => {
  it("reuses the active PoolClient inside nested transaction calls without re-connecting", async () => {
    const queryLog: string[] = [];
    const clientQuery = vi.fn().mockImplementation(async (sql: string) => {
      await Promise.resolve();
      queryLog.push(sql);
      if (sql.includes("FROM flowdesk.conversations")) {
        return {
          rows: [
            {
              id: "conv-1",
              organization_id: "org-1",
              channel_id: "chan-1",
              customer_id: "cust-1",
              status: "open",
              priority: "medium",
              assigned_to_user_id: null,
              first_inbound_at: new Date(),
              last_inbound_at: new Date(),
              last_outbound_at: null,
              last_message_at: new Date(),
              closed_at: null,
              created_at: new Date(),
              updated_at: new Date()
            }
          ]
        };
      }
      if (sql.includes("FROM flowdesk.messages")) {
        return {
          rows: [
            {
              id: "msg-1",
              organization_id: "org-1",
              conversation_id: "conv-1",
              channel_id: "chan-1",
              customer_id: "cust-1",
              sender_type: "customer",
              sender_id: "cust-1",
              content: "Halo, ada garansi?",
              content_type: "text",
              sent_at: new Date(),
              delivered_at: null,
              read_at: null,
              created_at: new Date(),
              updated_at: new Date()
            }
          ]
        };
      }
      return { rows: [] };
    });

    const mockPoolClient: Partial<PoolClient> = {
      query: clientQuery,
      release: vi.fn(),
      connect: vi
        .fn()
        .mockRejectedValue(
          new Error("Client has already been connected. You cannot reuse a client.")
        )
    };

    const mockPool: Partial<Pool> = {
      connect: vi.fn().mockResolvedValue(mockPoolClient),
      totalCount: 10,
      idleCount: 5,
      waitingCount: 0
    };

    const result = await runInTenantTransaction(
      mockPool as Pool,
      { organizationId: "org-1" },
      async (tx) => {
        const nestedResult = await getConversationWithMessages(
          tx,
          { organizationId: "org-1" },
          "conv-1"
        );
        return nestedResult;
      }
    );

    expect(result).not.toBeNull();
    expect(result?.conversation.id).toBe("conv-1");
    expect(result?.messages).toHaveLength(1);
    expect(mockPool.connect).toHaveBeenCalledTimes(1);
    expect(mockPoolClient.connect).not.toHaveBeenCalled();
    expect(mockPoolClient.release).toHaveBeenCalledTimes(1);
    expect(queryLog).toContain("BEGIN");
    expect(queryLog).toContain("SET LOCAL search_path = flowdesk, public");
    expect(queryLog).toContain("COMMIT");
  });
});
