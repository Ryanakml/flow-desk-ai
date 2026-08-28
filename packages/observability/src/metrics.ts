interface CounterMetric {
  value: number;
  labels: Record<string, string>;
}

interface HistogramMetric {
  count: number;
  sum: number;
  labels: Record<string, string>;
}

const httpRequestsTotal = new Map<string, CounterMetric>();
const httpRequestDuration = new Map<string, HistogramMetric>();
const authDenialsTotal = new Map<string, CounterMetric>();
const permissionDenialsTotal = new Map<string, CounterMetric>();
const rateLimitExceededTotal = new Map<string, CounterMetric>();
const whatsappWebhookProcessedTotal = new Map<string, CounterMetric>();
const whatsappOutboundDispatchTotal = new Map<string, CounterMetric>();
const workerBatchFailuresTotal = new Map<string, CounterMetric>();
let outboxPendingEvents = 0;
let outboxOldestEventAgeSeconds = 0;
let outboxDeadLetterEvents = 0;

function serializeLabels(labels: Record<string, string>): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
}

export function recordHttpRequest(params: {
  method: string;
  route: string;
  statusCode: number;
  durationSeconds: number;
}): void {
  const reqLabels = {
    method: params.method.toUpperCase(),
    route: params.route,
    status_code: String(params.statusCode)
  };
  const reqKey = serializeLabels(reqLabels);
  const existingReq = httpRequestsTotal.get(reqKey);
  if (existingReq) {
    existingReq.value += 1;
  } else {
    httpRequestsTotal.set(reqKey, { value: 1, labels: reqLabels });
  }

  const durLabels = {
    method: params.method.toUpperCase(),
    route: params.route
  };
  const durKey = serializeLabels(durLabels);
  const existingDur = httpRequestDuration.get(durKey);
  if (existingDur) {
    existingDur.count += 1;
    existingDur.sum += params.durationSeconds;
  } else {
    httpRequestDuration.set(durKey, {
      count: 1,
      sum: params.durationSeconds,
      labels: durLabels
    });
  }
}

export function recordAuthDenial(reason: string): void {
  const labels = { reason };
  const key = serializeLabels(labels);
  const existing = authDenialsTotal.get(key);
  if (existing) {
    existing.value += 1;
  } else {
    authDenialsTotal.set(key, { value: 1, labels });
  }
}

export function recordPermissionDenial(permission: string, role: string): void {
  const labels = { permission, role };
  const key = serializeLabels(labels);
  const existing = permissionDenialsTotal.get(key);
  if (existing) {
    existing.value += 1;
  } else {
    permissionDenialsTotal.set(key, { value: 1, labels });
  }
}

export function recordRateLimitExceeded(route: string): void {
  const labels = { route };
  const key = serializeLabels(labels);
  const existing = rateLimitExceededTotal.get(key);
  if (existing) {
    existing.value += 1;
  } else {
    rateLimitExceededTotal.set(key, { value: 1, labels });
  }
}

function incrementCounter(
  target: Map<string, CounterMetric>,
  labels: Record<string, string>
): void {
  const key = serializeLabels(labels);
  const existing = target.get(key);
  if (existing) existing.value += 1;
  else target.set(key, { value: 1, labels });
}

export function recordWhatsAppWebhookProcessed(result: "processed" | "failed"): void {
  incrementCounter(whatsappWebhookProcessedTotal, { result });
}

export function recordWhatsAppOutboundDispatch(result: "sent" | "failed" | "skipped"): void {
  incrementCounter(whatsappOutboundDispatchTotal, { result });
}

export function recordWorkerBatchFailure(pipeline: "webhook" | "outbound"): void {
  incrementCounter(workerBatchFailuresTotal, { pipeline });
}

export function recordOutboxSnapshot(input: {
  pendingEvents: number;
  oldestEventAgeSeconds: number;
  deadLetterEvents: number;
}): void {
  outboxPendingEvents = Math.max(0, input.pendingEvents);
  outboxOldestEventAgeSeconds = Math.max(0, input.oldestEventAgeSeconds);
  outboxDeadLetterEvents = Math.max(0, input.deadLetterEvents);
}

