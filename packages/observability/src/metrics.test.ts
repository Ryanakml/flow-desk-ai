import { describe, expect, it, beforeEach } from "vitest";
import {
  recordHttpRequest,
  recordAuthDenial,
  recordPermissionDenial,
  recordRateLimitExceeded,
  recordWhatsAppWebhookProcessed,
  recordWhatsAppOutboundDispatch,
  recordWorkerBatchFailure,
  recordOutboxSnapshot,
  recordRealtimeConnection,
  recordRealtimeAuthorizationDenial,
  recordRealtimeReconnectGap,
  recordRealtimeDroppedHint,
  recordMediaLifecycle,
  getPrometheusMetrics,
  resetMetrics
} from "./metrics.js";

describe("Prometheus Metrics (M1-08)", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("records HTTP requests and latency", () => {
    recordHttpRequest({
      method: "POST",
      route: "/api/v1/organizations",
      statusCode: 201,
      durationSeconds: 0.045
    });

    const output = getPrometheusMetrics();
    expect(output).toContain(
      'http_requests_total{method="POST",route="/api/v1/organizations",status_code="201"} 1'
    );
    expect(output).toContain(
      'http_request_duration_seconds_count{method="POST",route="/api/v1/organizations"} 1'
    );
    expect(output).toContain(
      'http_request_duration_seconds_sum{method="POST",route="/api/v1/organizations"} 0.045000'
    );
  });

  it("records auth denials", () => {
    recordAuthDenial("SESSION_EXPIRED");
    const output = getPrometheusMetrics();
    expect(output).toContain('auth_denials_total{reason="SESSION_EXPIRED"} 1');
  });

  it("records permission denials", () => {
    recordPermissionDenial("membership:modify", "agent");
    const output = getPrometheusMetrics();
    expect(output).toContain(
      'permission_denials_total{permission="membership:modify",role="agent"} 1'
    );
  });

  it("records rate limit exceeded events", () => {
    recordRateLimitExceeded("/api/v1/auth/callback");
    const output = getPrometheusMetrics();
    expect(output).toContain('rate_limit_exceeded_total{route="/api/v1/auth/callback"} 1');
  });

  it("exports M2 messaging outcome counters and queue gauges", () => {
    recordWhatsAppWebhookProcessed("processed");
    recordWhatsAppWebhookProcessed("failed");
    recordWhatsAppOutboundDispatch("sent");
    recordWorkerBatchFailure("outbound");
    recordOutboxSnapshot({
      pendingEvents: 12,
      oldestEventAgeSeconds: 4.5,
      deadLetterEvents: 2
    });

    const output = getPrometheusMetrics();
    expect(output).toContain('whatsapp_webhook_processed_total{result="processed"} 1');
    expect(output).toContain('whatsapp_webhook_processed_total{result="failed"} 1');
    expect(output).toContain('whatsapp_outbound_dispatch_total{result="sent"} 1');
    expect(output).toContain('worker_batch_failures_total{pipeline="outbound"} 1');
    expect(output).toContain("outbox_pending_events 12");
    expect(output).toContain("outbox_oldest_event_age_seconds 4.5");
    expect(output).toContain("outbox_dead_letter_events 2");
  });

  it("exports realtime connection, denial, gap, and backpressure signals", () => {
    recordRealtimeConnection(1);
    recordRealtimeAuthorizationDenial("conversation");
    recordRealtimeReconnectGap();
    recordRealtimeDroppedHint("backpressure");
    const output = getPrometheusMetrics();
    expect(output).toContain("realtime_active_connections 1");
    expect(output).toContain('realtime_authorization_denials_total{room_type="conversation"} 1');
    expect(output).toContain('realtime_reconnect_gaps_total{result="reconcile_required"} 1');
    expect(output).toContain('realtime_dropped_hints_total{reason="backpressure"} 1');
    recordRealtimeConnection(-1);
  });

  it("exports media scan and retention outcomes without tenant or content labels", () => {
    recordMediaLifecycle("scan", "clean");
    recordMediaLifecycle("retention", "deleted");
    const output = getPrometheusMetrics();
    expect(output).toContain('media_lifecycle_total{operation="scan",outcome="clean"} 1');
    expect(output).toContain('media_lifecycle_total{operation="retention",outcome="deleted"} 1');
  });
});
