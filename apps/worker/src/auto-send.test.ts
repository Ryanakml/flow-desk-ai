import { describe, expect, it } from "vitest";
import type { DbClient } from "@flowdesk/db";
import { evaluateAndProcessAutoSend } from "./auto-send.js";

const mockOrgId = "a0000000-0000-4000-8000-000000000001";
const mockConvId = "b0000000-0000-7000-8000-000000000001";
const mockChanId = "c0000000-0000-4000-8000-000000000001";

function createMockWorkerDb(recentCount = 0): DbClient {
  return {
    async query(queryText: string) {
      await Promise.resolve();
      const sql = queryText.replace(/\s+/g, " ").trim();

      if (sql.includes("COUNT(*)")) {
        return {
          rows: [{ count: String(recentCount) }],
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
              id: "msg-auto-1",
              organizationId: mockOrgId,
              conversationId: mockConvId,
              channelId: mockChanId,
              direction: "outbound",
              senderType: "bot",
              content: "Draft response",
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

describe("Worker Auto-Send Pipeline (M5-02)", () => {
  it("auto-sends message when policy criteria pass", async () => {
    const db = createMockWorkerDb(0);
    const result = await evaluateAndProcessAutoSend(db, {
      organizationId: mockOrgId,
      conversationId: mockConvId,
      channelId: mockChanId,
      confidenceScore: 0.95,
      draftContent: "Terima kasih telah menghubungi kami.",
      isWithinBusinessHours: true,
      isWithinServiceWindow: true,
      botMode: "auto"
    });

    expect(result.autoSent).toBe(true);
    expect(result.messageId).toBe("msg-auto-1");
    expect(result.content).toContain("_Balasan otomatis oleh AI FlowDesk_");
  });

  it("downgrades run and does not send when policy fails", async () => {
    const db = createMockWorkerDb(0);
    const result = await evaluateAndProcessAutoSend(db, {
      organizationId: mockOrgId,
      conversationId: mockConvId,
      channelId: mockChanId,
      confidenceScore: 0.7, // low confidence
      draftContent: "Jawaban ragu-ragu",
      isWithinBusinessHours: true,
      isWithinServiceWindow: true,
      botMode: "auto"
    });

    expect(result.autoSent).toBe(false);
    expect(result.messageId).toBeUndefined();
    expect(result.reason).toContain("below threshold");
  });
});