export function resetMetrics(): void {
  httpRequestsTotal.clear();
  httpRequestDuration.clear();
  authDenialsTotal.clear();
  permissionDenialsTotal.clear();
  rateLimitExceededTotal.clear();
  whatsappWebhookProcessedTotal.clear();
  whatsappOutboundDispatchTotal.clear();
  workerBatchFailuresTotal.clear();
  outboxPendingEvents = 0;
  outboxOldestEventAgeSeconds = 0;
  outboxDeadLetterEvents = 0;
}

export function getPrometheusMetrics(): string {
  const lines: string[] = [];

  // http_requests_total
  lines.push("# HELP http_requests_total Total number of HTTP requests processed.");
  lines.push("# TYPE http_requests_total counter");
  for (const item of httpRequestsTotal.values()) {
    lines.push(`http_requests_total{${serializeLabels(item.labels)}} ${item.value}`);
  }

  // http_request_duration_seconds
  lines.push("# HELP http_request_duration_seconds HTTP request latency summary in seconds.");
  lines.push("# TYPE http_request_duration_seconds summary");
  for (const item of httpRequestDuration.values()) {
    lines.push(
      `http_request_duration_seconds_count{${serializeLabels(item.labels)}} ${item.count}`
    );
    lines.push(
      `http_request_duration_seconds_sum{${serializeLabels(item.labels)}} ${item.sum.toFixed(6)}`
    );
  }

  // auth_denials_total
  lines.push("# HELP auth_denials_total Total number of authentication denials.");
  lines.push("# TYPE auth_denials_total counter");
  for (const item of authDenialsTotal.values()) {
    lines.push(`auth_denials_total{${serializeLabels(item.labels)}} ${item.value}`);
  }

  // permission_denials_total
  lines.push("# HELP permission_denials_total Total number of RBAC authorization denials.");
  lines.push("# TYPE permission_denials_total counter");
  for (const item of permissionDenialsTotal.values()) {
    lines.push(`permission_denials_total{${serializeLabels(item.labels)}} ${item.value}`);
  }

  // rate_limit_exceeded_total
  lines.push("# HELP rate_limit_exceeded_total Total number of rate limit blocks.");
  lines.push("# TYPE rate_limit_exceeded_total counter");
  for (const item of rateLimitExceededTotal.values()) {
    lines.push(`rate_limit_exceeded_total{${serializeLabels(item.labels)}} ${item.value}`);
  }

  lines.push("# HELP whatsapp_webhook_processed_total WhatsApp webhook processing outcomes.");
  lines.push("# TYPE whatsapp_webhook_processed_total counter");
  for (const item of whatsappWebhookProcessedTotal.values()) {
    lines.push(`whatsapp_webhook_processed_total{${serializeLabels(item.labels)}} ${item.value}`);
  }

  lines.push("# HELP whatsapp_outbound_dispatch_total WhatsApp outbound dispatch outcomes.");
  lines.push("# TYPE whatsapp_outbound_dispatch_total counter");
  for (const item of whatsappOutboundDispatchTotal.values()) {
    lines.push(`whatsapp_outbound_dispatch_total{${serializeLabels(item.labels)}} ${item.value}`);
  }

  lines.push("# HELP worker_batch_failures_total Worker batch failures by pipeline.");
  lines.push("# TYPE worker_batch_failures_total counter");
  for (const item of workerBatchFailuresTotal.values()) {
    lines.push(`worker_batch_failures_total{${serializeLabels(item.labels)}} ${item.value}`);
  }

  lines.push("# HELP outbox_pending_events Current unpublished outbox event count.");
  lines.push("# TYPE outbox_pending_events gauge");
  lines.push(`outbox_pending_events ${outboxPendingEvents}`);
  lines.push("# HELP outbox_oldest_event_age_seconds Age of the oldest unpublished outbox event.");
  lines.push("# TYPE outbox_oldest_event_age_seconds gauge");
  lines.push(`outbox_oldest_event_age_seconds ${outboxOldestEventAgeSeconds}`);
  lines.push("# HELP outbox_dead_letter_events Current failed outbound intent count.");
  lines.push("# TYPE outbox_dead_letter_events gauge");
  lines.push(`outbox_dead_letter_events ${outboxDeadLetterEvents}`);

  return lines.join("\n") + "\n";
}
