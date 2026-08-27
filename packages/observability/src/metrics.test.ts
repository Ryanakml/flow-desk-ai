import { describe, expect, it, beforeEach } from "vitest";
import {
  recordHttpRequest,
  recordAuthDenial,
  recordPermissionDenial,
  recordRateLimitExceeded,
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
});
