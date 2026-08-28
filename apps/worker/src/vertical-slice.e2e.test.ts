import { describe, expect, it } from "vitest";
import type { DbClient, ClaimedOutboxEvent } from "@flowdesk/db";
import { FakeWhatsAppProvider, WhatsAppProviderError } from "@flowdesk/providers";
import {
  encryptSecret,
  decryptSecret,
  computeMetaSignature,
  verifyMetaSignature
} from "@flowdesk/security";
import { processWebhookPayload } from "./normalization.js";
import { dispatchOutboundMessage, type OutboundMessagePayload } from "./dispatch.js";

// Test fixture IDs
const orgId = "00000000-0000-7000-8000-000000000001";
const channelId = "00000000-0000-7000-8000-000000000002";
const agentUserId = "00000000-0000-7000-8000-000000000003";
const phoneNumberId = "10987654321";
const customerPhoneRaw = "+62 812-3456-7890";
const customerPhoneNormalized = "6281234567890";
const customerName = "Budi Santoso";

const encryptionKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const appSecret = "meta_app_secret_super_secure_key_123";

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

interface MockConversation {
  id: string;
  organization_id: string;
  channel_id: string;
  customer_phone: string;
  customer_name: string | null;
  status: string;
  priority: string;
  assigned_to_user_id: string | null;
  version: number;
  last_message_at: Date;
  created_at: Date;
  updated_at: Date;
}

