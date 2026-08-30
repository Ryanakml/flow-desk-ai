import {
  type DbClient,
  createMessage,
  findOrCreateConversation,
  recordOutboxEventFailure,
  runInTenantTransaction,
  updateMessageStatus,
  listRoutingRules,
  recordRoutingLog
} from "@flowdesk/db";
import { type MessageStatus, evaluateRoutingRules } from "@flowdesk/domain";
import { createLogger, recordWhatsAppWebhookProcessed } from "@flowdesk/observability";

// Module-level logger used only for silent-drop diagnostics within processWebhookPayload.
// Individual callers (index.ts) retain their own richer loggers.
const normalizationLogger = createLogger({
  service: "flowdesk-worker",
  environment: process.env["APP_ENV"] ?? "local",
  version: process.env["SERVICE_VERSION"] ?? "dev",
  level: process.env["LOG_LEVEL"] ?? "info"
});

export interface NormalizedInboundMessage {
  type: "inbound_message";
  providerMessageId: string;
  customerPhone: string;
  customerName: string | null;
  content: string;
  timestamp: Date;
  phoneNumberId: string;
  raw: Record<string, unknown>;
}

export interface NormalizedStatusUpdate {
  type: "status_update";
  providerMessageId: string;
  status: MessageStatus;
  recipientPhone: string;
  timestamp: Date;
  phoneNumberId: string;
  errorCode?: number | undefined;
  errorMessage?: string | undefined;
  raw: Record<string, unknown>;
}

export type NormalizedWebhookItem = NormalizedInboundMessage | NormalizedStatusUpdate;

export interface ProcessWebhookResult {
  processedInboundCount: number;
  processedStatusCount: number;
  conversationIds: string[];
}

/**
 * Normalizes phone numbers to pure digits (E.164 digits without leading '+')
 * for consistent database thread matching.
 */
