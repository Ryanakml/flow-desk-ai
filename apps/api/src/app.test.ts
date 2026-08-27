import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadAuthConfig } from "@flowdesk/config";
import type { DbClient } from "@flowdesk/db";
import { MockIdentityProvider } from "@flowdesk/providers";
import { createApiApp } from "./app.js";

const app = createApiApp({
  service: "api",
  version: "test",
  gitSha: "test-sha",
  environment: "production"
});

describe("API foundation & security (M1-08)", () => {
  it("serves readiness and a request id", async () => {
    const response = await request(app).get("/readyz").expect(200);
    expect(response.headers["x-request-id"]).toBeTypeOf("string");
    expect(response.body).toMatchObject({ status: "ready" });
  });

  it("uses the problem+json error envelope", async () => {
    const response = await request(app).get("/missing").expect(404);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.body).toMatchObject({ code: "RESOURCE_NOT_FOUND", status: 404 });
  });

  it("sets hardened security headers", async () => {
    const response = await request(app).get("/readyz").expect(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["permissions-policy"]).toContain("camera=()");
    expect(response.headers["strict-transport-security"]).toBe(
      "max-age=63072000; includeSubDomains; preload"
    );
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("serves Prometheus metrics on /metrics", async () => {
    // Generate a request to record metric
    await request(app).get("/readyz").expect(200);

    const response = await request(app).get("/metrics").expect(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toContain("http_requests_total");
    expect(response.text).toContain("http_request_duration_seconds");
  });

  it("enforces rate limits on auth routes", async () => {
    const mockDb = {
      query: async () => {
        await Promise.resolve();
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }
    } as unknown as DbClient;
    const authConfig = loadAuthConfig({
      AUTH_BASE_URL: "http://localhost:4000",
      AUTH_ISSUER: "https://auth.example.com",
      AUTH_CLIENT_ID: "client-id",
      AUTH_CLIENT_SECRET: "client-secret",
      SESSION_SECRET: "session-secret-that-is-at-least-32-chars-long"
    });
    const authApp = createApiApp({
      service: "api",
      version: "test",
      gitSha: "test-sha",
      environment: "local",
      auth: {
        db: mockDb,
        config: authConfig,
        identityProvider: new MockIdentityProvider()
      }
    });

    // Make 20 requests (quota limit)
    for (let i = 0; i < 20; i++) {
      const res = await request(authApp).get("/api/v1/auth/authorize");
      expect(res.headers["ratelimit-limit"]).toBe("20");
    }

    // 21st request should be rate limited (429)
    const blockedRes = await request(authApp).get("/api/v1/auth/authorize");
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers["retry-after"]).toBeDefined();
    expect(blockedRes.body).toMatchObject({
      code: "RATE_LIMIT_EXCEEDED",
      status: 429
    });
  });
});
