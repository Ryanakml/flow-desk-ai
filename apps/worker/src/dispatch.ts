import type { DbClient, ClaimedOutboxEvent } from "@flowdesk/db";
import {
  getChannelById,
  getMessageById,
  markOutboxEventPublished,
  recordOutboxEventFailure,
  runInTenantTransaction,
  updateMessageStatus
} from "@flowdesk/db";
import {
  type WhatsAppProvider,
  FakeWhatsAppProvider,
  WhatsAppProviderError
} from "@flowdesk/providers";
import { recordWhatsAppOutboundDispatch } from "@flowdesk/observability";
import { decryptSecret, type EncryptedEnvelope } from "@flowdesk/security";

export interface OutboundMessagePayload {
  messageId: string;
  conversationId: string;
  channelId: string;
  customerPhone: string;
  content: string;
  senderUserId?: string | undefined;
}

export interface DispatchWorkerOptions {
  provider?: WhatsAppProvider | undefined;
  maxRetries?: number | undefined;
  encryptionKey?: string | undefined;
}

export interface DispatchResult {
  messageId: string;
  status: "sent" | "failed" | "skipped";
  providerMessageId?: string | undefined;
  error?: string | undefined;
}

interface PreparedDispatch {
  messageId: string;
  channelId: string;
  phoneNumberId: string;
  encryptedCredentials: string;
  content: string;
}

function resolveAccessToken(rawCredentials: string, encryptionKey?: string): string {
  try {
    const parsed = JSON.parse(rawCredentials) as Record<string, unknown>;
    if (parsed["ciphertext"] && parsed["iv"] && parsed["tag"]) {
      if (!encryptionKey) {
        throw new Error("Missing encryption key for credential decryption");
      }
      return decryptSecret(parsed as unknown as EncryptedEnvelope, encryptionKey);
    }
    if (typeof parsed["accessToken"] === "string") {
      return parsed["accessToken"];
    }
  } catch {
    // Non-JSON string, treat as raw token
  }
  return rawCredentials;
}

/**
 * Dispatches a single outbound message claimed from outbox.
 */
export async function dispatchOutboundMessage(
  client: DbClient,
  event: ClaimedOutboxEvent<OutboundMessagePayload>,
  options: DispatchWorkerOptions = {}
): Promise<DispatchResult> {
  const maxRetries = options.maxRetries ?? 5;
  const provider = options.provider ?? new FakeWhatsAppProvider();
  const orgId = event.organizationId;
  const messageId = event.payload.messageId;

  const message = await getMessageById(client, orgId, messageId);
  if (!message) {
    // Terminal failure: message record missing
    await recordOutboxEventFailure(client, event.id, `Message '${messageId}' not found.`, true);
    return { messageId, status: "failed", error: `Message '${messageId}' not found.` };
  }

  // Idempotency check: if message is already sent, delivered, or read, skip dispatch
  if (message.status === "sent" || message.status === "delivered" || message.status === "read") {
    await markOutboxEventPublished(client, event.id);
    return {
      messageId,
      status: "skipped",
      ...(message.providerMessageId ? { providerMessageId: message.providerMessageId } : {})
    };
  }

  // If already marked as failed, complete the outbox event
  if (message.status === "failed") {
    await markOutboxEventPublished(client, event.id);
    return {
      messageId,
      status: "failed",
      ...(message.errorDetail ? { error: message.errorDetail } : {})
    };
  }

  // Load channel record
  const channel = await getChannelById(client, message.channelId, orgId);
  if (!channel || channel.status === "disconnected" || channel.status === "degraded") {
    const errorMsg = !channel
      ? `Channel '${message.channelId}' not found.`
      : `Channel '${channel.id}' is ${channel.status}.`;
    await updateMessageStatus(client, orgId, message.id, "failed", {
      errorDetail: errorMsg
    });
    await recordOutboxEventFailure(client, event.id, errorMsg, true);
    return { messageId, status: "failed", error: errorMsg };
  }

  let accessToken: string;
  try {
    accessToken = resolveAccessToken(channel.encryptedCredentials, options.encryptionKey);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await updateMessageStatus(client, orgId, message.id, "failed", {
      errorDetail: `Credential error: ${errorMsg}`
    });
    await recordOutboxEventFailure(client, event.id, errorMsg, true);
    return { messageId, status: "failed", error: errorMsg };
  }

  try {
    const sendResult = await provider.sendTextMessage({
      phoneNumberId: channel.phoneNumberId,
      to: event.payload.customerPhone,
      text: message.content,
      accessToken
    });

    // Successfully sent: update message to 'sent' and record providerMessageId
    await updateMessageStatus(client, orgId, message.id, "sent", {
      providerMessageId: sendResult.messageId,
      sentAt: new Date()
    });

    // Mark outbox event published
    await markOutboxEventPublished(client, event.id);

    return {
      messageId,
      status: "sent",
      providerMessageId: sendResult.messageId
    };
  } catch (error: unknown) {
    const currentAttempt = event.attempts + 1;

    if (error instanceof WhatsAppProviderError) {
      if (error.isTransient) {
        if (currentAttempt < maxRetries) {
          // Retryable transient failure: record attempt, keep published_at NULL for next retry
          await recordOutboxEventFailure(client, event.id, error.message, false);
          return { messageId, status: "failed", error: error.message };
        }

        // Exceeded retries: Dead-letter queue
        const dlqError = `Max retries exceeded (${maxRetries}): ${error.message}`;
        await updateMessageStatus(client, orgId, message.id, "failed", {
          errorDetail: dlqError
        });
        await recordOutboxEventFailure(client, event.id, dlqError, true);
        return { messageId, status: "failed", error: dlqError };
      }

      // Non-transient failure: fail immediately
      await updateMessageStatus(client, orgId, message.id, "failed", {
        errorDetail: error.message
      });
      await recordOutboxEventFailure(client, event.id, error.message, true);
      return { messageId, status: "failed", error: error.message };
    }

    const genericError = error instanceof Error ? error.message : String(error);
    if (currentAttempt < maxRetries) {
      await recordOutboxEventFailure(client, event.id, genericError, false);
      return { messageId, status: "failed", error: genericError };
    }

    const dlqError = `Max retries exceeded (${maxRetries}): ${genericError}`;
    await updateMessageStatus(client, orgId, message.id, "failed", {
      errorDetail: dlqError
    });
    await recordOutboxEventFailure(client, event.id, dlqError, true);
    return { messageId, status: "failed", error: dlqError };
  }
}

