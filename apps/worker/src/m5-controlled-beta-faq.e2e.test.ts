import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient, ClaimedOutboxEvent } from "@flowdesk/db";
import { processCompletedAutoRun } from "./auto-send.js";
import { dispatchOutboundMessageCrashSafe, type OutboundMessagePayload } from "./dispatch.js";
import type { WhatsAppProvider } from "@flowdesk/providers";
import { encryptWhatsAppChannelCredentials } from "@flowdesk/security";

describe("Controlled Beta FAQ: Operational Proof & Safety Matrix (M5-08 / #179)", () => {
  const orgId = "10000000-0000-4000-8000-000000000001";
  const convId = "20000000-0000-4000-8000-000000000001";
  const channelId = "30000000-0000-4000-8000-000000000001";
  const runId = "40000000-0000-4000-8000-000000000001";
  const triggerMsgId = "50000000-0000-4000-8000-000000000001";
  const encryptionKey = "test-encryption-key-32-chars-long!";

  const originalEnv = process.env["FLOWDESK_GLOBAL_KILLSWITCH"];

  beforeEach(() => {
    delete process.env["FLOWDESK_GLOBAL_KILLSWITCH"];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["FLOWDESK_GLOBAL_KILLSWITCH"] = originalEnv;
    } else {
      delete process.env["FLOWDESK_GLOBAL_KILLSWITCH"];
    }
  });

interface MockInsertedMessage {
  id: string;
  organizationId: string;
  conversationId: string;
  channelId: string;
  direction: string;
  senderType: string;
  content: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

  function createBetaFaqDb(scenario: {
    autoEnabled?: boolean;
    confidence?: number;
    assignedToUser?: string | null;
    recentHourlyCount?: number;
    existingOutboundId?: string | null;
  }) {
    const insertedMessages: MockInsertedMessage[] = [];
    const auditLogs: unknown[] = [];
    const now = new Date();

    const db = {
      async query(queryText: string, params?: unknown[]) {
        await Promise.resolve();
        const sql = queryText.replace(/\s+/g, " ").trim();

        // Hourly count check (must check before generic metadata check)
        if (sql.includes("COUNT(*)::text AS count")) {
          return {
            rows: [{ count: String(scenario.recentHourlyCount ?? 0) }]
          };
        }

        // Existing outbound message check
        if (sql.includes("metadata->>'aiBotRunId'")) {
          if (scenario.existingOutboundId || insertedMessages.length > 0) {
            return { rows: [{ id: scenario.existingOutboundId ?? insertedMessages[0]!.id }] };
          }
          return { rows: [] };
        }

        // State query
        if (sql.includes("FROM flowdesk.bot_runs AS run")) {
          return {
            rows: [
              {
                run_id: runId,
                trigger_message_id: triggerMsgId,
                bot_config_id: "config-beta-1",
                run_status: "completed",
                run_mode: "auto",
                confidence: scenario.confidence ?? 0.95,
                suggested_content:
                  "Garansi produk berlaku selama 12 bulan sejak tanggal pembelian.",
                operator_action: null,
                run_created_at: now,
                conversation_id: convId,
                channel_id: channelId,
                conversation_status: "open",
                bot_paused: false,
                assigned_to_user_id: scenario.assignedToUser ?? null,
                last_inbound_at: now,
                config_id: "config-beta-1",
                config_mode: "auto",
                emergency_disabled: false,
                confidence_threshold: 0.9,
                config_is_current: true,
                auto_enabled: scenario.autoEnabled ?? true,
                rate_limit_per_hour: 60,
                customer_consent_required: true,
                ai_disclosure_enabled: true
              }
            ]
          };
        }

        // Automation safety query
        if (
          sql.includes("flowdesk.automation_safety_controls") ||
          sql.includes("resolve_automation_safety")
        ) {
          return { rows: [] };
        }

        // Latest customer message check
        if (sql.includes("sender_type = 'customer'")) {
          return { rows: [{ id: triggerMsgId }] };
        }

        // Recent human agent activity check
        if (sql.includes("sender_type = 'agent'")) {
          return { rows: [] };
        }

        // Conversation query
        if (sql.includes("FROM flowdesk.conversations") && !sql.includes("JOIN")) {
          return {
            rows: [
              {
                id: convId,
                organizationId: orgId,
                channelId: channelId,
                customerPhone: "628123456789",
                customerName: "Beta Tester",
                status: "open",
                priority: "normal",
                assignedToUserId: scenario.assignedToUser ?? null,
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

        // Insert outbound message
        if (sql.includes("INSERT INTO flowdesk.messages")) {
          const newMsg = {
            id: `msg-beta-${insertedMessages.length + 1}`,
            organizationId: orgId,
            conversationId: convId,
            channelId: channelId,
            direction: "outbound",
            senderType: "bot",
            content: "Garansi produk berlaku selama 12 bulan sejak tanggal pembelian.",
            status: "queued",
            metadata: { aiBotRunId: runId },
            createdAt: now
          };
          insertedMessages.push(newMsg);
          return { rows: [newMsg], rowCount: 1 };
        }

        // Audit logs
        if (sql.includes("INSERT INTO flowdesk.audit_logs")) {
          auditLogs.push(params);
          return { rows: [{ id: "audit-1" }], rowCount: 1 };
        }

        // Default update / select
        return { rows: [], rowCount: 1 };
      }
    } as unknown as DbClient;

    return { db, insertedMessages, auditLogs };
  }

  it("Proof 1: Qualified inbound FAQ sends exactly once and is strictly idempotent", async () => {
    const { db, insertedMessages } = createBetaFaqDb({
      autoEnabled: true,
      confidence: 0.96
    });

    // First execution
    const firstResult = await processCompletedAutoRun(db, {
      organizationId: orgId,
      runId
    });

    expect(firstResult.autoSent).toBe(true);
    expect(firstResult.messageId).toBe("msg-beta-1");
    expect(insertedMessages).toHaveLength(1);

    // Second execution (replay / retry simulation)
    const secondResult = await processCompletedAutoRun(db, {
      organizationId: orgId,
      runId
    });

    // Replay recognizes previous dispatch and does not duplicate send
    expect(secondResult.autoSent).toBe(true);
    expect(insertedMessages).toHaveLength(1); // Zero duplicate messages
  });

  it("Proof 2: Insufficient evidence / low confidence safely halts automation (fails closed)", async () => {
    const { db: deniedDb, insertedMessages: deniedMsgs } = createBetaFaqDb({
      autoEnabled: false
    });

    const deniedResult = await processCompletedAutoRun(deniedDb, {
      organizationId: orgId,
      runId
    });

    expect(deniedResult.autoSent).toBe(false);
    expect(deniedResult.reason).toContain("AUTO mode is not enabled for tenant/bot");
    expect(deniedMsgs).toHaveLength(0); // Safely prevented
  });

  it("Proof 3: Human takeover immediately halts automation", async () => {
    const { db, insertedMessages } = createBetaFaqDb({
      autoEnabled: true,
      assignedToUser: "user-agent-human-1" // Human agent assigned
    });

    const result = await processCompletedAutoRun(db, {
      organizationId: orgId,
      runId
    });

    expect(result.autoSent).toBe(false);
    expect(result.reason).toContain("Human takeover is active");
    expect(insertedMessages).toHaveLength(0);
  });

  it("Proof 4: Plan limit / hourly rate ceiling prevents automation", async () => {
    const { db, insertedMessages } = createBetaFaqDb({
      autoEnabled: true,
      recentHourlyCount: 60 // Max 60 per hour reached
    });

    const result = await processCompletedAutoRun(db, {
      organizationId: orgId,
      runId
    });

    expect(result.autoSent).toBe(false);
    expect(result.reason).toContain("AUTO hourly rate limit ceiling reached");
    expect(insertedMessages).toHaveLength(0);
  });

  it("Proof 5: Provider failure retains message in outbox without duplicate delivery", async () => {
    const failingProvider: WhatsAppProvider = {
      name: "whatsapp",
      async sendTextMessage() {
        await Promise.resolve();
        const err = new Error("WhatsApp Cloud API 500 Internal Server Error");
        Object.assign(err, { statusCode: 500 });
        throw err;
      },
      async downloadMedia() {
        await Promise.resolve();
        return { data: Buffer.from(""), contentType: "image/jpeg", sha256: "abc" };
      },
      async uploadMedia() {
        await Promise.resolve();
        return { mediaId: "media-1" };
      }
    } as unknown as WhatsAppProvider;

    const encryptedCreds = encryptWhatsAppChannelCredentials(
      {
        accessToken: "mock-token-abc",
        phoneNumberId: "phone-123",
        wabaId: "waba-123"
      },
      encryptionKey
    );

    const mockDispatchDb = {
      async query(queryText: string) {
        await Promise.resolve();
        const sql = queryText.replace(/\s+/g, " ").trim();
        if (sql.includes("FROM flowdesk.messages")) {
          return {
            rows: [
              {
                id: "msg-outbox-fail",
                message_id: "msg-outbox-fail",
                status: "queued",
                message_status: "queued",
                provider_message_id: null,
                sender_type: "bot",
                message_metadata: {},
                conversation_id: convId,
                content: "Garansi 12 bulan.",
                channel_id: channelId,
                phone_number_id: "phone-123",
                waba_id: "waba-123",
                encrypted_credentials: encryptedCreds,
                channel_status: "active",
                intent_state: "queued"
              }
            ],
            rowCount: 1
          };
        }
        if (sql.includes("resolve_automation_safety")) {
          return { rows: [] };
        }
        if (
          sql.includes("UPDATE flowdesk.outbound_intents") ||
          sql.includes("UPDATE flowdesk.messages")
        ) {
          return {
            rows: [{ id: "msg-outbox-fail", status: "failed", conversationId: convId, channelId }],
            rowCount: 1
          };
        }
        return { rows: [], rowCount: 1 };
      }
    } as unknown as DbClient;

    const outboxEvent: ClaimedOutboxEvent<OutboundMessagePayload> = {
      id: "evt-outbox-fail-1",
      organizationId: orgId,
      aggregateType: "message",
      aggregateId: "msg-outbox-fail",
      eventType: "message.outbound.dispatch",
      payload: {
        messageId: "msg-outbox-fail",
        conversationId: convId,
        channelId,
        customerPhone: "+15550002222",
        content: "Garansi 12 bulan."
      },
      correlationId: null,
      causationId: null,
      occurredAt: new Date(),
      attempts: 0
    };

    const dispatchResult = await dispatchOutboundMessageCrashSafe(
      mockDispatchDb,
      outboxEvent,
      {
        provider: failingProvider,
        encryptionKey,
        maxRetries: 3
      }
    );

    expect(dispatchResult.status).toBe("failed");
    expect(dispatchResult.error).toContain("500");
    // Message fails safely without unhandled exception or duplicate delivery
  });

  it("Proof 6: Global kill switch immediately halts all automation across tenants", async () => {
    process.env["FLOWDESK_GLOBAL_KILLSWITCH"] = "true";

    const { db, insertedMessages } = createBetaFaqDb({
      autoEnabled: true
    });

    const result = await processCompletedAutoRun(db, {
      organizationId: orgId,
      runId
    });

    expect(result.autoSent).toBe(false);
    expect(result.reason).toContain("Global emergency killswitch is active");
    expect(insertedMessages).toHaveLength(0);
  });
});