export function normalizeCustomerPhone(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

/**
 * Safely parses and normalizes a Meta WhatsApp webhook payload into typed messages and status events.
 */
export function parseWhatsAppWebhook(rawPayload: unknown): NormalizedWebhookItem[] {
  const items: NormalizedWebhookItem[] = [];

  let payload: Record<string, unknown>;
  if (typeof rawPayload === "string") {
    try {
      payload = JSON.parse(rawPayload) as Record<string, unknown>;
    } catch {
      return items;
    }
  } else if (typeof rawPayload === "object" && rawPayload !== null) {
    payload = rawPayload as Record<string, unknown>;
  } else {
    return items;
  }

  const entries = payload["entry"];
  if (!Array.isArray(entries)) return items;

  for (const entryItem of entries) {
    if (typeof entryItem !== "object" || entryItem === null) continue;
    const entry = entryItem as Record<string, unknown>;
    const changes = entry["changes"];
    if (!Array.isArray(changes)) continue;

    for (const changeItem of changes) {
      if (typeof changeItem !== "object" || changeItem === null) continue;
      const change = changeItem as Record<string, unknown>;
      const value = change["value"];
      if (typeof value !== "object" || value === null) continue;
      const val = value as Record<string, unknown>;

      const metadata = val["metadata"] as Record<string, unknown> | undefined;
      const phoneIdRaw = metadata?.["phone_number_id"];
      const phoneNumberId =
        typeof phoneIdRaw === "string"
          ? phoneIdRaw
          : typeof phoneIdRaw === "number"
            ? String(phoneIdRaw)
            : "";

      // Contact profile map: wa_id -> profile name
      const contactMap = new Map<string, string>();
      const contacts = val["contacts"];
      if (Array.isArray(contacts)) {
        for (const contactItem of contacts) {
          if (typeof contactItem === "object" && contactItem !== null) {
            const c = contactItem as Record<string, unknown>;
            const waId = typeof c["wa_id"] === "string" ? c["wa_id"] : "";
            const profile = c["profile"] as Record<string, unknown> | undefined;
            const nameRaw = profile?.["name"];
            const name = typeof nameRaw === "string" ? nameRaw : "";
            if (waId && name) {
              contactMap.set(normalizeCustomerPhone(waId), name);
            }
          }
        }
      }

      // 1. Process inbound messages
      const messages = val["messages"];
      if (Array.isArray(messages)) {
        for (const msgItem of messages) {
          if (typeof msgItem !== "object" || msgItem === null) continue;
          const msg = msgItem as Record<string, unknown>;
          const fromRaw = typeof msg["from"] === "string" ? msg["from"] : "";
          const customerPhone = normalizeCustomerPhone(fromRaw);
          const providerMessageId = typeof msg["id"] === "string" ? msg["id"] : "";
          if (!customerPhone || !providerMessageId) continue;

          let content = "";
          const msgType = typeof msg["type"] === "string" ? msg["type"] : "text";

          if (msgType === "text" && typeof msg["text"] === "object" && msg["text"] !== null) {
            const textObj = msg["text"] as Record<string, unknown>;
            content = typeof textObj["body"] === "string" ? textObj["body"] : "";
          } else if (
            msgType === "interactive" &&
            typeof msg["interactive"] === "object" &&
            msg["interactive"] !== null
          ) {
            const interactive = msg["interactive"] as Record<string, unknown>;
            const btn = interactive["button_reply"] as Record<string, unknown> | undefined;
            const list = interactive["list_reply"] as Record<string, unknown> | undefined;
            const btnTitle = typeof btn?.["title"] === "string" ? btn["title"] : "";
            const listTitle = typeof list?.["title"] === "string" ? list["title"] : "";
            content = btnTitle || listTitle || "[Interactive Response]";
          } else {
            content = `[${msgType.toUpperCase()} message]`;
          }

          const timestampSeconds = Number(msg["timestamp"] ?? Math.floor(Date.now() / 1000));
          const timestamp = new Date(
            Number.isFinite(timestampSeconds) ? timestampSeconds * 1000 : Date.now()
          );

          items.push({
            type: "inbound_message",
            providerMessageId,
            customerPhone,
            customerName: contactMap.get(customerPhone) ?? null,
            content,
            timestamp,
            phoneNumberId,
            raw: msg
          });
        }
      }

      // 2. Process status updates (sent, delivered, read, failed)
      const statuses = val["statuses"];
      if (Array.isArray(statuses)) {
        for (const statusItem of statuses) {
          if (typeof statusItem !== "object" || statusItem === null) continue;
          const st = statusItem as Record<string, unknown>;
          const providerMessageId = typeof st["id"] === "string" ? st["id"] : "";
          const rawStatus = typeof st["status"] === "string" ? st["status"] : "";
          const recipientId = typeof st["recipient_id"] === "string" ? st["recipient_id"] : "";
          if (!providerMessageId || !rawStatus) continue;

          let status: MessageStatus;
          if (rawStatus === "sent") status = "sent";
          else if (rawStatus === "delivered") status = "delivered";
          else if (rawStatus === "read") status = "read";
          else if (rawStatus === "failed") status = "failed";
          else continue;

          const timestampSeconds = Number(st["timestamp"] ?? Math.floor(Date.now() / 1000));
          const timestamp = new Date(
            Number.isFinite(timestampSeconds) ? timestampSeconds * 1000 : Date.now()
          );

          let errorCode: number | undefined;
          let errorMessage: string | undefined;
          const errors = st["errors"];
          if (Array.isArray(errors) && errors.length > 0 && typeof errors[0] === "object") {
            const err = errors[0] as Record<string, unknown>;
            errorCode = typeof err["code"] === "number" ? err["code"] : undefined;
            errorMessage = typeof err["message"] === "string" ? err["message"] : undefined;
          }

          items.push({
            type: "status_update",
            providerMessageId,
            status,
            recipientPhone: normalizeCustomerPhone(recipientId),
            timestamp,
            phoneNumberId,
            errorCode,
            errorMessage,
            raw: st
          });
        }
      }
    }
  }

  return items;
}

/**
 * Executes the worker message normalization and conversation matching pipeline for a webhook payload.
 */
export async function processWebhookPayload(
  client: DbClient,
  params: {
    organizationId: string;
    rawPayload: unknown;
    correlationId?: string | undefined;
  }
): Promise<ProcessWebhookResult> {
  const items = parseWhatsAppWebhook(params.rawPayload);
  const result: ProcessWebhookResult = {
    processedInboundCount: 0,
    processedStatusCount: 0,
    conversationIds: []
  };

  // Cache resolved channel IDs: phoneNumberId -> channelId
  const channelCache = new Map<string, string>();

  async function resolveChannelId(phoneId: string): Promise<string | null> {
    if (channelCache.has(phoneId)) return channelCache.get(phoneId)!;
    const res = await client.query<{ id: string }>(
      `SELECT id FROM flowdesk.channels
       WHERE organization_id = $1 AND phone_number_id = $2 AND status != 'disconnected'
       LIMIT 1`,
      [params.organizationId, phoneId]
    );
    if (res.rows[0]) {
      channelCache.set(phoneId, res.rows[0].id);
      return res.rows[0].id;
    }
    return null;
  }

  for (const item of items) {
    if (item.type === "inbound_message") {
      const channelId = await resolveChannelId(item.phoneNumberId);
      if (!channelId) {
        // Structured warning: phoneNumberId received from Meta does not match any active
        // channel for this organization. This causes a silent message drop — log it so
        // operators can correlate the channel ID and fix the channel registration.
        normalizationLogger.warn(
          {
            organizationId: params.organizationId,
            phoneNumberId: item.phoneNumberId,
            correlationId: params.correlationId,
            providerMessageId: item.providerMessageId
          },
          "worker.webhook.channel_not_found: inbound message dropped — phoneNumberId does not match any active channel"
        );
        continue;
      }

      // 1. Idempotently match or create conversation thread
      const conversation = await findOrCreateConversation(client, {
        organizationId: params.organizationId,
        channelId,
        customerPhone: item.customerPhone,
        customerName: item.customerName
      });

      if (!result.conversationIds.includes(conversation.id)) {
        result.conversationIds.push(conversation.id);
      }

      // 2. Idempotency guard on providerMessageId (wamid)
      const existingMessage = await client.query<{ id: string }>(
        `SELECT id FROM flowdesk.messages
         WHERE organization_id = $1 AND provider_message_id = $2
         LIMIT 1`,
        [params.organizationId, item.providerMessageId]
      );

      if (existingMessage.rows.length === 0) {
        await createMessage(client, {
          organizationId: params.organizationId,
          conversationId: conversation.id,
          channelId,
          direction: "inbound",
          senderType: "customer",
          content: item.content,
          providerMessageId: item.providerMessageId,
          sentAt: item.timestamp,
          status: "delivered"
        });
        result.processedInboundCount += 1;

        // M5-01: Evaluate automated routing rules for new inbound conversation
        try {
          const rules = await listRoutingRules(client, params.organizationId);
          if (rules.length > 0) {
            const routingResult = evaluateRoutingRules(rules, {
              channelId,
              customerPhone: item.customerPhone
            });
            if (routingResult.matchedRule) {
              await client.query(
                `UPDATE flowdesk.conversations
                 SET queue_id = COALESCE($1, queue_id),
                     team_id = COALESCE($2, team_id),
                     assigned_to_user_id = COALESCE($3, assigned_to_user_id),
                     updated_at = clock_timestamp()
                 WHERE organization_id = $4 AND id = $5`,
                [
                  routingResult.targetQueueId,
                  routingResult.targetTeamId,
                  routingResult.targetUserId,
                  params.organizationId,
                  conversation.id
                ]
              );
            }
            await recordRoutingLog(client, {
              organizationId: params.organizationId,
              conversationId: conversation.id,
              matchedRuleId: routingResult.matchedRule?.id ?? null,
              targetQueueId: routingResult.targetQueueId,
              targetTeamId: routingResult.targetTeamId,
              targetUserId: routingResult.targetUserId,
              reason: routingResult.reason
            });
          }
        } catch {
          // Non-blocking routing log exception guard
        }
      }
    } else if (item.type === "status_update") {
      // Find outbound message by providerMessageId
      const targetMessage = await client.query<{ id: string }>(
        `SELECT id FROM flowdesk.messages
         WHERE organization_id = $1 AND provider_message_id = $2
         LIMIT 1`,
        [params.organizationId, item.providerMessageId]
      );

      if (targetMessage.rows[0]) {
        await updateMessageStatus(
          client,
          params.organizationId,
          targetMessage.rows[0].id,
          item.status,
          {
            ...(item.status === "delivered" ? { deliveredAt: item.timestamp } : {}),
            ...(item.status === "read" ? { readAt: item.timestamp } : {}),
            ...(item.errorMessage ? { errorDetail: item.errorMessage } : {})
          }
        );
        result.processedStatusCount += 1;
      }
    }
  }

  return result;
}

/**
 * Worker outbox consumer: claims and processes a batch of unpublished webhook.received events.
 */
export async function processOutboxWebhookBatch(client: DbClient, batchSize = 10): Promise<number> {
  const events = await client.query<{
    id: string;
    organization_id: string;
    aggregate_id: string;
    payload: { webhookEventId?: string };
    correlation_id: string | null;
    attempts: number;
  }>(
    `SELECT id, organization_id, aggregate_id, payload, correlation_id, attempts
     FROM flowdesk.claim_outbox_events('webhook.received'::text, $1::integer)`,
    [batchSize]
  );

  let processedCount = 0;

  for (const ev of events.rows) {
    const orgId = ev.organization_id;
    const webhookEventId = ev.payload?.webhookEventId ?? ev.aggregate_id;

    await runInTenantTransaction(client, { organizationId: orgId }, async (tenantDb) => {
      const webhookRes = await tenantDb.query<{ raw_payload: string }>(
        `SELECT raw_payload FROM flowdesk.webhook_events WHERE id = $1`,
        [webhookEventId]
      );

      if (webhookRes.rows[0]) {
        await tenantDb.query(
          `UPDATE flowdesk.webhook_events SET status = 'processing', updated_at = clock_timestamp() WHERE id = $1`,
          [webhookEventId]
        );

        try {
          await processWebhookPayload(tenantDb, {
            organizationId: orgId,
            rawPayload: webhookRes.rows[0].raw_payload,
            correlationId: ev.correlation_id ?? undefined
          });

          await tenantDb.query(
            `UPDATE flowdesk.webhook_events
             SET status = 'processed', processed_at = clock_timestamp(), updated_at = clock_timestamp()
             WHERE id = $1`,
            [webhookEventId]
          );
          recordWhatsAppWebhookProcessed("processed");
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : "Processing error";
          await tenantDb.query(
            `UPDATE flowdesk.webhook_events
             SET status = 'failed', processing_error = $2, updated_at = clock_timestamp()
             WHERE id = $1`,
            [webhookEventId, errorMsg]
          );
          recordWhatsAppWebhookProcessed("failed");
          await recordOutboxEventFailure(tenantDb, ev.id, errorMsg, (ev.attempts ?? 0) + 1 >= 5);
          return;
        }
      } else {
        await recordOutboxEventFailure(
          tenantDb,
          ev.id,
          `Webhook event '${webhookEventId}' not found.`,
          true
        );
        return;
      }

      await tenantDb.query(
        `UPDATE flowdesk.outbox_events
         SET published_at = clock_timestamp(), claimed_until = NULL, claim_token = NULL
         WHERE id = $1`,
        [ev.id]
      );
    });

    processedCount += 1;
  }

  return processedCount;
}
