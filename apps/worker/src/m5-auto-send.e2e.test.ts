/**
 * M5-06: Milestone 5 End-to-End Verification Test Suite
 */
import { describe, expect, it } from "vitest";
import type { DbClient } from "@flowdesk/db";
import { evaluateRoutingRules } from "@flowdesk/domain";
import { evaluateAndProcessAutoSend } from "./auto-send.js";

const orgId = "a0000000-0000-4000-8000-000000000001";
const convId = "b0000000-0000-7000-8000-000000000001";
const chanId = "c0000000-0000-4000-8000-000000000001";
const queueId = "q0000000-0000-4000-8000-000000000001";

function createMockE2eDb(): DbClient {
  return {
    async query(queryText: string) {
      await Promise.resolve();
      const sql = queryText.replace(/\s+/g, " ").trim();

      if (sql.includes("COUNT(*)")) {
        return {
          rows: [{ count: "0" }],
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }

      if (sql.includes("INSERT INTO flowdesk.messages")) {
        return {
          rows: [
            {
              id: "msg-e2e-m5-1",
              organizationId: orgId,
              conversationId: convId,
              channelId: chanId,
              direction: "outbound",
              senderType: "bot",
              content: "Simulated auto response",
              status: "queued",
              sentAt: new Date()
            }
          ],
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

describe("M5 Full Pipeline E2E Integration (M5-06)", () => {
  it("routes inbound message to queue and dispatches policy-validated auto-send response", async () => {
    const db = createMockE2eDb();

    // 1. Evaluate routing rule
    const routingResult = evaluateRoutingRules(
      [
        {
          id: "rule-1",
          organizationId: orgId,
          name: "VIP Support Queue Route",
          priority: 1,
          conditions: { tag: "vip" },
          targetQueueId: queueId,
          targetTeamId: null,
          targetUserId: null,
          isActive: true
        }
      ],
      {
        channelId: chanId,
        tags: ["vip"],
        isWithinBusinessHours: true
      }
    );

    expect(routingResult.matchedRule?.id).toBe("rule-1");
    expect(routingResult.targetQueueId).toBe(queueId);

    // 2. Evaluate and process auto-send pipeline
    const autoSendResult = evaluateAndProcessAutoSend(db, {
      organizationId: orgId,
      conversationId: convId,
      channelId: chanId,
      confidenceScore: 0.96,
      draftContent: "Halo VIP Customer, tim kami siap membantu.",
      isWithinBusinessHours: true,
      isWithinServiceWindow: true,
      botMode: "auto"
    });

    const res = await autoSendResult;
    expect(res.autoSent).toBe(true);
    expect(res.messageId).toBe("msg-e2e-m5-1");
    expect(res.content).toContain("_Balasan otomatis oleh AI FlowDesk_");
  });
});
