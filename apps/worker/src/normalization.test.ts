import { describe, expect, it } from "vitest";
import type { DbClient } from "@flowdesk/db";
import { FakeWhatsAppProvider } from "@flowdesk/providers";
import {
  normalizeCustomerPhone,
  parseWhatsAppWebhook,
  processOutboxWebhookBatch,
  processWebhookPayload
} from "./normalization.js";

describe("Customer Phone Normalization (M2-06)", () => {
  it("normalizes phone numbers to standard E.164 digits without symbols", () => {
    expect(normalizeCustomerPhone("+62 812-3456-7890")).toBe("6281234567890");
    expect(normalizeCustomerPhone("+1 (650) 555-0199")).toBe("16505550199");
    expect(normalizeCustomerPhone("08123456789")).toBe("08123456789");
  });
});

describe("Meta WhatsApp Webhook Parser (M2-06)", () => {
  const fakeProvider = new FakeWhatsAppProvider();

  it("parses inbound text messages from realistic Meta payload", () => {
    const payload = fakeProvider.createInboundTextWebhook({
      phoneNumberId: "10987654321",
      from: "+62 812 3456 7890",
      text: "Can I get an update on my order?",
      senderName: "Budi Santoso",
      messageId: "wamid.HBgL1234567890=="
    });

    const items = parseWhatsAppWebhook(payload);
    expect(items.length).toBe(1);

    const item = items[0]!;
    expect(item.type).toBe("inbound_message");
    if (item.type === "inbound_message") {
      expect(item.customerPhone).toBe("6281234567890");
      expect(item.customerName).toBe("Budi Santoso");
      expect(item.content).toBe("Can I get an update on my order?");
      expect(item.providerMessageId).toBe("wamid.HBgL1234567890==");
      expect(item.phoneNumberId).toBe("10987654321");
      expect(item.timestamp).toBeInstanceOf(Date);
    }
  });

  it("parses status receipts (delivered, read, failed) from Meta payload", () => {
    const payload = fakeProvider.createStatusWebhook({
      phoneNumberId: "10987654321",
      messageId: "wamid.outbound.999==",
      recipientId: "+62 812 3456 7890",
      status: "delivered"
    });

    const items = parseWhatsAppWebhook(payload);
    expect(items.length).toBe(1);

    const item = items[0]!;
    expect(item.type).toBe("status_update");
    if (item.type === "status_update") {
      expect(item.providerMessageId).toBe("wamid.outbound.999==");
      expect(item.status).toBe("delivered");
      expect(item.recipientPhone).toBe("6281234567890");
      expect(item.phoneNumberId).toBe("10987654321");
    }
  });

  it("gracefully returns empty array on malformed or empty payloads", () => {
    expect(parseWhatsAppWebhook("")).toEqual([]);
    expect(parseWhatsAppWebhook("not-json")).toEqual([]);
    expect(parseWhatsAppWebhook({})).toEqual([]);
    expect(parseWhatsAppWebhook(null)).toEqual([]);
  });
});