interface MockMessage {
  id: string;
  organization_id: string;
  conversation_id: string;
  channel_id: string;
  direction: string;
  sender_type: string;
  sender_user_id: string | null;
  provider_message_id: string | null;
  content: string;
  status: string;
  error_detail: string | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  read_at: Date | null;
  created_at: Date;
  updated_at: Date;
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

function createE2EMockDb() {
  const channels = new Map<string, MockChannel>();
  const conversations = new Map<string, MockConversation>();
  const messages = new Map<string, MockMessage>();
  const outboxEvents = new Map<string, MockOutboxEvent>();

  const db = {
    async query(queryText: string, values: unknown[] = []) {
      await Promise.resolve();
      const sql = queryText.replace(/\s+/g, " ").trim();

      // Tenant RLS context
      if (sql.includes("set_config('app.organization_id'")) {
        return { rows: [], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
      }

      // Channels: Get by phone_number_id
      if (sql.includes("FROM flowdesk.channels") && sql.includes("phone_number_id = $2")) {
        const targetOrg = values[0] as string;
        const targetPhoneId = values[1] as string;
        for (const ch of channels.values()) {
          if (
            ch.organization_id === targetOrg &&
            ch.phone_number_id === targetPhoneId &&
            ch.status !== "DISCONNECTED"
          ) {
            return { rows: [ch], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
          }
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      // Channels: Get by id
      if (sql.includes("FROM flowdesk.channels WHERE id = $1")) {
        const targetId = values[0] as string;
        const ch = channels.get(targetId);
        if (ch) {
          return { rows: [ch], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      // Conversations: Find existing by phone & channel
      if (
        sql.includes("FROM flowdesk.conversations") &&
        sql.includes("organization_id = $1 AND channel_id = $2 AND customer_phone = $3")
      ) {
        const [targetOrg, targetChan, targetPhone] = values as [string, string, string];
        for (const conv of conversations.values()) {
          if (
            conv.organization_id === targetOrg &&
            conv.channel_id === targetChan &&
            conv.customer_phone === targetPhone
          ) {
            return { rows: [conv], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
          }
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      // Conversations: Insert new
      if (sql.includes("INSERT INTO flowdesk.conversations")) {
        const id = `conv-${conversations.size + 1}`;
        const conv: MockConversation = {
          id,
          organization_id: values[0] as string,
          channel_id: values[1] as string,
          customer_phone: values[2] as string,
          customer_name: (values[3] as string | null) ?? null,
          status: "open",
          priority: "medium",
          assigned_to_user_id: null,
          version: 1,
          last_message_at: new Date(),
          created_at: new Date(),
          updated_at: new Date()
        };
        conversations.set(id, conv);
        return { rows: [conv], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      // Messages: Select by provider_message_id (idempotency & status reconciliation)
      if (sql.includes("FROM flowdesk.messages") && sql.includes("provider_message_id = $2")) {
        const [targetOrg, targetProviderId] = values as [string, string];
        for (const m of messages.values()) {
          if (m.organization_id === targetOrg && m.provider_message_id === targetProviderId) {
            return { rows: [m], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
          }
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      // Messages: Select by id (handles both getMessageById and updateMessageStatus SELECT)
      if (
        sql.includes("FROM flowdesk.messages") &&
        (sql.includes("WHERE organization_id = $1 AND id = $2") ||
          sql.includes("WHERE id = $1 AND organization_id = $2"))
      ) {
        const isOrgFirst = sql.includes("WHERE organization_id = $1 AND id = $2");
        const targetOrg = (isOrgFirst ? values[0] : values[1]) as string;
        const msgId = (isOrgFirst ? values[1] : values[0]) as string;
        const m = messages.get(msgId);
        if (m && m.organization_id === targetOrg) {
          return {
            rows: [
              {
                id: m.id,
                organizationId: m.organization_id,
                conversationId: m.conversation_id,
                channelId: m.channel_id,
                direction: m.direction,
                senderType: m.sender_type,
                senderUserId: m.sender_user_id,
                providerMessageId: m.provider_message_id,
                content: m.content,
                status: m.status,
                errorDetail: m.error_detail,
                sentAt: m.sent_at,
                deliveredAt: m.delivered_at,
                readAt: m.read_at,
                createdAt: m.created_at,
                updatedAt: m.updated_at
              }
            ],
            rowCount: 1,
            command: "SELECT",
            oid: 0,
            fields: []
          };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      // Messages: Insert
      if (sql.includes("INSERT INTO flowdesk.messages")) {
        const id = `msg-${messages.size + 1}`;
        const msg: MockMessage = {
          id,
          organization_id: values[0] as string,
          conversation_id: values[1] as string,
          channel_id: values[2] as string,
          direction: values[3] as string,
          sender_type: values[4] as string,
          sender_user_id: (values[5] as string | null) ?? null,
          provider_message_id: (values[6] as string | null) ?? null,
          content: values[7] as string,
          status: (values[8] as string) ?? "queued",
          error_detail: null,
          sent_at: (values[10] as Date | null) ?? null,
          delivered_at: null,
          read_at: null,
          created_at: new Date(),
          updated_at: new Date()
        };
        messages.set(id, msg);
        const record = {
          ...msg,
          organizationId: msg.organization_id,
          conversationId: msg.conversation_id,
          channelId: msg.channel_id,
          senderType: msg.sender_type,
          senderUserId: msg.sender_user_id,
          providerMessageId: msg.provider_message_id,
          errorDetail: msg.error_detail,
          sentAt: msg.sent_at,
          deliveredAt: msg.delivered_at,
          readAt: msg.read_at,
          createdAt: msg.created_at,
          updatedAt: msg.updated_at
        };
        return { rows: [record], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      // Messages: Update status
      if (sql.includes("UPDATE flowdesk.messages SET status = $1")) {
        const targetStatus = values[0] as string;
        const msgId = values[1] as string;
        const providerMsgId = (values[2] as string | null) ?? null;
        const sentAt = (values[3] as Date | null) ?? null;
        const deliveredAt = (values[4] as Date | null) ?? null;
        const readAt = (values[5] as Date | null) ?? null;
        const errorDetail = (values[6] as string | null) ?? null;

        const m = messages.get(msgId);
        if (m) {
          m.status = targetStatus;
          if (providerMsgId) m.provider_message_id = providerMsgId;
          if (sentAt) m.sent_at = sentAt;
          if (deliveredAt) m.delivered_at = deliveredAt;
          if (readAt) m.read_at = readAt;
          if (errorDetail) m.error_detail = errorDetail;
          m.updated_at = new Date();
          return { rows: [m], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "UPDATE", oid: 0, fields: [] };
      }

      // Outbox: Claim unpublished
      if (sql.includes("FROM flowdesk.outbox_events") && sql.includes("published_at IS NULL")) {
        const limitVal = (values[0] as number) ?? 10;
        const unpublished = Array.from(outboxEvents.values())
          .filter((e) => e.published_at === null)
          .slice(0, limitVal);
        return {
          rows: unpublished,
          rowCount: unpublished.length,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }

      // Outbox: Mark published
      if (sql.includes("UPDATE flowdesk.outbox_events SET published_at = clock_timestamp()")) {
        const eventId = values[0] as string;
        const ev = outboxEvents.get(eventId);
        if (ev) {
          ev.published_at = new Date();
          return { rows: [ev], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "UPDATE", oid: 0, fields: [] };
      }

      // Outbox: Record failure
      if (sql.includes("UPDATE flowdesk.outbox_events SET attempts = attempts + 1")) {
        const eventId = values[0] as string;
        const lastErr = values[1] as string;
        const isTerminal = values[2] as boolean;
        const ev = outboxEvents.get(eventId);
        if (ev) {
          ev.attempts += 1;
          ev.last_error = lastErr;
          if (isTerminal) {
            ev.published_at = new Date();
          }
          return { rows: [ev], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "UPDATE", oid: 0, fields: [] };
      }

      return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
    }
  } as unknown as DbClient;

  return { db, channels, conversations, messages, outboxEvents };
}

describe("Milestone M2: WhatsApp Inbound-to-Agent Vertical Slice End-to-End (M2-10)", () => {
  it("proves complete vertical slice: channel setup -> webhook ingress -> normalization -> operator reply -> dispatch -> status reconciliation -> DLQ", async () => {
    const { db, channels, conversations, messages, outboxEvents } = createE2EMockDb();
    const fakeProvider = new FakeWhatsAppProvider();

    // =========================================================================
    // 1. Channel Setup & Credential Encryption (M2-01, M2-02)
    // =========================================================================
    const rawAccessToken = "EAAGmockAccessTokenForMetaCloudAPI123456";
    const encryptedCredentials = encryptSecret(rawAccessToken, encryptionKey);
    expect(encryptedCredentials).toHaveProperty("ciphertext");
    expect(encryptedCredentials).toHaveProperty("iv");
    expect(encryptedCredentials).toHaveProperty("tag");

    // Verify round-trip decryption
    const decryptedToken = decryptSecret(encryptedCredentials, encryptionKey);
    expect(decryptedToken).toBe(rawAccessToken);

    channels.set(channelId, {
      id: channelId,
      organization_id: orgId,
      type: "whatsapp",
      name: "Customer Support WhatsApp",
      phone_number_id: phoneNumberId,
      waba_id: "waba_account_9988",
      encrypted_credentials: JSON.stringify(encryptedCredentials),
      status: "active",
      status_reason: null,
      metadata: {},
      created_at: new Date(),
      updated_at: new Date()
    });

    // =========================================================================
    // 2. Ingress Route & HMAC-SHA256 Signature Verification (M2-03, M2-04)
    // =========================================================================
    const inboundWebhookPayload = fakeProvider.createInboundTextWebhook({
      phoneNumberId,
      from: customerPhoneRaw,
      text: "Hello! Where is my order #1042?",
      senderName: customerName,
      messageId: "wamid.inbound.cust.001=="
    });

    const rawBodyBuffer = Buffer.from(JSON.stringify(inboundWebhookPayload));
    const signatureHeader = computeMetaSignature(rawBodyBuffer, appSecret);

    // Verify signature passes constant-time verification
    const isValidSignature = verifyMetaSignature(rawBodyBuffer, appSecret, signatureHeader);
    expect(isValidSignature).toBe(true);

    // Verify forged signature is denied
    const isForgedDenied = verifyMetaSignature(
      rawBodyBuffer,
      appSecret,
      "sha256=badforge1234567890abcdef"
    );
    expect(isForgedDenied).toBe(false);

    // =========================================================================
    // 3. Worker Message Normalization & Thread Matching (M2-05, M2-06)
    // =========================================================================
    const normResult = await processWebhookPayload(db, {
      organizationId: orgId,
      rawPayload: inboundWebhookPayload
    });

    expect(normResult.processedInboundCount).toBe(1);
    expect(conversations.size).toBe(1);
    expect(messages.size).toBe(1);

    const createdConv = Array.from(conversations.values())[0]!;
    expect(createdConv.customer_phone).toBe(customerPhoneNormalized);
    expect(createdConv.customer_name).toBe(customerName);
    expect(createdConv.status).toBe("open");

    const createdInboundMsg = Array.from(messages.values())[0]!;
    expect(createdInboundMsg.direction).toBe("inbound");
    expect(createdInboundMsg.sender_type).toBe("customer");
    expect(createdInboundMsg.content).toBe("Hello! Where is my order #1042?");
    expect(createdInboundMsg.provider_message_id).toBe("wamid.inbound.cust.001==");
    expect(createdInboundMsg.status).toBe("delivered");

    // =========================================================================
    // 4. Idempotency: Redelivering Same Webhook Inbound Does Not Duplicate (M2-04, M2-06)
    // =========================================================================
    const redeliveredResult = await processWebhookPayload(db, {
      organizationId: orgId,
      rawPayload: inboundWebhookPayload
    });

    // Count is 0 because message with wamid.inbound.cust.001== already exists
    expect(redeliveredResult.processedInboundCount).toBe(0);
    expect(messages.size).toBe(1);

    // =========================================================================
    // 5. Operator Reply Intent & Transactional Outbox (M2-07, M2-08)
    // =========================================================================
    const outboundReplyText = "Hello Budi! Your order #1042 has shipped and will arrive tomorrow.";
    const outboundMsgId = "msg-outbound-reply-001";

    messages.set(outboundMsgId, {
      id: outboundMsgId,
      organization_id: orgId,
      conversation_id: createdConv.id,
      channel_id: channelId,
      direction: "outbound",
      sender_type: "agent",
      sender_user_id: agentUserId,
      provider_message_id: null,
      content: outboundReplyText,
      status: "queued",
      error_detail: null,
      sent_at: null,
      delivered_at: null,
      read_at: null,
      created_at: new Date(),
      updated_at: new Date()
    });

    const outboxEventId = "outbox-ev-reply-001";
    outboxEvents.set(outboxEventId, {
      id: outboxEventId,
      organization_id: orgId,
      aggregate_type: "message",
      aggregate_id: outboundMsgId,
      event_type: "message.outbound.created",
      payload: {
        messageId: outboundMsgId,
        conversationId: createdConv.id,
        channelId,
        customerPhone: customerPhoneNormalized,
        content: outboundReplyText,
        senderUserId: agentUserId
      },
      correlation_id: null,
      causation_id: null,
      occurred_at: new Date(),
      published_at: null,
      attempts: 0,
      last_error: null
    });

    // =========================================================================
    // 6. Outbound Dispatch Worker Execution (M2-08)
    // =========================================================================
    const eventToDispatch: ClaimedOutboxEvent<OutboundMessagePayload> = {
      id: outboxEventId,
      organizationId: orgId,
      aggregateType: "message",
      aggregateId: outboundMsgId,
      eventType: "message.outbound.created",
      payload: {
        messageId: outboundMsgId,
        conversationId: createdConv.id,
        channelId,
        customerPhone: customerPhoneNormalized,
        content: outboundReplyText,
        senderUserId: agentUserId
      },
      correlationId: null,
      causationId: null,
      occurredAt: new Date(),
      attempts: 0
    };

    const dispatchResult = await dispatchOutboundMessage(db, eventToDispatch, {
      provider: fakeProvider,
      encryptionKey
    });

    expect(dispatchResult.status).toBe("sent");
    const assignedWamid = dispatchResult.providerMessageId!;
    expect(assignedWamid).toMatch(/^wamid\./);

    // Verify outbound message was transitioned to 'sent'
    const sentMsg = messages.get(outboundMsgId)!;
    expect(sentMsg.status).toBe("sent");
    expect(sentMsg.provider_message_id).toBe(assignedWamid);
    expect(sentMsg.sent_at).toBeInstanceOf(Date);

    // Verify outbox event was marked published
    const publishedOutbox = outboxEvents.get(outboxEventId)!;
    expect(publishedOutbox.published_at).toBeInstanceOf(Date);

    // =========================================================================
    // 7. Status Reconciliation: Delivered & Read Receipts (M2-08)
    // =========================================================================
    // Inbound status webhook: delivered
    const deliveredWebhook = fakeProvider.createStatusWebhook({
      phoneNumberId,
      messageId: assignedWamid,
      recipientId: customerPhoneNormalized,
      status: "delivered"
    });

    const statusDeliveredResult = await processWebhookPayload(db, {
      organizationId: orgId,
      rawPayload: deliveredWebhook
    });
    expect(statusDeliveredResult.processedStatusCount).toBe(1);

    const deliveredMsg = messages.get(outboundMsgId)!;
    expect(deliveredMsg.status).toBe("delivered");
    expect(deliveredMsg.delivered_at).toBeInstanceOf(Date);

    // Inbound status webhook: read
    const readWebhook = fakeProvider.createStatusWebhook({
      phoneNumberId,
      messageId: assignedWamid,
      recipientId: customerPhoneNormalized,
      status: "read"
    });

    const statusReadResult = await processWebhookPayload(db, {
      organizationId: orgId,
      rawPayload: readWebhook
    });
    expect(statusReadResult.processedStatusCount).toBe(1);

    const readMsg = messages.get(outboundMsgId)!;
    expect(readMsg.status).toBe("read");
    expect(readMsg.read_at).toBeInstanceOf(Date);

    // =========================================================================
    // 8. Worker Crash Recovery & Dead-Letter Queue (DLQ) Mechanics (M2-08, M2-10)
    // =========================================================================
    // A. Replay Idempotency: Re-dispatching already sent/read message skips provider call
    const replayResult = await dispatchOutboundMessage(db, eventToDispatch, {
      provider: fakeProvider,
      encryptionKey
    });
    expect(replayResult.status).toBe("skipped");

    // B. Transient failure & retry increment
    fakeProvider.simulateFailure = () =>
      new WhatsAppProviderError({
        message: "WhatsApp Meta endpoint timeout (504)",
        classification: "TRANSIENT",
        statusCode: 504
      });

    const retryMsgId = "msg-retry-test-001";
    messages.set(retryMsgId, {
      id: retryMsgId,
      organization_id: orgId,
      conversation_id: createdConv.id,
      channel_id: channelId,
      direction: "outbound",
      sender_type: "agent",
      sender_user_id: agentUserId,
      provider_message_id: null,
      content: "Retry message test",
      status: "queued",
      error_detail: null,
      sent_at: null,
      delivered_at: null,
      read_at: null,
      created_at: new Date(),
      updated_at: new Date()
    });

    const transientEvent: ClaimedOutboxEvent<OutboundMessagePayload> = {
      id: "outbox-retry-001",
      organizationId: orgId,
      aggregateType: "message",
      aggregateId: retryMsgId,
      eventType: "message.outbound.created",
      payload: {
        messageId: retryMsgId,
        conversationId: createdConv.id,
        channelId,
        customerPhone: customerPhoneNormalized,
        content: "Retry message test"
      },
      correlationId: null,
      causationId: null,
      occurredAt: new Date(),
      attempts: 1
    };

    const retryDispatch = await dispatchOutboundMessage(db, transientEvent, {
      provider: fakeProvider,
      maxRetries: 5,
      encryptionKey
    });
    expect(retryDispatch.status).toBe("failed");
    expect(messages.get(retryMsgId)!.status).toBe("queued"); // Still queued for retry

    // C. Max Retries Exhaustion -> Dead-Letter Queue
    const exhaustedEvent: ClaimedOutboxEvent<OutboundMessagePayload> = {
      ...transientEvent,
      id: "outbox-exhausted-001",
      attempts: 4 // next attempt is 5, hitting maxRetries = 5
    };
    outboxEvents.set("outbox-exhausted-001", {
      id: "outbox-exhausted-001",
      organization_id: orgId,
      aggregate_type: "message",
      aggregate_id: retryMsgId,
      event_type: "message.outbound.created",
      payload: exhaustedEvent.payload,
      correlation_id: null,
      causation_id: null,
      occurred_at: new Date(),
      published_at: null,
      attempts: 4,
      last_error: null
    });

    const dlqDispatch = await dispatchOutboundMessage(db, exhaustedEvent, {
      provider: fakeProvider,
      maxRetries: 5,
      encryptionKey
    });
    expect(dlqDispatch.status).toBe("failed");
    expect(dlqDispatch.error).toContain("Max retries exceeded (5)");

    // Message transitioned to 'failed' and outbox event marked published (DLQ)
    const deadLetteredMsg = messages.get(retryMsgId)!;
    expect(deadLetteredMsg.status).toBe("failed");
    expect(deadLetteredMsg.error_detail).toContain("Max retries exceeded (5)");
    expect(outboxEvents.get("outbox-exhausted-001")!.published_at).toBeInstanceOf(Date);
  });
});