function isPoolClient(client: DbClient): boolean {
  return typeof client.connect === "function";
}

async function dispatchOutboundMessageCrashSafe(
  client: DbClient,
  event: ClaimedOutboxEvent<OutboundMessagePayload>,
  options: DispatchWorkerOptions
): Promise<DispatchResult> {
  const prepared = await runInTenantTransaction(
    client,
    { organizationId: event.organizationId },
    async (tenantDb): Promise<PreparedDispatch | DispatchResult> => {
      const result = await tenantDb.query<{
        message_id: string;
        message_status: string;
        provider_message_id: string | null;
        content: string;
        channel_id: string;
        phone_number_id: string;
        encrypted_credentials: string;
        channel_status: string;
        intent_state: string;
      }>(
        `SELECT message.id AS message_id, message.status AS message_status,
                message.provider_message_id, message.content,
                channel.id AS channel_id, channel.phone_number_id,
                channel.encrypted_credentials, channel.status AS channel_status,
                intent.state AS intent_state
         FROM flowdesk.messages AS message
         JOIN flowdesk.channels AS channel ON channel.id = message.channel_id
         JOIN flowdesk.outbound_intents AS intent ON intent.message_id = message.id
         WHERE message.organization_id = $1 AND message.id = $2
         FOR UPDATE OF message, intent`,
        [event.organizationId, event.payload.messageId]
      );
      const row = result.rows[0];
      if (!row) {
        await recordOutboxEventFailure(
          tenantDb,
          event.id,
          `Message '${event.payload.messageId}' or outbound intent not found.`,
          true
        );
        return {
          messageId: event.payload.messageId,
          status: "failed",
          error: `Message '${event.payload.messageId}' or outbound intent not found.`
        };
      }

      if (["sent", "delivered", "read"].includes(row.message_status)) {
        await markOutboxEventPublished(tenantDb, event.id);
        return {
          messageId: row.message_id,
          status: "skipped",
          ...(row.provider_message_id ? { providerMessageId: row.provider_message_id } : {})
        };
      }
      if (row.message_status === "failed" || row.intent_state === "failed") {
        await markOutboxEventPublished(tenantDb, event.id);
        return { messageId: row.message_id, status: "failed" };
      }
      if (row.intent_state === "dispatching" || row.intent_state === "reconcile_required") {
        const error =
          "Provider delivery outcome is uncertain after worker interruption; manual reconciliation required.";
        await tenantDb.query(
          `UPDATE flowdesk.outbound_intents
           SET state = 'reconcile_required', last_error = $2, updated_at = clock_timestamp()
           WHERE organization_id = $1 AND message_id = $3`,
          [event.organizationId, error, row.message_id]
        );
        await markOutboxEventPublished(tenantDb, event.id);
        return { messageId: row.message_id, status: "failed", error };
      }
      if (row.channel_status !== "active") {
        const error = `Channel '${row.channel_id}' is ${row.channel_status}.`;
        await updateMessageStatus(tenantDb, event.organizationId, row.message_id, "failed", {
          errorDetail: error
        });
        await recordOutboxEventFailure(tenantDb, event.id, error, true);
        return { messageId: row.message_id, status: "failed", error };
      }

      await tenantDb.query(
        `UPDATE flowdesk.outbound_intents
         SET state = 'dispatching', attempt_count = attempt_count + 1,
             claimed_at = clock_timestamp(), last_error = NULL,
             updated_at = clock_timestamp()
         WHERE organization_id = $1 AND message_id = $2 AND state = 'queued'`,
        [event.organizationId, row.message_id]
      );
      return {
        messageId: row.message_id,
        channelId: row.channel_id,
        phoneNumberId: row.phone_number_id,
        encryptedCredentials: row.encrypted_credentials,
        content: row.content
      };
    }
  );

  if ("status" in prepared) return prepared;

  const provider = options.provider ?? new FakeWhatsAppProvider();
  let accessToken: string;
  try {
    accessToken = resolveAccessToken(prepared.encryptedCredentials, options.encryptionKey);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return runInTenantTransaction(client, { organizationId: event.organizationId }, async (db) => {
      await updateMessageStatus(db, event.organizationId, prepared.messageId, "failed", {
        errorDetail: `Credential error: ${detail}`
      });
      await recordOutboxEventFailure(db, event.id, detail, true);
      return { messageId: prepared.messageId, status: "failed", error: detail };
    });
  }

  try {
    const sent = await provider.sendTextMessage({
      phoneNumberId: prepared.phoneNumberId,
      to: event.payload.customerPhone,
      text: prepared.content,
      accessToken
    });
    return runInTenantTransaction(client, { organizationId: event.organizationId }, async (db) => {
      await updateMessageStatus(db, event.organizationId, prepared.messageId, "sent", {
        providerMessageId: sent.messageId,
        sentAt: new Date()
      });
      await markOutboxEventPublished(db, event.id);
      return { messageId: prepared.messageId, status: "sent", providerMessageId: sent.messageId };
    });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    const uncertain =
      error instanceof WhatsAppProviderError &&
      (detail.startsWith("Network error") || detail.startsWith("Malformed response"));
    const retryable =
      error instanceof WhatsAppProviderError &&
      error.isTransient &&
      !uncertain &&
      event.attempts + 1 < (options.maxRetries ?? 5);

    return runInTenantTransaction(client, { organizationId: event.organizationId }, async (db) => {
      if (uncertain) {
        await db.query(
          `UPDATE flowdesk.outbound_intents
           SET state = 'reconcile_required', last_error = $2, updated_at = clock_timestamp()
           WHERE organization_id = $1 AND message_id = $3`,
          [event.organizationId, detail, prepared.messageId]
        );
        await markOutboxEventPublished(db, event.id);
      } else if (retryable) {
        await db.query(
          `UPDATE flowdesk.outbound_intents
           SET state = 'queued', last_error = $2, updated_at = clock_timestamp()
           WHERE organization_id = $1 AND message_id = $3`,
          [event.organizationId, detail, prepared.messageId]
        );
        await recordOutboxEventFailure(db, event.id, detail, false);
      } else {
        await updateMessageStatus(db, event.organizationId, prepared.messageId, "failed", {
          errorDetail: detail
        });
        await recordOutboxEventFailure(db, event.id, detail, true);
      }
      return { messageId: prepared.messageId, status: "failed", error: detail };
    });
  }
}

