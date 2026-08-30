import request from "supertest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAuthConfig } from "@flowdesk/config";
import type { DbClient } from "@flowdesk/db";
import { MockIdentityProvider } from "@flowdesk/providers";
import { serializeSessionCookie } from "@flowdesk/security";
import { createApiApp } from "./app.js";
import { createRealtimeServer } from "./realtime.js";

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

  it("logs unexpected errors with request context while returning a safe response", async () => {
    const logError = vi.fn();
    const databaseError = Object.assign(
      new Error("database unavailable for alice@example.com?token=secret-value"),
      {
        code: "57P01"
      }
    );
    const failingDb = {
      query: async () => {
        await Promise.resolve();
        throw databaseError;
      }
    } as unknown as DbClient;
    const errorApp = createApiApp({
      service: "api",
      version: "test",
      gitSha: "test-sha",
      environment: "local",
      auth: {
        db: failingDb,
        config: loadAuthConfig({ AUTH_COOKIE_SECURE: "false", AUTH_MOCK_ENABLED: "true" }),
        identityProvider: new MockIdentityProvider()
      },
      logError
    });

    const response = await request(errorApp)
      .get("/api/v1/auth/session")
      .set("Cookie", serializeSessionCookie("diagnostic-session", false))
      .set("x-correlation-id", "correlation-test")
      .expect(500);

    const body = response.body as { code: string; status: number; detail: string };
    expect(body).toMatchObject({ code: "INTERNAL_ERROR", status: 500 });
    expect(body.detail).not.toContain("database unavailable");
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: response.headers["x-request-id"],
        correlationId: "correlation-test",
        method: "GET",
        path: "/api/v1/auth/session",
        errorName: "Error",
        errorMessage: "database unavailable for a***e@example.com?token=[REDACTED]",
        errorCode: "57P01"
      })
    );
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
      environment: "production",
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

describe("Realtime server initialization smoke test (Issue-B fix)", () => {
  let httpServer: ReturnType<typeof createServer>;
  let realtimeServerInstance: ReturnType<typeof createRealtimeServer>;
  let port: number;

  const minimalDb = {
    async query(queryText: string) {
      await Promise.resolve();
      const sql = queryText.replace(/\s+/g, " ").trim();
      if (sql.startsWith("BEGIN") || sql.startsWith("COMMIT") || sql.startsWith("ROLLBACK")) {
        return { rows: [], rowCount: 0, command: sql, oid: 0, fields: [] };
      }
      return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
    }
  } as unknown as DbClient;

  beforeEach(async () => {
    const expressApp = createApiApp({
      service: "api",
      version: "test",
      gitSha: "test-sha",
      environment: "local"
    });
    httpServer = createServer(expressApp);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => {
        port = (httpServer.address() as AddressInfo).port;
        resolve();
      });
    });
    // Attach realtime server exactly as api/src/index.ts now does
    realtimeServerInstance = createRealtimeServer(httpServer, {
      db: minimalDb,
      redisRequired: false
    });
  });

  afterEach(async () => {
    await realtimeServerInstance.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("GET /realtime/?EIO=4&transport=polling returns non-404 Socket.IO handshake after realtime server is attached", async () => {
    // Socket.IO serves its own polling endpoint once the server is attached to the httpServer.
    // Before Issue-B fix: Express 404 catch-all handler returned 404.
    // After fix: Socket.IO intercepts the request and returns its handshake (200 or 400).
    const res = await request(`http://127.0.0.1:${port}`)
      .get("/realtime/")
      .query({ EIO: "4", transport: "polling" });

    // Must NOT be Express 404 — any Socket.IO response (200 handshake or 400 bad request)
    // proves the realtime server is mounted.
    expect(res.status).not.toBe(404);
    // Also confirm it's not the Express problem+json 404 envelope
    expect(res.body?.code).not.toBe("RESOURCE_NOT_FOUND");
  });
});
