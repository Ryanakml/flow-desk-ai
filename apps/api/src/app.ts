import { randomUUID } from "node:crypto";
import { BuildInfoSchema, type Problem } from "@flowdesk/contracts";
import {
  runWithRequestContext,
  recordHttpRequest,
  recordRateLimitExceeded,
  getPrometheusMetrics,
  redactEmail
} from "@flowdesk/observability";
import {
  getSecurityHeaders,
  createSlidingWindowRateLimiter,
  type RateLimiter
} from "@flowdesk/security";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";

import type { AuthConfig } from "@flowdesk/config";
import type { DbClient } from "@flowdesk/db";
import type { IdentityProvider } from "@flowdesk/providers";
import { createAuthRouter } from "./auth.js";
import { createOrganizationsRouter, createInvitationsRouter } from "./organizations.js";
import { createConversationsRouter } from "./conversations.js";
import { createAttachmentsRouter } from "./attachments.js";
import { createBotRouter } from "./bot.js";
import type { ObjectStore } from "@flowdesk/providers";
export { createAuthRouter, createRequireAuthMiddleware, type AuthenticatedUser } from "./auth.js";
export {
  createOrganizationsRouter,
  createInvitationsRouter,
  createRequireOrgPermissionMiddleware
} from "./organizations.js";
export { createConversationsRouter } from "./conversations.js";
export { createAttachmentsRouter } from "./attachments.js";
export { createBotRouter } from "./bot.js";

export interface ApiAppAuthOptions {
  db: DbClient;
  config: AuthConfig;
  identityProvider?: IdentityProvider;
}

export interface ApiAppOptions {
  service: string;
  version: string;
  gitSha: string;
  environment: "local" | "preview" | "staging" | "production";
  auth?: ApiAppAuthOptions | undefined;
  storage?: ObjectStore | undefined;
  logRequest?: (event: {
    requestId: string;
    correlationId: string;
    method: string;
    path: string;
    statusCode: number;
    durationMs: number;
  }) => void;
  logError?: (event: {
    requestId: string;
    correlationId: string;
    method: string;
    path: string;
    errorName: string;
    errorMessage: string;
    errorCode?: string;
    errorConstraint?: string;
    stack?: string;
  }) => void;
}

function describeError(error: unknown) {
  if (!(error instanceof Error)) {
    return { errorName: "UnknownError", errorMessage: "Non-Error value thrown" };
  }

  const databaseError = error as Error & { code?: unknown; constraint?: unknown };
  const sanitize = (value: string) =>
    value
      .replace(
        /([?&](?:access_token|refresh_token|token|password|secret|api[_-]?key)=)[^&\s]+/gi,
        "$1[REDACTED]"
      )
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi, "$1[REDACTED]@")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (email) => redactEmail(email));
  return {
    errorName: error.name,
    errorMessage: sanitize(error.message),
    ...(typeof databaseError.code === "string" ? { errorCode: databaseError.code } : {}),
    ...(typeof databaseError.constraint === "string"
      ? { errorConstraint: databaseError.constraint }
      : {}),
    ...(error.stack ? { stack: sanitize(error.stack) } : {})
  };
}

