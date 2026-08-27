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

export function resetMetrics(): void {
  httpRequestsTotal.clear();
  httpRequestDuration.clear();
  authDenialsTotal.clear();
  permissionDenialsTotal.clear();
  rateLimitExceededTotal.clear();
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

  return lines.join("\n") + "\n";
}
