import { describe, expect, it } from "vitest";
import type { DbClient } from "@flowdesk/db";
import { evaluateAndProcessAutoSend, processCompletedAutoRun } from "./auto-send.js";

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

function createCompletedAutoRunDb(
  overrides: Partial<{
    assignedToUserId: string | null;
    botPaused: boolean;
    latestMessageId: string;
    emergencyDisabled: boolean;
    durableSafety: {
      control_id: string;
      scope: "global" | "tenant" | "bot" | "channel" | "conversation";
      reason: string;
      expires_at: Date | null;
    } | null;
  }> = {}
) {
  const now = new Date();
  const calls: string[] = [];
  const db = {
    async query(queryText: string) {
      await Promise.resolve();
      const sql = queryText.replace(/\s+/g, " ").trim();
      calls.push(sql);
      if (sql.includes("resolve_automation_safety")) {
        return { rows: overrides.durableSafety ? [overrides.durableSafety] : [] };
      }
      if (sql.includes("metadata->>'aiBotRunId'")) return { rows: [] };
      if (sql.includes("FROM flowdesk.bot_runs AS run")) {
        return {
          rows: [
            {
              run_id: "run-auto-1",
              trigger_message_id: "inbound-1",
              bot_config_id: "config-1",
              run_status: "completed",
              run_mode: "auto",
              confidence: 0.97,
              suggested_content: "Garansi berlaku satu tahun.",
              operator_action: null,
              run_created_at: now,
              conversation_id: mockConvId,
              conversation_status: "open",
              bot_paused: overrides.botPaused ?? false,
              assigned_to_user_id: overrides.assignedToUserId ?? null,
              last_inbound_at: now,
              config_id: "config-1",
              config_mode: "auto",
              emergency_disabled: overrides.emergencyDisabled ?? false,
              confidence_threshold: 0.9,
              config_is_current: true
            }
          ]
        };
      }
      if (sql.includes("sender_type = 'customer'")) {
        return { rows: [{ id: overrides.latestMessageId ?? "inbound-1" }] };
      }
      if (sql.includes("sender_type = 'agent'")) return { rows: [] };
      if (sql.includes("count(*) AS count")) return { rows: [{ count: "0" }] };
      if (sql.includes("FROM flowdesk.conversations") && !sql.includes("JOIN")) {
        return {
          rows: [
            {
              id: mockConvId,
              organizationId: mockOrgId,
              channelId: mockChanId,
              customerPhone: "628123456789",
              customerName: "Customer",
              status: "open",
              priority: "normal",
              assignedToUserId: null,
              queueId: null,
              teamId: null,
              waitingReason: null,
              botPaused: false,
              version: 1,
              lastMessageAt: now,
              lastInboundAt: now,
              metadata: {},
              createdAt: now,
              updatedAt: now
            }
          ]
        };
      }
      if (sql.includes("INSERT INTO flowdesk.messages")) {
        return {
          rows: [
            {
              id: "outbound-auto-1",
              organizationId: mockOrgId,
              conversationId: mockConvId,
              channelId: mockChanId,
              direction: "outbound",
              senderType: "bot",
              senderUserId: null,
              providerMessageId: null,
              content: "Garansi berlaku satu tahun.",
              status: "queued",
              errorDetail: null,
              metadata: {},
              sentAt: now,
              deliveredAt: null,
              readAt: null,
              createdAt: now,
              updatedAt: now
            }
          ]
        };
      }
      if (sql.includes("INSERT INTO flowdesk.audit_logs")) {
        return { rows: [{ id: "audit-1", occurred_at: now }] };
      }
      return { rows: [], rowCount: 1 };
    }
  } as unknown as DbClient;
  return { db, calls };
}

describe("completed AUTO run final gate (#178)", () => {
  it("creates the normal outbox path exactly once after final state validation", async () => {
    const { db, calls } = createCompletedAutoRunDb();
    const result = await processCompletedAutoRun(db, {
      organizationId: mockOrgId,
      runId: "run-auto-1"
    });
    expect(result).toMatchObject({ autoSent: true, messageId: "outbound-auto-1" });
    expect(calls.some((sql) => sql.includes("INSERT INTO flowdesk.outbox_events"))).toBe(true);
    expect(calls.some((sql) => sql.includes("operator_action = 'auto_sent'"))).toBe(true);
  });

  it("fails closed for takeover before creating an outbound message", async () => {
    const { db, calls } = createCompletedAutoRunDb({ assignedToUserId: "user-1" });
    const result = await processCompletedAutoRun(db, {
      organizationId: mockOrgId,
      runId: "run-auto-1"
    });
    expect(result.autoSent).toBe(false);
    expect(result.reason).toContain("takeover");
    expect(calls.some((sql) => sql.includes("INSERT INTO flowdesk.messages"))).toBe(false);
  });

  it("marks a newer-inbound result stale and does not send", async () => {
    const { db, calls } = createCompletedAutoRunDb({ latestMessageId: "inbound-2" });
    const result = await processCompletedAutoRun(db, {
      organizationId: mockOrgId,
      runId: "run-auto-1"
    });
    expect(result.autoSent).toBe(false);
    expect(result.reason).toContain("newer customer message");
    expect(calls.some((sql) => sql.includes("INSERT INTO flowdesk.messages"))).toBe(false);
  });

  it("denies AUTO dispatch when a durable global safety stop is active (#177)", async () => {
    const { db, calls } = createCompletedAutoRunDb({
      durableSafety: {
        control_id: "00000000-0000-4000-8000-000000000099",
        scope: "global",
        reason: "M5 staging acceptance global halt",
        expires_at: null
      }
    });
    const result = await processCompletedAutoRun(db, {
      organizationId: mockOrgId,
      runId: "run-auto-1"
    });
    expect(result.autoSent).toBe(false);
    expect(result.reason).toBe(
      "Automation safety stop is active (global): M5 staging acceptance global halt"
    );
    expect(calls.some((sql) => sql.includes("INSERT INTO flowdesk.messages"))).toBe(false);
    expect(calls.some((sql) => sql.includes("INSERT INTO flowdesk.outbox_events"))).toBe(false);
  });

  it("allows AUTO dispatch when durable safety is inactive/cleared (#177)", async () => {
    const { db, calls } = createCompletedAutoRunDb({
      durableSafety: null
    });
    const result = await processCompletedAutoRun(db, {
      organizationId: mockOrgId,
      runId: "run-auto-1"
    });
    expect(result.autoSent).toBe(true);
    expect(calls.some((sql) => sql.includes("INSERT INTO flowdesk.messages"))).toBe(true);
    expect(calls.some((sql) => sql.includes("INSERT INTO flowdesk.outbox_events"))).toBe(true);
  });
});
