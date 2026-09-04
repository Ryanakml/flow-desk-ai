export type WebhookVerificationStatus = "unverified" | "verified" | "failed";

export interface WebhookDeliveryClientRecord {
  id: string;
  organizationId: string;
  subscriptionId: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: "pending" | "delivered" | "failed" | "dead_letter";
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string;
  deliveredAt: string | null;
  responseStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string; title?: string };
      detail = body.detail ?? body.title ?? detail;
    } catch {
      // Keep the status-based fallback when the body is not JSON.
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export async function testWebhookApi(
  orgId: string,
  webhookId: string,
  fetcher: typeof fetch = fetch
): Promise<{ enqueued: boolean; eventId: string }> {
  const response = await fetcher(
    `/api/v1/organizations/${orgId}/developer/webhooks/${webhookId}/test`,
    { method: "POST" }
  );
  return readJson<{ enqueued: boolean; eventId: string }>(response);
}

export async function listWebhookDeliveriesApi(
  orgId: string,
  webhookId: string,
  fetcher: typeof fetch = fetch
): Promise<WebhookDeliveryClientRecord[]> {
  const response = await fetcher(
    `/api/v1/organizations/${orgId}/developer/webhooks/${webhookId}/deliveries`
  );
  return readJson<WebhookDeliveryClientRecord[]>(response);
}