export function createApiApp(options: ApiAppOptions) {
  const app = express();
  app.disable("x-powered-by");

  // Security Headers
  const securityHeaders = getSecurityHeaders({
    enableHsts: options.environment === "production" || options.environment === "staging"
  });
  app.use(((request, response, next) => {
    for (const [header, value] of Object.entries(securityHeaders)) {
      response.setHeader(header, value);
    }
    next();
  }) satisfies RequestHandler);

  app.use(express.json({ limit: "1mb" }));

  // Request context, logging, and metrics
  app.use(((request, response, next) => {
    const startedAt = performance.now();
    const requestId = request.header("x-request-id") ?? randomUUID();
    const correlationId = request.header("x-correlation-id") ?? requestId;
    response.setHeader("x-request-id", requestId);
    response.once("finish", () => {
      const durationSeconds = (performance.now() - startedAt) / 1000;
      recordHttpRequest({
        method: request.method,
        route: request.baseUrl + request.path,
        statusCode: response.statusCode,
        durationSeconds
      });
      options.logRequest?.({
        requestId,
        correlationId,
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Math.round(durationSeconds * 100000) / 100
      });
    });
    runWithRequestContext({ requestId, correlationId }, next);
  }) satisfies RequestHandler);

  // Rate Limiting setup
  const authRateLimiter = createSlidingWindowRateLimiter({
    windowMs: 60_000,
    max: options.environment === "local" ? 1000 : 20
  });
  const getClientIp = (req: express.Request) =>
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "127.0.0.1";

  function createRateLimitMiddleware(
    limiter: RateLimiter,
    keyResolver: (request: express.Request) => string
  ): RequestHandler {
    return ((request, response, next) => {
      const key = keyResolver(request);
      const result = limiter.consume(key);
      response.setHeader("RateLimit-Limit", String(result.limit));
      response.setHeader("RateLimit-Remaining", String(result.remaining));
      response.setHeader("RateLimit-Reset", String(result.resetSeconds));

      if (!result.allowed) {
        response.setHeader("Retry-After", String(result.resetSeconds));
        recordRateLimitExceeded(request.baseUrl + request.path);
        const problem: Problem = {
          type: "https://flowdesk.dev/problems/rate-limit-exceeded",
          title: "Too Many Requests",
          status: 429,
          code: "RATE_LIMIT_EXCEEDED",
          detail: `Rate limit exceeded. Try again in ${result.resetSeconds} seconds.`,
          requestId: response.getHeader("x-request-id")?.toString() ?? "unknown"
        };
        response.status(429).type("application/problem+json").json(problem);
        return;
      }
      next();
    }) satisfies RequestHandler;
  }

  app.get("/livez", (_request, response) => response.status(200).json({ status: "ok" }));
  app.get("/readyz", (_request, response) =>
    response.status(200).json({ status: "ready", checks: { configuration: "ok" } })
  );
  app.get("/metrics", (_request, response) => {
    response.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    response.send(getPrometheusMetrics());
  });
  app.get("/api/v1/system/build", (_request, response) => {
    response.json(BuildInfoSchema.parse(options));
  });

  if (options.auth) {
    app.use(
      "/api/v1/auth",
      createRateLimitMiddleware(authRateLimiter, (req) => `auth:${getClientIp(req)}`),
      createAuthRouter({
        db: options.auth.db,
        config: options.auth.config,
        identityProvider: options.auth.identityProvider
      })
    );
    app.use(
      "/api/v1/organizations",
      createOrganizationsRouter({
        db: options.auth.db
      })
    );
    app.use(
      "/api/v1/invitations",
      createInvitationsRouter({
        db: options.auth.db
      })
    );
    app.use(
      "/api/v1/organizations/:orgId/conversations",
      createConversationsRouter({
        db: options.auth.db
      })
    );
    app.use(
      "/api/v1/organizations/:orgId/attachments",
      createAttachmentsRouter({
        db: options.auth.db,
        storage: options.storage
      })
    );
    app.use(
      "/api/v1/organizations/:orgId/bot",
      createBotRouter({
        db: options.auth.db
      })
    );
  }

  app.use(((request, response) => {
    const problem: Problem = {
      type: "https://flowdesk.dev/problems/not-found",
      title: "Resource not found",
      status: 404,
      code: "RESOURCE_NOT_FOUND",
      detail: `No route matches ${request.method} ${request.path}`,
      requestId: response.getHeader("x-request-id")?.toString() ?? "unknown"
    };
    response.status(404).type("application/problem+json").json(problem);
  }) satisfies RequestHandler);

  app.use(((error: unknown, request, response, next) => {
    const requestId = response.getHeader("x-request-id")?.toString() ?? "unknown";
    const correlationId = request.header("x-correlation-id") ?? requestId;
    options.logError?.({
      requestId,
      correlationId,
      method: request.method,
      path: request.path,
      ...describeError(error)
    });
    const problem: Problem = {
      type: "https://flowdesk.dev/problems/internal-error",
      title: "Internal server error",
      status: 500,
      code: "INTERNAL_ERROR",
      detail: "The request could not be completed.",
      requestId
    };
    void next;
    response.status(500).type("application/problem+json").json(problem);
  }) satisfies ErrorRequestHandler);

  return app;
}