/**
 * Worker outbox consumer: claims and dispatches a batch of unpublished outbound messages.
 */
export async function processOutboxOutboundBatch(
  client: DbClient,
  options: DispatchWorkerOptions = {},
  batchSize = 10
): Promise<number> {
  const events = await client.query<{
    id: string;
    organization_id: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    payload: OutboundMessagePayload;
    correlation_id: string | null;
    causation_id: string | null;
    occurred_at: Date;
    attempts: number;
  }>(`SELECT * FROM flowdesk.claim_outbox_events('message.outbound.created', $1)`, [batchSize]);

  let processedCount = 0;

  for (const ev of events.rows) {
    const event: ClaimedOutboxEvent<OutboundMessagePayload> = {
      id: ev.id,
      organizationId: ev.organization_id,
      aggregateType: ev.aggregate_type,
      aggregateId: ev.aggregate_id,
      eventType: ev.event_type,
      payload: ev.payload,
      correlationId: ev.correlation_id,
      causationId: ev.causation_id,
      occurredAt: ev.occurred_at,
      attempts: ev.attempts
    };

    const result = isPoolClient(client)
      ? await dispatchOutboundMessageCrashSafe(client, event, options)
      : await runInTenantTransaction(client, { organizationId: event.organizationId }, (tenantDb) =>
          dispatchOutboundMessage(tenantDb, event, options)
        );
    recordWhatsAppOutboundDispatch(result.status);
    processedCount += 1;
  }

  return processedCount;
}
