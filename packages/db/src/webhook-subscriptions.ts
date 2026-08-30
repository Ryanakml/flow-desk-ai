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
