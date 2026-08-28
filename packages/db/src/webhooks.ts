import type { DbClient } from "./auth.js";

export type WebhookEventStatus = "received" | "processing" | "processed" | "failed" | "ignored";

export interface WebhookEventRecord {
  id: string;
  provider: "whatsapp";
  payloadHash: string;
  phoneNumberId: string | null;
  organizationId: string | null;
  rawPayload: string;
  status: WebhookEventStatus;
  correlationId: string;
  processingError: string | null;
  receivedAt: Date;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecordWebhookEventInput {
  provider: "whatsapp";
  payloadHash: string;
  rawPayload: string;
  phoneNumberId?: string | null;
  correlationId?: string | null;
}

export interface RecordWebhookEventResult {
  webhookEvent: WebhookEventRecord;
  deduplicated: boolean;
}

/**
 * Durably records an inbound webhook event with SHA-256 payload de-duplication.
 * If the payload was already received, returns the existing record with deduplicated: true.
 * If the channel maps to a tenant organization, an outbox event is transactionally created.
 */
export async function recordWebhookEvent(
  client: DbClient,
  input: RecordWebhookEventInput
): Promise<RecordWebhookEventResult> {
  if (typeof (client as { connect?: unknown }).connect === "function") {
    const result = await client.query<WebhookEventRecord & { deduplicated: boolean }>(
      `SELECT
         id, provider, payload_hash AS "payloadHash", phone_number_id AS "phoneNumberId",
         organization_id AS "organizationId", raw_payload AS "rawPayload", status,
         correlation_id AS "correlationId", processing_error AS "processingError",
         received_at AS "receivedAt", processed_at AS "processedAt",
         created_at AS "createdAt", updated_at AS "updatedAt", deduplicated
       FROM flowdesk.record_whatsapp_webhook($1, $2, $3, $4)`,
      [
        input.payloadHash,
        input.rawPayload,
        input.phoneNumberId ?? null,
        input.correlationId ?? null
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Webhook persistence function returned no row");
    const { deduplicated, ...webhookEvent } = row;
    return { webhookEvent, deduplicated };
  }

  // Resolve channel tenant if phoneNumberId is present
  let organizationId: string | null = null;
  if (input.phoneNumberId) {
    const channelRes = await client.query<{ organization_id: string }>(
      `SELECT organization_id FROM flowdesk.channels
       WHERE phone_number_id = $1 AND status != 'DISCONNECTED' LIMIT 1`,
      [input.phoneNumberId]
    );
    if (channelRes.rows[0]) {
      organizationId = channelRes.rows[0].organization_id;
    }
  }

  // Insert with conflict avoidance on (provider, payload_hash)
  const insertRes = await client.query<WebhookEventRecord>(
    `INSERT INTO flowdesk.webhook_events
     (provider, payload_hash, phone_number_id, organization_id, raw_payload, correlation_id)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, gen_random_uuid()))
     ON CONFLICT (provider, payload_hash) DO NOTHING
     RETURNING
       id, provider, payload_hash AS "payloadHash", phone_number_id AS "phoneNumberId",
       organization_id AS "organizationId", raw_payload AS "rawPayload", status,
       correlation_id AS "correlationId", processing_error AS "processingError",
       received_at AS "receivedAt", processed_at AS "processedAt",
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      input.provider,
      input.payloadHash,
      input.phoneNumberId ?? null,
      organizationId,
      input.rawPayload,
      input.correlationId ?? null
    ]
  );

  if (insertRes.rows.length > 0) {
    const webhookEvent = insertRes.rows[0]!;

    // If an organization was resolved, publish a transactional outbox event
    if (organizationId) {
      await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
      await client.query(
        `INSERT INTO flowdesk.outbox_events
         (organization_id, aggregate_type, aggregate_id, event_type, schema_version, payload, correlation_id)
         VALUES ($1, 'webhook_event', $2, 'webhook.received', 1, $3::jsonb, $4)`,
        [
          organizationId,
          webhookEvent.id,
          JSON.stringify({
            webhookEventId: webhookEvent.id,
            provider: webhookEvent.provider,
            phoneNumberId: webhookEvent.phoneNumberId
          }),
          webhookEvent.correlationId
        ]
      );
    }

    return {
      webhookEvent,
      deduplicated: false
    };
  }

  // Duplicate payload detected - retrieve existing event
  const selectRes = await client.query<WebhookEventRecord>(
    `SELECT
       id, provider, payload_hash AS "payloadHash", phone_number_id AS "phoneNumberId",
       organization_id AS "organizationId", raw_payload AS "rawPayload", status,
       correlation_id AS "correlationId", processing_error AS "processingError",
       received_at AS "receivedAt", processed_at AS "processedAt",
       created_at AS "createdAt", updated_at AS "updatedAt"
     FROM flowdesk.webhook_events
     WHERE provider = $1 AND payload_hash = $2`,
    [input.provider, input.payloadHash]
  );

  if (!selectRes.rows[0]) {
    throw new Error("Concurrent webhook insertion anomaly: row not found");
  }

  return {
    webhookEvent: selectRes.rows[0],
    deduplicated: true
  };
}

/**
 * Retrieves a webhook event by ID.
 */
export async function getWebhookEventById(
  client: DbClient,
  id: string
): Promise<WebhookEventRecord | null> {
  const result = await client.query<WebhookEventRecord>(
    `SELECT
       id, provider, payload_hash AS "payloadHash", phone_number_id AS "phoneNumberId",
       organization_id AS "organizationId", raw_payload AS "rawPayload", status,
       correlation_id AS "correlationId", processing_error AS "processingError",
       received_at AS "receivedAt", processed_at AS "processedAt",
       created_at AS "createdAt", updated_at AS "updatedAt"
     FROM flowdesk.webhook_events
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}
