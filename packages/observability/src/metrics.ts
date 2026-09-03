interface CounterMetric {
  value: number;
  labels: Record<string, string>;
}

const DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface HistogramMetric {
  count: number;
  sum: number;
  buckets: Map<number, number>;
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
const realtimeAuthorizationDenialsTotal = new Map<string, CounterMetric>();
const realtimeReconnectGapsTotal = new Map<string, CounterMetric>();
const realtimeDroppedHintsTotal = new Map<string, CounterMetric>();
const mediaLifecycleTotal = new Map<string, CounterMetric>();
const aiDraftRunsTotal = new Map<string, CounterMetric>();
const aiDraftDuration = new Map<string, HistogramMetric>();
const aiDraftPromptTokensTotal = new Map<string, CounterMetric>();
const aiDraftCompletionTokensTotal = new Map<string, CounterMetric>();
const aiDraftCostMicrocentsTotal = new Map<string, CounterMetric>();
const autoSendTotal = new Map<string, CounterMetric>();
const autoSendFailuresTotal = new Map<string, CounterMetric>();
let emergencyKillswitchActive = 0;
let realtimeActiveConnections = 0;
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
    for (const le of DURATION_BUCKETS) {
      if (params.durationSeconds <= le) {
        existingDur.buckets.set(le, (existingDur.buckets.get(le) ?? 0) + 1);
      }
    }
  } else {
    const buckets = new Map<number, number>();
    for (const le of DURATION_BUCKETS) {
      buckets.set(le, params.durationSeconds <= le ? 1 : 0);
    }
    httpRequestDuration.set(durKey, {
      count: 1,
      sum: params.durationSeconds,
      buckets,
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

export function recordWhatsAppWebhookProcessed(result: string): void {
  const labels = { result };
  const key = serializeLabels(labels);
  const existing = whatsappWebhookProcessedTotal.get(key);
  if (existing) {
    existing.value += 1;
  } else {
    whatsappWebhookProcessedTotal.set(key, { value: 1, labels });
  }
}

export function recordWhatsAppOutboundDispatch(result: string): void {
  const labels = { result };
  const key = serializeLabels(labels);
  const existing = whatsappOutboundDispatchTotal.get(key);
  if (existing) {
    existing.value += 1;
  } else {
    whatsappOutboundDispatchTotal.set(key, { value: 1, labels });
  }
}

export function recordWorkerBatchFailure(pipeline: string): void {
  const labels = { pipeline };
  const key = serializeLabels(labels);
  const existing = workerBatchFailuresTotal.get(key);
  if (existing) {
    existing.value += 1;
  } else {
    workerBatchFailuresTotal.set(key, { value: 1, labels });
  }
}

export function recordOutboxSnapshot(snapshot: {
  pendingEvents: number;
  oldestEventAgeSeconds: number;
  deadLetterEvents: number;
}): void {
  outboxPendingEvents = Math.max(0, snapshot.pendingEvents);
  outboxOldestEventAgeSeconds = Math.max(0, snapshot.oldestEventAgeSeconds);
  outboxDeadLetterEvents = Math.max(0, snapshot.deadLetterEvents);
}

export function recordRealtimeConnection(delta: 1 | -1): void {
  realtimeActiveConnections = Math.max(0, realtimeActiveConnections + delta);
}

export function recordRealtimeAuthorizationDenial(roomType: string): void {
  const labels = { room_type: roomType };
  const key = serializeLabels(labels);
  const existing = realtimeAuthorizationDenialsTotal.get(key);
  if (existing) {
    existing.value += 1;
  } else {
    realtimeAuthorizationDenialsTotal.set(key, { value: 1, labels });
  }
}

export function recordRealtimeReconnectGap(): void {
  const labels = { result: "reconcile_required" };
  const key = serializeLabels(labels);
  const existing = realtimeReconnectGapsTotal.get(key);
  if (existing) {
    existing.value += 1;
  } else {
    realtimeReconnectGapsTotal.set(key, { value: 1, labels });
  }
}

export function recordRealtimeDroppedHint(reason: string): void {
  const labels = { reason };
  const key = serializeLabels(labels);
  const existing = realtimeDroppedHintsTotal.get(key);
  if (existing) {
    existing.value += 1;
  } else {
    realtimeDroppedHintsTotal.set(key, { value: 1, labels });
  }
}

export function recordMediaLifecycle(operation: string, outcome: string): void {
  const labels = { operation, outcome };
  const key = serializeLabels(labels);
  const existing = mediaLifecycleTotal.get(key);
  if (existing) {
    existing.value += 1;
  } else {
    mediaLifecycleTotal.set(key, { value: 1, labels });
  }
}

export function recordAiDraftRun(params: {
  provider: string;
  status: string;
  durationSeconds: number;
  promptTokens?: number;
  completionTokens?: number;
  costMicrocents?: number;
}): void {
  const runLabels = {
    provider: params.provider,
    status: params.status
  };
  const runKey = serializeLabels(runLabels);
  const existingRun = aiDraftRunsTotal.get(runKey);
  if (existingRun) {
    existingRun.value += 1;
  } else {
    aiDraftRunsTotal.set(runKey, { value: 1, labels: runLabels });
  }

  const durLabels = {
    provider: params.provider,
    status: params.status
  };
  const durKey = serializeLabels(durLabels);
  const existingDur = aiDraftDuration.get(durKey);
  if (existingDur) {
    existingDur.count += 1;
    existingDur.sum += params.durationSeconds;
  } else {
    aiDraftDuration.set(durKey, {
      count: 1,
      sum: params.durationSeconds,
      buckets: new Map(),
      labels: durLabels
    });
  }

  const tokenLabels = { provider: params.provider };
  const tokenKey = serializeLabels(tokenLabels);

  if (params.promptTokens != null) {
    const existingPrompt = aiDraftPromptTokensTotal.get(tokenKey);
    if (existingPrompt) {
      existingPrompt.value += params.promptTokens;
    } else {
      aiDraftPromptTokensTotal.set(tokenKey, { value: params.promptTokens, labels: tokenLabels });
    }
  }

  if (params.completionTokens != null) {
    const existingCompletion = aiDraftCompletionTokensTotal.get(tokenKey);
    if (existingCompletion) {
      existingCompletion.value += params.completionTokens;
    } else {
      aiDraftCompletionTokensTotal.set(tokenKey, {
        value: params.completionTokens,
        labels: tokenLabels
      });
    }
  }

  if (params.costMicrocents != null) {
    const existingCost = aiDraftCostMicrocentsTotal.get(tokenKey);
    if (existingCost) {
      existingCost.value += params.costMicrocents;
    } else {
      aiDraftCostMicrocentsTotal.set(tokenKey, {
        value: params.costMicrocents,
        labels: tokenLabels
      });
    }
  }
}

export function recordAutoSendOutcome(params: {
  status: "sent" | "denied" | "failed";
  reason?: string;
}): void {
  const labels = {
    status: params.status,
    reason: params.reason ?? "none"
  };
  const key = serializeLabels(labels);
  const existing = autoSendTotal.get(key);
  if (existing) {
    existing.value += 1;
  } else {
    autoSendTotal.set(key, { value: 1, labels });
  }

  if (params.status === "failed") {
    const failLabels = { reason: params.reason ?? "unknown" };
    const failKey = serializeLabels(failLabels);
    const existingFail = autoSendFailuresTotal.get(failKey);
    if (existingFail) {
      existingFail.value += 1;
    } else {
      autoSendFailuresTotal.set(failKey, { value: 1, labels: failLabels });
    }
  }
}

export function setEmergencyKillswitchActive(active: boolean): void {
  emergencyKillswitchActive = active ? 1 : 0;
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
  realtimeAuthorizationDenialsTotal.clear();
  realtimeReconnectGapsTotal.clear();
  realtimeDroppedHintsTotal.clear();
  mediaLifecycleTotal.clear();
  aiDraftRunsTotal.clear();
  aiDraftDuration.clear();
  aiDraftPromptTokensTotal.clear();
  aiDraftCompletionTokensTotal.clear();
  aiDraftCostMicrocentsTotal.clear();
  autoSendTotal.clear();
  autoSendFailuresTotal.clear();
  emergencyKillswitchActive = 0;
  realtimeActiveConnections = 0;
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
  lines.push(
    "# HELP http_request_duration_seconds HTTP request latency summary and histogram in seconds."
  );
  lines.push("# TYPE http_request_duration_seconds histogram");
  for (const item of httpRequestDuration.values()) {
    for (const le of DURATION_BUCKETS) {
      const count = item.buckets?.get(le) ?? 0;
      lines.push(
        `http_request_duration_seconds_bucket{${serializeLabels({ ...item.labels, le: String(le) })}} ${count}`
      );
    }
    lines.push(
      `http_request_duration_seconds_bucket{${serializeLabels({ ...item.labels, le: "+Inf" })}} ${item.count}`
    );
    lines.push(
      `http_request_duration_seconds_sum{${serializeLabels(item.labels)}} ${item.sum.toFixed(6)}`
    );
    lines.push(
      `http_request_duration_seconds_count{${serializeLabels(item.labels)}} ${item.count}`
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

  lines.push("# HELP realtime_active_connections Current authenticated realtime connections.");
  lines.push("# TYPE realtime_active_connections gauge");
  lines.push(`realtime_active_connections ${realtimeActiveConnections}`);
  lines.push("# HELP realtime_authorization_denials_total Realtime room authorization denials.");
  lines.push("# TYPE realtime_authorization_denials_total counter");
  for (const item of realtimeAuthorizationDenialsTotal.values()) {
    lines.push(
      `realtime_authorization_denials_total{${serializeLabels(item.labels)}} ${item.value}`
    );
  }
  lines.push("# HELP realtime_reconnect_gaps_total Reconnects requiring REST reconciliation.");
  lines.push("# TYPE realtime_reconnect_gaps_total counter");
  for (const item of realtimeReconnectGapsTotal.values()) {
    lines.push(`realtime_reconnect_gaps_total{${serializeLabels(item.labels)}} ${item.value}`);
  }
  lines.push("# HELP realtime_dropped_hints_total Hints dropped by backpressure protection.");
  lines.push("# TYPE realtime_dropped_hints_total counter");
  for (const item of realtimeDroppedHintsTotal.values()) {
    lines.push(`realtime_dropped_hints_total{${serializeLabels(item.labels)}} ${item.value}`);
  }

  lines.push("# HELP media_lifecycle_total Media scan and retention outcomes.");
  lines.push("# TYPE media_lifecycle_total counter");
  for (const item of mediaLifecycleTotal.values()) {
    lines.push(`media_lifecycle_total{${serializeLabels(item.labels)}} ${item.value}`);
  }

  lines.push("# HELP ai_draft_runs_total Durable AI draft outcomes by provider and status.");
  lines.push("# TYPE ai_draft_runs_total counter");
  for (const item of aiDraftRunsTotal.values()) {
    lines.push(`ai_draft_runs_total{${serializeLabels(item.labels)}} ${item.value}`);
  }
  lines.push("# HELP ai_draft_duration_seconds AI draft processing duration.");
  lines.push("# TYPE ai_draft_duration_seconds summary");
  for (const item of aiDraftDuration.values()) {
    lines.push(`ai_draft_duration_seconds_count{${serializeLabels(item.labels)}} ${item.count}`);
    lines.push(
      `ai_draft_duration_seconds_sum{${serializeLabels(item.labels)}} ${item.sum.toFixed(6)}`
    );
  }
  for (const [name, values] of [
    ["ai_draft_prompt_tokens_total", aiDraftPromptTokensTotal],
    ["ai_draft_completion_tokens_total", aiDraftCompletionTokensTotal],
    ["ai_draft_cost_microcents_total", aiDraftCostMicrocentsTotal]
  ] as const) {
    lines.push(`# TYPE ${name} counter`);
    for (const item of values.values()) {
      lines.push(`${name}{${serializeLabels(item.labels)}} ${item.value}`);
    }
  }

  // M5 #176: Auto-send and Killswitch metrics
  lines.push("# HELP auto_send_total Total number of auto-send evaluations by status and reason.");
  lines.push("# TYPE auto_send_total counter");
  for (const item of autoSendTotal.values()) {
    lines.push(`auto_send_total{${serializeLabels(item.labels)}} ${item.value}`);
  }

  lines.push("# HELP auto_send_failures_total Total number of auto-send execution failures.");
  lines.push("# TYPE auto_send_failures_total counter");
  for (const item of autoSendFailuresTotal.values()) {
    lines.push(`auto_send_failures_total{${serializeLabels(item.labels)}} ${item.value}`);
  }

  lines.push(
    "# HELP emergency_killswitch_active Whether emergency killswitch is currently active (1) or inactive (0)."
  );
  lines.push("# TYPE emergency_killswitch_active gauge");
  lines.push(`emergency_killswitch_active ${emergencyKillswitchActive}`);

  return lines.join("\n") + "\n";
}
