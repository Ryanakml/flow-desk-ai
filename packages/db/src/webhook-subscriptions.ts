import type { DbClient } from "./auth.js";

export interface WebhookSubscriptionRecord {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  secret: string;
  events: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface RawWebhookSubscriptionRow {
  id: string;
  organization_id: string;
  name: string;
  url: string;
  secret: string;
  events: unknown;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapWebhookSubscriptionRow(row: RawWebhookSubscriptionRow): WebhookSubscriptionRecord {
  let parsedEvents: string[] = [];
  if (Array.isArray(row.events)) {
    parsedEvents = row.events as string[];
  } else if (typeof row.events === "string") {
    try {
      parsedEvents = JSON.parse(row.events) as string[];
    } catch {
      parsedEvents = [];
    }
  }

  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    url: row.url,
    secret: row.secret,
    events: parsedEvents,
    isActive: row.is_active,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

export async function listWebhookSubscriptions(
  db: DbClient,
  organizationId: string
): Promise<WebhookSubscriptionRecord[]> {
  const res = await db.query<RawWebhookSubscriptionRow>(
    `SELECT * FROM flowdesk.webhook_subscriptions WHERE organization_id = $1 ORDER BY created_at DESC`,
    [organizationId]
  );
  return res.rows.map(mapWebhookSubscriptionRow);
}

export interface CreateWebhookSubscriptionParams {
  organizationId: string;
  name: string;
  url: string;
  secret: string;
  events: string[];
}

export async function createWebhookSubscription(
  db: DbClient,
  params: CreateWebhookSubscriptionParams
): Promise<WebhookSubscriptionRecord> {
  const res = await db.query<RawWebhookSubscriptionRow>(
    `INSERT INTO flowdesk.webhook_subscriptions (
      organization_id, name, url, secret, events
    ) VALUES ($1, $2, $3, $4, $5::jsonb)
    RETURNING *`,
    [params.organizationId, params.name, params.url, params.secret, JSON.stringify(params.events)]
  );

  const row = res.rows[0];
  if (!row) {
    throw new Error("Failed to insert webhook subscription");
  }
  return mapWebhookSubscriptionRow(row);
}

export async function deleteWebhookSubscription(
  db: DbClient,
  id: string,
  organizationId: string
): Promise<boolean> {
  const res = await db.query(
    `DELETE FROM flowdesk.webhook_subscriptions WHERE id = $1 AND organization_id = $2`,
    [id, organizationId]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function getWebhookSubscriptionById(
  db: DbClient,
  id: string,
  organizationId: string
): Promise<WebhookSubscriptionRecord | null> {
  const res = await db.query<RawWebhookSubscriptionRow>(
    `SELECT * FROM flowdesk.webhook_subscriptions WHERE id = $1 AND organization_id = $2`,
    [id, organizationId]
  );
  const row = res.rows[0];
  return row ? mapWebhookSubscriptionRow(row) : null;
}

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed" | "dead_letter";

export interface WebhookDeliveryRecord {
  id: string;
  organizationId: string;
  subscriptionId: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  deliveredAt: Date | null;
  responseStatusCode: number | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawWebhookDeliveryRow {
  id: string;
  organization_id: string;
  subscription_id: string;
  event_id: string;
  event_type: string;
  payload: unknown;
  status: string;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: Date;
  delivered_at: Date | null;
  response_status_code: number | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapWebhookDeliveryRow(row: RawWebhookDeliveryRow): WebhookDeliveryRecord {
  let parsedPayload: Record<string, unknown> = {};
  if (typeof row.payload === "object" && row.payload !== null) {
    parsedPayload = row.payload as Record<string, unknown>;
  } else if (typeof row.payload === "string") {
    try {
      parsedPayload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      parsedPayload = {};
    }
  }

  return {
    id: row.id,
    organizationId: row.organization_id,
    subscriptionId: row.subscription_id,
    eventId: row.event_id,
    eventType: row.event_type,
    payload: parsedPayload,
    status: row.status as WebhookDeliveryStatus,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextAttemptAt: new Date(row.next_attempt_at),
    deliveredAt: row.delivered_at ? new Date(row.delivered_at) : null,
    responseStatusCode: row.response_status_code,
    lastError: row.last_error,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

export interface CreateWebhookDeliveryParams {
  organizationId: string;
  subscriptionId: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
}

export async function createWebhookDelivery(
  db: DbClient,
  params: CreateWebhookDeliveryParams
): Promise<WebhookDeliveryRecord> {
  const res = await db.query<RawWebhookDeliveryRow>(
    `INSERT INTO flowdesk.webhook_deliveries (
      organization_id, subscription_id, event_id, event_type, payload, max_attempts
    ) VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6, 5))
    ON CONFLICT (subscription_id, event_id) DO UPDATE
      SET updated_at = clock_timestamp()
    RETURNING *`,
    [
      params.organizationId,
      params.subscriptionId,
      params.eventId,
      params.eventType,
      JSON.stringify(params.payload),
      params.maxAttempts ?? 5
    ]
  );
  const row = res.rows[0];
  if (!row) throw new Error("Failed to insert webhook delivery");
  return mapWebhookDeliveryRow(row);
}

export async function listWebhookDeliveries(
  db: DbClient,
  organizationId: string,
  subscriptionId: string,
  limit = 50
): Promise<WebhookDeliveryRecord[]> {
  const res = await db.query<RawWebhookDeliveryRow>(
    `SELECT * FROM flowdesk.webhook_deliveries
     WHERE organization_id = $1 AND subscription_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [organizationId, subscriptionId, limit]
  );
  return res.rows.map(mapWebhookDeliveryRow);
}

export async function updateWebhookDeliveryOutcome(
  db: DbClient,
  deliveryId: string,
  outcome: {
    status: WebhookDeliveryStatus;
    responseStatusCode?: number | null;
    lastError?: string | null;
    nextAttemptAt?: Date | null;
  }
): Promise<void> {
  await db.query(
    `UPDATE flowdesk.webhook_deliveries
     SET status = $2,
         attempt_count = attempt_count + 1,
         response_status_code = COALESCE($3, response_status_code),
         last_error = $4,
         delivered_at = CASE WHEN $2 = 'delivered' THEN clock_timestamp() ELSE delivered_at END,
         next_attempt_at = COALESCE($5, next_attempt_at),
         updated_at = clock_timestamp()
     WHERE id = $1`,
    [
      deliveryId,
      outcome.status,
      outcome.responseStatusCode ?? null,
      outcome.lastError ?? null,
      outcome.nextAttemptAt ?? null
    ]
  );
}
