import type { DbClient, ClaimedOutboxEvent } from "@flowdesk/db";
import {
  createWebhookDelivery,
  updateWebhookDeliveryOutcome,
  markOutboxEventPublished,
  recordOutboxEventFailure,
  runInTenantTransaction
} from "@flowdesk/db";
import { computeWebhookSignature } from "@flowdesk/security";

export interface DeveloperWebhookPayload {
  subscriptionId: string;
  eventId: string;
  eventType: string;
  url: string;
  secret: string;
  payload: Record<string, unknown>;
}

export interface WebhookDispatchWorkerOptions {
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface WebhookDispatchResult {
  subscriptionId: string;
  eventId: string;
  status: "delivered" | "failed" | "dead_letter";
  statusCode?: number;
  error?: string;
}

/**
 * Dispatches a single developer webhook event to an external subscriber.
 */
export async function dispatchDeveloperWebhook(
  client: DbClient,
  event: ClaimedOutboxEvent<DeveloperWebhookPayload>,
  options: WebhookDispatchWorkerOptions = {}
): Promise<WebhookDispatchResult> {
  const { payload, organizationId } = event;
  const timeoutMs = options.timeoutMs ?? 10000;
  const fetchFn = options.fetchFn ?? fetch;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const rawBody = JSON.stringify(payload.payload);
  const signature = computeWebhookSignature(rawBody, payload.secret, nowSeconds);

  // 1. Durably record / upsert delivery record in pending state
  const delivery = await runInTenantTransaction(client, { organizationId }, (db) =>
    createWebhookDelivery(db, {
      organizationId,
      subscriptionId: payload.subscriptionId,
      eventId: payload.eventId,
      eventType: payload.eventType,
      payload: payload.payload,
      maxAttempts: 5
    })
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(payload.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-FlowDesk-Signature": signature,
        "X-FlowDesk-Event-Id": payload.eventId,
        "X-FlowDesk-Timestamp": String(nowSeconds),
        "User-Agent": "FlowDesk-Webhook-Worker/1.0"
      },
      body: rawBody,
      signal: controller.signal
    });
    clearTimeout(timer);

    if (res.status >= 200 && res.status < 300) {
      await runInTenantTransaction(client, { organizationId }, async (db) => {
        await updateWebhookDeliveryOutcome(db, delivery.id, {
          status: "delivered",
          responseStatusCode: res.status,
          lastError: null
        });
        await markOutboxEventPublished(db, event.id);
      });

      return {
        subscriptionId: payload.subscriptionId,
        eventId: payload.eventId,
        status: "delivered",
        statusCode: res.status
      };
    }

    // HTTP Non-2xx response from subscriber
    const errorText = `Subscriber returned HTTP ${res.status}`;
    const isDeadLetter = event.attempts + 1 >= 5;
    const nextStatus = isDeadLetter ? "dead_letter" : "failed";

    await runInTenantTransaction(client, { organizationId }, async (db) => {
      await updateWebhookDeliveryOutcome(db, delivery.id, {
        status: nextStatus,
        responseStatusCode: res.status,
        lastError: errorText,
        nextAttemptAt: new Date(Date.now() + Math.min(300, Math.pow(2, event.attempts + 1)) * 1000)
      });
      await recordOutboxEventFailure(db, event.id, errorText, isDeadLetter);
    });

    return {
      subscriptionId: payload.subscriptionId,
      eventId: payload.eventId,
      status: nextStatus,
      statusCode: res.status,
      error: errorText
    };
  } catch (err) {
    clearTimeout(timer);
    const errorDetail = err instanceof Error ? err.message : String(err);
    const isDeadLetter = event.attempts + 1 >= 5;
    const nextStatus = isDeadLetter ? "dead_letter" : "failed";

    await runInTenantTransaction(client, { organizationId }, async (db) => {
      await updateWebhookDeliveryOutcome(db, delivery.id, {
        status: nextStatus,
        responseStatusCode: null,
        lastError: errorDetail,
        nextAttemptAt: new Date(Date.now() + Math.min(300, Math.pow(2, event.attempts + 1)) * 1000)
      });
      await recordOutboxEventFailure(db, event.id, errorDetail, isDeadLetter);
    });

    return {
      subscriptionId: payload.subscriptionId,
      eventId: payload.eventId,
      status: nextStatus,
      error: errorDetail
    };
  }
}

/**
 * Worker outbox consumer: claims and dispatches a batch of unpublished developer webhook events.
 */
export async function processOutboxWebhookDispatchBatch(
  client: DbClient,
  options: WebhookDispatchWorkerOptions = {},
  batchSize = 10
): Promise<number> {
  const events = await client.query<{
    id: string;
    organization_id: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    payload: DeveloperWebhookPayload;
    correlation_id: string | null;
    causation_id: string | null;
    occurred_at: Date;
    attempts: number;
  }>(
    `SELECT * FROM flowdesk.claim_outbox_events('developer.webhook.dispatch'::text, $1::integer)`,
    [batchSize]
  );

  let processedCount = 0;
  for (const ev of events.rows) {
    const event: ClaimedOutboxEvent<DeveloperWebhookPayload> = {
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

    await dispatchDeveloperWebhook(client, event, options);
    processedCount++;
  }

  return processedCount;
}
