import { describe, expect, it } from "vitest";
import type { DbClient } from "./auth.js";
import { getWebhookEventById, recordWebhookEvent, type WebhookEventRecord } from "./webhooks.js";

function createMockWebhookDb(): {
  db: DbClient;
  events: Map<string, WebhookEventRecord>;
  outboxEvents: unknown[];
} {
  const events = new Map<string, WebhookEventRecord>();
  const outboxEvents: unknown[] = [];
  const channels = new Map<string, { organization_id: string; phone_number_id: string }>();

  // Register a mock active channel for phone number 10987654321
  channels.set("10987654321", {
    organization_id: "org-test-1111",
    phone_number_id: "10987654321"
  });

  const db = {
    async query(queryText: string, values: unknown[] = []) {
      await Promise.resolve();
      const sql = queryText.replace(/\s+/g, " ").trim();

      if (sql.includes("SELECT organization_id FROM flowdesk.channels")) {
        const phone = values[0] as string;
        const ch = channels.get(phone);
        if (ch) {
          return {
            rows: [{ organization_id: ch.organization_id }],
            rowCount: 1,
            command: "SELECT",
            oid: 0,
            fields: []
          };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      if (sql.includes("INSERT INTO flowdesk.webhook_events")) {
        const provider = values[0] as "whatsapp";
        const payloadHash = values[1] as string;
        const phoneNumberId = (values[2] as string | null) ?? null;
        const organizationId = (values[3] as string | null) ?? null;
        const rawPayload = values[4] as string;
        const correlationId = (values[5] as string | null) ?? "corr-uuid-1";

        // Check deduplication conflict
        const dedupeKey = `${provider}:${payloadHash}`;
        for (const ev of events.values()) {
          if (`${ev.provider}:${ev.payloadHash}` === dedupeKey) {
            // Conflict! DO NOTHING
            return { rows: [], rowCount: 0, command: "INSERT", oid: 0, fields: [] };
          }
        }

        const id = `we-${events.size + 1}`;
        const record: WebhookEventRecord = {
          id,
          provider,
          payloadHash,
          phoneNumberId,
          organizationId,
          rawPayload,
          status: "received",
          correlationId,
          processingError: null,
          receivedAt: new Date(),
          processedAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        events.set(id, record);
        return { rows: [record], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      if (sql.includes("INSERT INTO flowdesk.outbox_events")) {
        outboxEvents.push({
          organization_id: values[0],
          aggregate_id: values[1],
          event_type: "webhook.received",
          payload: JSON.parse(values[2] as string) as Record<string, unknown>,
          correlation_id: values[3]
        });
        return { rows: [], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
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

      if (
        sql.includes("SELECT") &&
        sql.includes("FROM flowdesk.webhook_events WHERE provider = $1 AND payload_hash = $2")
      ) {
        const provider = values[0] as string;
        const payloadHash = values[1] as string;
        for (const ev of events.values()) {
          if (ev.provider === provider && ev.payloadHash === payloadHash) {
            return { rows: [ev], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
          }
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      if (sql.includes("SELECT") && sql.includes("FROM flowdesk.webhook_events WHERE id = $1")) {
        const id = values[0] as string;
        const ev = events.get(id);
        return {
          rows: ev ? [ev] : [],
          rowCount: ev ? 1 : 0,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }

      return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
    }
  } as unknown as DbClient;

  return { db, events, outboxEvents };
}

describe("Webhook Events Repository & Deduplication (M2-04)", () => {
  it("persists a new inbound webhook and publishes an outbox event when channel exists", async () => {
    const { db, events, outboxEvents } = createMockWebhookDb();

    const result = await recordWebhookEvent(db, {
      provider: "whatsapp",
      payloadHash: "hash_abc_123",
      rawPayload: '{"messages":[{"text":{"body":"Hi"}}]}',
      phoneNumberId: "10987654321"
    });

    expect(result.deduplicated).toBe(false);
    expect(result.webhookEvent.id).toBe("we-1");
    expect(result.webhookEvent.organizationId).toBe("org-test-1111");
    expect(result.webhookEvent.status).toBe("received");
    expect(events.size).toBe(1);

    expect(outboxEvents.length).toBe(1);
    expect(outboxEvents[0]).toMatchObject({
      organization_id: "org-test-1111",
      aggregate_id: "we-1",
      event_type: "webhook.received"
    });
  });

  it("de-duplicates identical webhook payload on (provider, payload_hash) and returns deduplicated: true", async () => {
    const { db, events, outboxEvents } = createMockWebhookDb();

    // First arrival
    const first = await recordWebhookEvent(db, {
      provider: "whatsapp",
      payloadHash: "hash_duplicate_target",
      rawPayload: '{"messages":[{"text":{"body":"Same"}}]}',
      phoneNumberId: "10987654321"
    });
    expect(first.deduplicated).toBe(false);
    expect(events.size).toBe(1);
    expect(outboxEvents.length).toBe(1);

    // Identical second arrival (e.g. Meta retry)
    const second = await recordWebhookEvent(db, {
      provider: "whatsapp",
      payloadHash: "hash_duplicate_target",
      rawPayload: '{"messages":[{"text":{"body":"Same"}}]}',
      phoneNumberId: "10987654321"
    });

    expect(second.deduplicated).toBe(true);
    expect(second.webhookEvent.id).toBe(first.webhookEvent.id);
    expect(events.size).toBe(1); // exactly 1 database record persisted
    expect(outboxEvents.length).toBe(1); // no duplicate outbox event published
  });

  it("persists webhook without outbox event if phone_number_id does not map to a channel", async () => {
    const { db, events, outboxEvents } = createMockWebhookDb();

    const result = await recordWebhookEvent(db, {
      provider: "whatsapp",
      payloadHash: "hash_unmapped_channel",
      rawPayload: '{"messages":[]}',
      phoneNumberId: "unknown_phone_number_9999"
    });

    expect(result.deduplicated).toBe(false);
    expect(result.webhookEvent.organizationId).toBeNull();
    expect(events.size).toBe(1);
    expect(outboxEvents.length).toBe(0);
  });

  it("retrieves a stored webhook event by ID", async () => {
    const { db } = createMockWebhookDb();

    const recorded = await recordWebhookEvent(db, {
      provider: "whatsapp",
      payloadHash: "hash_fetch_test",
      rawPayload: '{"event":"test"}'
    });

    const fetched = await getWebhookEventById(db, recorded.webhookEvent.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(recorded.webhookEvent.id);
    expect(fetched?.payloadHash).toBe("hash_fetch_test");
  });
});