describe("Worker Message & Conversation Processing Pipeline (M2-06)", () => {
  const fakeProvider = new FakeWhatsAppProvider();
  const orgId = "org-test-001";
  const channelId = "chan-test-001";
  const phoneNumberId = "10987654321";

  function createMockPipelineDb() {
    const conversations = new Map<
      string,
      {
        id: string;
        organizationId: string;
        channelId: string;
        customerPhone: string;
        customerName: string | null;
        status: string;
        version: number;
      }
    >();

    const messages = new Map<
      string,
      {
        id: string;
        organizationId: string;
        conversationId: string;
        channelId: string;
        direction: string;
        content: string;
        providerMessageId: string | null;
        status: string;
        deliveredAt?: Date | null;
        readAt?: Date | null;
      }
    >();

    const webhookEvents = new Map<
      string,
      {
        id: string;
        raw_payload: string;
        status: string;
      }
    >();

    const outboxEvents: Array<{
      id: string;
      organization_id: string;
      aggregate_id: string;
      payload: { webhookEventId: string };
      published_at: Date | null;
    }> = [];

    const db = {
      async query(queryText: string, values: unknown[] = []) {
        await Promise.resolve();
        const sql = queryText.replace(/\s+/g, " ").trim();

        if (sql.includes("SELECT id FROM flowdesk.channels")) {
          return { rows: [{ id: channelId }], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
        }

        if (
          sql.includes(
            "FROM flowdesk.conversations WHERE organization_id = $1 AND channel_id = $2 AND customer_phone = $3"
          )
        ) {
          const targetPhone = values[2] as string;
          for (const c of conversations.values()) {
            if (c.customerPhone === targetPhone) {
              return { rows: [c], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
            }
          }
          return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
        }

        if (sql.includes("INSERT INTO flowdesk.conversations")) {
          const id = `conv-${conversations.size + 1}`;
          const c = {
            id,
            organizationId: values[0] as string,
            channelId: values[1] as string,
            customerPhone: values[2] as string,
            customerName: (values[3] as string | null) ?? null,
            status: "new",
            version: 1
          };
          conversations.set(id, c);
          return { rows: [c], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
        }

        if (
          sql.includes(
            "FROM flowdesk.messages WHERE organization_id = $1 AND provider_message_id = $2"
          )
        ) {
          const providerId = values[1] as string;
          for (const m of messages.values()) {
            if (m.providerMessageId === providerId) {
              return { rows: [m], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
            }
          }
          return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
        }

        if (sql.includes("INSERT INTO flowdesk.messages")) {
          const id = `msg-${messages.size + 1}`;
          const m = {
            id,
            organizationId: values[0] as string,
            conversationId: values[1] as string,
            channelId: values[2] as string,
            direction: values[3] as string,
            senderType: values[4] as string,
            providerMessageId: (values[6] as string | null) ?? null,
            content: values[7] as string,
            status: values[8] as string
          };
          messages.set(id, m);
          return { rows: [m], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
        }

        if (sql.includes("UPDATE flowdesk.conversations SET last_message_at")) {
          return { rows: [], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }

        if (sql.includes("FROM flowdesk.messages WHERE id = $1 AND organization_id = $2")) {
          const id = values[0] as string;
          const m = messages.get(id);
          return { rows: m ? [m] : [], rowCount: m ? 1 : 0, command: "SELECT", oid: 0, fields: [] };
        }

        if (sql.includes("UPDATE flowdesk.messages SET status = $1")) {
          const id = values[1] as string;
          const m = messages.get(id);
          if (m) {
            m.status = values[0] as string;
            return { rows: [m], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
          }
        }

        if (
          sql.includes("claim_outbox_events('webhook.received'") ||
          (sql.includes("FROM flowdesk.outbox_events") &&
            sql.includes("event_type = 'webhook.received'") &&
            sql.includes("published_at IS NULL"))
        ) {
          const unpublished = outboxEvents.filter((e) => e.published_at === null);
          return {
            rows: unpublished,
            rowCount: unpublished.length,
            command: "SELECT",
            oid: 0,
            fields: []
          };
        }

        if (sql.includes("SELECT raw_payload FROM flowdesk.webhook_events WHERE id = $1")) {
          const id = values[0] as string;
          const ev = webhookEvents.get(id);
          return {
            rows: ev ? [{ raw_payload: ev.raw_payload }] : [],
            rowCount: ev ? 1 : 0,
            command: "SELECT",
            oid: 0,
            fields: []
          };
        }

        if (sql.includes("UPDATE flowdesk.webhook_events")) {
          const id = values[0] as string;
          const ev = webhookEvents.get(id);
          if (ev) {
            if (sql.includes("'processing'")) ev.status = "processing";
            if (sql.includes("'processed'")) ev.status = "processed";
          }
          return { rows: [], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }

        if (sql.includes("UPDATE flowdesk.outbox_events SET published_at")) {
          const id = values[0] as string;
          const ev = outboxEvents.find((e) => e.id === id);
          if (ev) ev.published_at = new Date();
          return { rows: [], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }

        if (sql.includes("SELECT set_config")) {
          return {
            rows: [{ set_config: values[0] }],
            rowCount: 1,
            command: "SELECT",
            oid: 0,
            fields: []
          };
        }

        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }
    } as unknown as DbClient;

    return { db, conversations, messages, webhookEvents, outboxEvents };
  }

  it("processes inbound message, matching conversation and creating message idempotently", async () => {
    const { db, conversations, messages } = createMockPipelineDb();

    const payload = fakeProvider.createInboundTextWebhook({
      phoneNumberId,
      from: "+62 812 3456 7890",
      text: "Halo FlowDesk",
      senderName: "Budi",
      messageId: "wamid.inbound.1"
    });

    const result = await processWebhookPayload(db, {
      organizationId: orgId,
      rawPayload: payload
    });

    expect(result.processedInboundCount).toBe(1);
    expect(result.conversationIds.length).toBe(1);
    expect(conversations.size).toBe(1);
    expect(messages.size).toBe(1);

    const msg = Array.from(messages.values())[0]!;
    expect(msg.content).toBe("Halo FlowDesk");
    expect(msg.providerMessageId).toBe("wamid.inbound.1");

    // Processing the exact same payload a second time does not duplicate message
    const secondResult = await processWebhookPayload(db, {
      organizationId: orgId,
      rawPayload: payload
    });

    expect(secondResult.processedInboundCount).toBe(0);
    expect(messages.size).toBe(1); // exactly 1 message
  });

  it("reconciles outbound message delivery status updates", async () => {
    const { db, messages } = createMockPipelineDb();

    // Setup existing outbound message waiting for delivery receipt
    const outboundMsgId = "msg-outbound-1";
    messages.set(outboundMsgId, {
      id: outboundMsgId,
      organizationId: orgId,
      conversationId: "conv-1",
      channelId,
      direction: "outbound",
      content: "Thank you for contacting us",
      providerMessageId: "wamid.outbound.123",
      status: "sent"
    });

    const statusPayload = fakeProvider.createStatusWebhook({
      phoneNumberId,
      messageId: "wamid.outbound.123",
      recipientId: "+62 812 3456 7890",
      status: "delivered"
    });

    const result = await processWebhookPayload(db, {
      organizationId: orgId,
      rawPayload: statusPayload
    });

    expect(result.processedStatusCount).toBe(1);
    expect(messages.get(outboundMsgId)?.status).toBe("delivered");
  });

  it("consumes and publishes outbox webhook batches", async () => {
    const { db, webhookEvents, outboxEvents, messages } = createMockPipelineDb();

    const payload = fakeProvider.createInboundTextWebhook({
      phoneNumberId,
      from: "+62 812 3456 7890",
      text: "Batch message",
      messageId: "wamid.batch.1"
    });

    webhookEvents.set("we-batch-1", {
      id: "we-batch-1",
      raw_payload: JSON.stringify(payload),
      status: "received"
    });

    outboxEvents.push({
      id: "ob-batch-1",
      organization_id: orgId,
      aggregate_id: "we-batch-1",
      payload: { webhookEventId: "we-batch-1" },
      published_at: null
    });

    const processed = await processOutboxWebhookBatch(db, 10);
    expect(processed).toBe(1);
    expect(outboxEvents[0]?.published_at).not.toBeNull();
    expect(webhookEvents.get("we-batch-1")?.status).toBe("processed");
    expect(messages.size).toBe(1);
  });
});
