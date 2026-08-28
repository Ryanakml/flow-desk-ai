import type { DbClient, ClaimedOutboxEvent } from "@flowdesk/db";
import {
  getChannelById,
  getMessageById,
  markOutboxEventPublished,
  recordOutboxEventFailure,
  updateMessageStatus
} from "@flowdesk/db";
import {
  type WhatsAppProvider,
  FakeWhatsAppProvider,
  WhatsAppProviderError
} from "@flowdesk/providers";
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

  // Set transaction-scoped tenant context
  await client.query("SELECT set_config('app.organization_id', $1, true)", [orgId]);

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
  }>(
    `SELECT id, organization_id, aggregate_type, aggregate_id, event_type,
            payload, correlation_id, causation_id, occurred_at, attempts
     FROM flowdesk.outbox_events
     WHERE event_type = 'message.outbound.created' AND published_at IS NULL
     ORDER BY occurred_at ASC
     LIMIT $1`,
    [batchSize]
  );

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

    await dispatchOutboundMessage(client, event, options);
    processedCount += 1;
  }

  return processedCount;
}
