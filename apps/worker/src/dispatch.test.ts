import { describe, expect, it } from "vitest";
import type { DbClient, ClaimedOutboxEvent } from "@flowdesk/db";
import { FakeWhatsAppProvider, WhatsAppProviderError } from "@flowdesk/providers";
import {
  dispatchOutboundMessage,
  processOutboxOutboundBatch,
  type OutboundMessagePayload
} from "./dispatch.js";
import { processWebhookPayload } from "./normalization.js";

const orgId = "00000000-0000-7000-8000-000000000001";
const channelId = "00000000-0000-7000-8000-000000000002";
const convId = "00000000-0000-7000-8000-000000000010";

interface MockDbMessage {
  id: string;
  organizationId: string;
  conversationId: string;
  channelId: string;
  direction: string;
  senderType: string;
  senderUserId: string | null;
  providerMessageId: string | null;
  content: string;
  status: string;
  errorDetail: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MockOutboxEvent {
  id: string;
  organization_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: OutboundMessagePayload;
  correlation_id: string | null;
  causation_id: string | null;
  occurred_at: Date;
  published_at: Date | null;
  attempts: number;
  last_error: string | null;
}

interface MockChannel {
  id: string;
  organization_id: string;
  type: string;
  name: string;
  phone_number_id: string;
  waba_id: string;
  encrypted_credentials: string;
  status: string;
  status_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

function toMockOutboxEvent(event: ClaimedOutboxEvent<OutboundMessagePayload>): MockOutboxEvent {
  return {
    id: event.id,
    organization_id: event.organizationId,
    aggregate_type: event.aggregateType,
    aggregate_id: event.aggregateId,
    event_type: event.eventType,
    payload: event.payload,
    correlation_id: event.correlationId,
    causation_id: event.causationId,
    occurred_at: event.occurredAt,
    attempts: event.attempts,
    published_at: null,
    last_error: null
  };
}

function createDispatchMockDb() {
  const channels = new Map<string, MockChannel>();
  const messages = new Map<string, MockDbMessage>();
  const outboxEvents = new Map<string, MockOutboxEvent>();

  // Default active channel
  channels.set(channelId, {
    id: channelId,
    organization_id: orgId,
    type: "whatsapp",
    name: "Customer Support",
    phone_number_id: "10987654321",
    waba_id: "waba-12345",
    encrypted_credentials: JSON.stringify({ accessToken: "mock-token-abc" }),
    status: "active",
    status_reason: null,
    metadata: {},
    created_at: new Date(),
    updated_at: new Date()
  });

  const db = {
    async query(queryText: string, values: unknown[] = []) {
      await Promise.resolve();
      const sql = queryText.replace(/\s+/g, " ").trim();

      // Tenant context
      if (sql.includes("set_config('app.organization_id'")) {
        return { rows: [], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
      }

      // Get channel by ID
      if (sql.includes("FROM flowdesk.channels WHERE id = $1")) {
        const id = values[0] as string;
        const targetOrg = values[1] as string | undefined;
        const ch = channels.get(id);
        if (ch && (!targetOrg || ch.organization_id === targetOrg)) {
          return { rows: [ch], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      // Get channel by phone number ID (for webhook normalization)
      if (sql.includes("FROM flowdesk.channels WHERE phone_number_id = $1")) {
        const phoneId = values[0] as string;
        for (const ch of channels.values()) {
          if (ch.phone_number_id === phoneId) {
            return { rows: [ch], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
          }
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      // Get message by ID
      if (
        sql.includes("FROM flowdesk.messages WHERE id = $1 AND organization_id = $2") ||
        sql.includes("FROM flowdesk.messages WHERE organization_id = $1 AND id = $2")
      ) {
        const [p1, p2] = values as [string, string];
        const msgId = sql.startsWith("SELECT") && sql.includes("WHERE id = $1") ? p1 : p2;
        const m = messages.get(msgId);
        if (m) {
          return { rows: [m], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      // Find message by provider_message_id (for status reconciliation)
      if (
        sql.includes(
          "FROM flowdesk.messages WHERE organization_id = $1 AND provider_message_id = $2"
        )
      ) {
        const [targetOrg, targetProviderId] = values as [string, string];
        for (const m of messages.values()) {
          if (m.organizationId === targetOrg && m.providerMessageId === targetProviderId) {
            return { rows: [m], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
          }
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      // Update message status
      if (sql.includes("UPDATE flowdesk.messages SET status = $1")) {
        const targetStatus = values[0] as string;
        const msgId = values[1] as string;
        const providerMessageId = (values[2] as string | null) ?? null;
        const sentAt = (values[3] as Date | null) ?? null;
        const deliveredAt = (values[4] as Date | null) ?? null;
        const readAt = (values[5] as Date | null) ?? null;
        const errorDetail = (values[6] as string | null) ?? null;

        const m = messages.get(msgId);
        if (m) {
          m.status = targetStatus;
          if (providerMessageId) m.providerMessageId = providerMessageId;
          if (sentAt) m.sentAt = sentAt;
          if (deliveredAt) m.deliveredAt = deliveredAt;
          if (readAt) m.readAt = readAt;
          if (errorDetail) m.errorDetail = errorDetail;
          m.updatedAt = new Date();

          return { rows: [m], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "UPDATE", oid: 0, fields: [] };
      }

      // Claim unpublished outbox events
      if (
        sql.includes("FROM flowdesk.outbox_events") &&
        sql.includes("event_type = 'message.outbound.created'") &&
        sql.includes("published_at IS NULL")
      ) {
        const limitVal = values[0] as number;
        const unpublished = Array.from(outboxEvents.values())
          .filter((e) => e.event_type === "message.outbound.created" && e.published_at === null)
          .slice(0, limitVal);

        return {
          rows: unpublished,
          rowCount: unpublished.length,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }

      // Mark outbox published
      if (sql.includes("UPDATE flowdesk.outbox_events SET published_at = clock_timestamp()")) {
        const id = values[0] as string;
        const ev = outboxEvents.get(id);
        if (ev) {
          ev.published_at = new Date();
          return { rows: [], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "UPDATE", oid: 0, fields: [] };
      }

      // Record outbox failure
      if (sql.includes("UPDATE flowdesk.outbox_events SET attempts = attempts + 1")) {
        const id = values[0] as string;
        const err = values[1] as string;
        const isTerminal = values[2] as boolean;

        const ev = outboxEvents.get(id);
        if (ev) {
          ev.attempts += 1;
          ev.last_error = err;
          if (isTerminal) {
            ev.published_at = new Date();
          }
          return { rows: [], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "UPDATE", oid: 0, fields: [] };
      }

      return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
    }
  } as unknown as DbClient;

  return { db, channels, messages, outboxEvents };
}

describe("Outbound Dispatch Worker (M2-08)", () => {
  it("claims outbox intent, calls provider, updates message to 'sent', and marks event published", async () => {
    const { db, messages, outboxEvents } = createDispatchMockDb();
    const provider = new FakeWhatsAppProvider();

    const msgId = "00000000-0000-7000-8000-000000000021";
    messages.set(msgId, {
      id: msgId,
      organizationId: orgId,
      conversationId: convId,
      channelId,
      direction: "outbound",
      senderType: "agent",
      senderUserId: "user-123",
      providerMessageId: null,
      content: "Hello from FlowDesk agent!",
      status: "queued",
      errorDetail: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const eventId = "00000000-0000-7000-8000-000000000031";
    outboxEvents.set(eventId, {
      id: eventId,
      organization_id: orgId,
      aggregate_type: "message",
      aggregate_id: msgId,
      event_type: "message.outbound.created",
      payload: {
        messageId: msgId,
        conversationId: convId,
        channelId,
        customerPhone: "6281234567890",
        content: "Hello from FlowDesk agent!"
      },
      correlation_id: null,
      causation_id: null,
      occurred_at: new Date(),
      published_at: null,
      attempts: 0,
      last_error: null
    });

    const processedCount = await processOutboxOutboundBatch(db, { provider }, 10);
    expect(processedCount).toBe(1);

    // Verify message status was updated to sent with providerMessageId
    const updatedMessage = messages.get(msgId)!;
    expect(updatedMessage.status).toBe("sent");
    expect(updatedMessage.providerMessageId).toBeTruthy();
    expect(updatedMessage.providerMessageId).toMatch(/^wamid\./);
    expect(updatedMessage.sentAt).toBeInstanceOf(Date);

    // Verify outbox event is published
    const updatedEvent = outboxEvents.get(eventId)!;
    expect(updatedEvent.published_at).toBeInstanceOf(Date);
  });

  it("skips calling provider if message is already sent (idempotent)", async () => {
    const { db, messages } = createDispatchMockDb();
    const provider = new FakeWhatsAppProvider();

    const msgId = "00000000-0000-7000-8000-000000000022";
    messages.set(msgId, {
      id: msgId,
      organizationId: orgId,
      conversationId: convId,
      channelId,
      direction: "outbound",
      senderType: "agent",
      senderUserId: "user-123",
      providerMessageId: "wamid.already.sent",
      content: "Already sent message",
      status: "sent",
      errorDetail: null,
      sentAt: new Date(),
      deliveredAt: null,
      readAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const event: ClaimedOutboxEvent<OutboundMessagePayload> = {
      id: "ev-dup",
      organizationId: orgId,
      aggregateType: "message",
      aggregateId: msgId,
      eventType: "message.outbound.created",
      payload: {
        messageId: msgId,
        conversationId: convId,
        channelId,
        customerPhone: "6281234567890",
        content: "Already sent message"
      },
      correlationId: null,
      causationId: null,
      occurredAt: new Date(),
      attempts: 0
    };

    const result = await dispatchOutboundMessage(db, event, { provider });
    expect(result.status).toBe("skipped");
    expect(result.providerMessageId).toBe("wamid.already.sent");

    // Provider should not have sent any message
    expect(provider.getSentMessages().length).toBe(0);
  });

  it("handles transient errors with retry: increments attempts and keeps published_at null", async () => {
    const { db, messages } = createDispatchMockDb();
    const provider = new FakeWhatsAppProvider();

    provider.simulateFailure = () =>
      new WhatsAppProviderError({
        message: "Meta rate limit exceeded",
        classification: "RATE_LIMIT_EXCEEDED",
        statusCode: 429
      });

    const msgId = "00000000-0000-7000-8000-000000000023";
    messages.set(msgId, {
      id: msgId,
      organizationId: orgId,
      conversationId: convId,
      channelId,
      direction: "outbound",
      senderType: "agent",
      senderUserId: null,
      providerMessageId: null,
      content: "Rate limit test",
      status: "queued",
      errorDetail: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const event: ClaimedOutboxEvent<OutboundMessagePayload> = {
      id: "ev-rate-limit",
      organizationId: orgId,
      aggregateType: "message",
      aggregateId: msgId,
      eventType: "message.outbound.created",
      payload: {
        messageId: msgId,
        conversationId: convId,
        channelId,
        customerPhone: "6281234567890",
        content: "Rate limit test"
      },
      correlationId: null,
      causationId: null,
      occurredAt: new Date(),
      attempts: 1
    };

    const result = await dispatchOutboundMessage(db, event, { provider, maxRetries: 5 });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("Meta rate limit exceeded");

    // Message should still be queued awaiting retry
    expect(messages.get(msgId)!.status).toBe("queued");
  });

  it("dead-letters unrecoverable transient errors when max retries are exceeded", async () => {
    const { db, messages, outboxEvents } = createDispatchMockDb();
    const provider = new FakeWhatsAppProvider();

    provider.simulateFailure = () =>
      new WhatsAppProviderError({
        message: "Network connection timeout",
        classification: "TRANSIENT",
        statusCode: 503
      });

    const msgId = "00000000-0000-7000-8000-000000000024";
    messages.set(msgId, {
      id: msgId,
      organizationId: orgId,
      conversationId: convId,
      channelId,
      direction: "outbound",
      senderType: "agent",
      senderUserId: null,
      providerMessageId: null,
      content: "Retry exhaustion test",
      status: "queued",
      errorDetail: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const eventId = "ev-exhaustion";
    const event: ClaimedOutboxEvent<OutboundMessagePayload> = {
      id: eventId,
      organizationId: orgId,
      aggregateType: "message",
      aggregateId: msgId,
      eventType: "message.outbound.created",
      payload: {
        messageId: msgId,
        conversationId: convId,
        channelId,
        customerPhone: "6281234567890",
        content: "Retry exhaustion test"
      },
      correlationId: null,
      causationId: null,
      occurredAt: new Date(),
      attempts: 4 // Next attempt is 5, matching maxRetries = 5
    };
    outboxEvents.set(eventId, toMockOutboxEvent(event));

    const result = await dispatchOutboundMessage(db, event, { provider, maxRetries: 5 });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Max retries exceeded (5)");

    // Message must transition to 'failed'
    const finalMsg = messages.get(msgId)!;
    expect(finalMsg.status).toBe("failed");
    expect(finalMsg.errorDetail).toContain("Max retries exceeded (5)");

    // Outbox event must be published to stop retries
    expect(outboxEvents.get(eventId)!.published_at).toBeInstanceOf(Date);
  });

  it("marks message failed immediately on terminal non-transient error (AUTH_FAILED)", async () => {
    const { db, messages, outboxEvents } = createDispatchMockDb();
    const provider = new FakeWhatsAppProvider();

    provider.simulateFailure = () =>
      new WhatsAppProviderError({
        message: "Invalid OAuth access token",
        classification: "AUTH_FAILED",
        statusCode: 401
      });

    const msgId = "00000000-0000-7000-8000-000000000025";
    messages.set(msgId, {
      id: msgId,
      organizationId: orgId,
      conversationId: convId,
      channelId,
      direction: "outbound",
      senderType: "agent",
      senderUserId: null,
      providerMessageId: null,
      content: "Auth failure test",
      status: "queued",
      errorDetail: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const eventId = "ev-auth-fail";
    const event: ClaimedOutboxEvent<OutboundMessagePayload> = {
      id: eventId,
      organizationId: orgId,
      aggregateType: "message",
      aggregateId: msgId,
      eventType: "message.outbound.created",
      payload: {
        messageId: msgId,
        conversationId: convId,
        channelId,
        customerPhone: "6281234567890",
        content: "Auth failure test"
      },
      correlationId: null,
      causationId: null,
      occurredAt: new Date(),
      attempts: 0
    };
    outboxEvents.set(eventId, toMockOutboxEvent(event));

    const result = await dispatchOutboundMessage(db, event, { provider });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("Invalid OAuth access token");

    // Message must transition to 'failed'
    expect(messages.get(msgId)!.status).toBe("failed");
    expect(messages.get(msgId)!.errorDetail).toBe("Invalid OAuth access token");

    // Event must be dead-lettered
    expect(outboxEvents.get(eventId)!.published_at).toBeInstanceOf(Date);
  });

  it("marks message failed if channel is disconnected or inactive", async () => {
    const { db, channels, messages, outboxEvents } = createDispatchMockDb();
    const provider = new FakeWhatsAppProvider();

    // Mark channel as disconnected
    channels.get(channelId)!.status = "disconnected";

    const msgId = "00000000-0000-7000-8000-000000000026";
    messages.set(msgId, {
      id: msgId,
      organizationId: orgId,
      conversationId: convId,
      channelId,
      direction: "outbound",
      senderType: "agent",
      senderUserId: null,
      providerMessageId: null,
      content: "Disconnected channel test",
      status: "queued",
      errorDetail: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const eventId = "ev-channel-disconnected";
    const event: ClaimedOutboxEvent<OutboundMessagePayload> = {
      id: eventId,
      organizationId: orgId,
      aggregateType: "message",
      aggregateId: msgId,
      eventType: "message.outbound.created",
      payload: {
        messageId: msgId,
        conversationId: convId,
        channelId,
        customerPhone: "6281234567890",
        content: "Disconnected channel test"
      },
      correlationId: null,
      causationId: null,
      occurredAt: new Date(),
      attempts: 0
    };
    outboxEvents.set(eventId, toMockOutboxEvent(event));

    const result = await dispatchOutboundMessage(db, event, { provider });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("is disconnected");

    expect(messages.get(msgId)!.status).toBe("failed");
    expect(outboxEvents.get(eventId)!.published_at).toBeInstanceOf(Date);
  });

  it("demonstrates end-to-end delivery and read reconciliation lifecycle", async () => {
    const { db, messages, outboxEvents } = createDispatchMockDb();
    const provider = new FakeWhatsAppProvider();

    const msgId = "00000000-0000-7000-8000-000000000027";
    messages.set(msgId, {
      id: msgId,
      organizationId: orgId,
      conversationId: convId,
      channelId,
      direction: "outbound",
      senderType: "agent",
      senderUserId: "user-123",
      providerMessageId: null,
      content: "Status lifecycle test message",
      status: "queued",
      errorDetail: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const eventId = "ev-lifecycle";
    outboxEvents.set(eventId, {
      id: eventId,
      organization_id: orgId,
      aggregate_type: "message",
      aggregate_id: msgId,
      event_type: "message.outbound.created",
      payload: {
        messageId: msgId,
        conversationId: convId,
        channelId,
        customerPhone: "6281234567890",
        content: "Status lifecycle test message"
      },
      correlation_id: null,
      causation_id: null,
      occurred_at: new Date(),
      published_at: null,
      attempts: 0,
      last_error: null
    });

    // 1. Dispatch outbound message: queued -> sent
    const dispatchResult = await dispatchOutboundMessage(
      db,
      {
        id: eventId,
        organizationId: orgId,
        aggregateType: "message",
        aggregateId: msgId,
        eventType: "message.outbound.created",
        payload: {
          messageId: msgId,
          conversationId: convId,
          channelId,
          customerPhone: "6281234567890",
          content: "Status lifecycle test message"
        },
        correlationId: null,
        causationId: null,
        occurredAt: new Date(),
        attempts: 0
      },
      { provider }
    );

    expect(dispatchResult.status).toBe("sent");
    const providerMessageId = dispatchResult.providerMessageId!;
    expect(providerMessageId).toBeTruthy();

    const sentMessage = messages.get(msgId)!;
    expect(sentMessage.status).toBe("sent");
    expect(sentMessage.providerMessageId).toBe(providerMessageId);

    // 2. Inbound webhook arrives with 'delivered' status receipt: sent -> delivered
    const deliveredPayload = provider.createStatusWebhook({
      phoneNumberId: "10987654321",
      messageId: providerMessageId,
      recipientId: "6281234567890",
      status: "delivered"
    });

    const deliveredResult = await processWebhookPayload(db, {
      organizationId: orgId,
      rawPayload: deliveredPayload
    });
    expect(deliveredResult.processedStatusCount).toBe(1);

    const deliveredMessage = messages.get(msgId)!;
    expect(deliveredMessage.status).toBe("delivered");
    expect(deliveredMessage.deliveredAt).toBeInstanceOf(Date);

    // 3. Inbound webhook arrives with 'read' status receipt: delivered -> read
    const readPayload = provider.createStatusWebhook({
      phoneNumberId: "10987654321",
      messageId: providerMessageId,
      recipientId: "6281234567890",
      status: "read"
    });

    const readResult = await processWebhookPayload(db, {
      organizationId: orgId,
      rawPayload: readPayload
    });
    expect(readResult.processedStatusCount).toBe(1);

    const readMessage = messages.get(msgId)!;
    expect(readMessage.status).toBe("read");
    expect(readMessage.readAt).toBeInstanceOf(Date);
  });
});
