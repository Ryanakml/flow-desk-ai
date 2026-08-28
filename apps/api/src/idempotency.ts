import { createHash } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import type { DbClient } from "@flowdesk/db";
import {
  acquireIdempotencyKey,
  completeIdempotencyKey,
  releaseIdempotencyKey,
  runInTenantTransaction
} from "@flowdesk/db";
import type { Problem } from "@flowdesk/contracts";

export function computeRequestFingerprint(request: Request): string {
  const method = request.method.toUpperCase();
  const path = request.originalUrl ?? request.url;
  const body = request.body ? JSON.stringify(request.body) : "";
  return createHash("sha256").update(`${method}:${path}:${body}`).digest("hex");
}

function sendProblem(
  response: Response,
  status: number,
  code: string,
  title: string,
  detail: string
) {
  const requestId = response.getHeader("x-request-id")?.toString() ?? "unknown";
  const problem: Problem = {
    type: `https://flowdesk.dev/problems/${code.toLowerCase().replace(/_/g, "-")}`,
    title,
    status,
    code,
    detail,
    requestId
  };
  return response.status(status).type("application/problem+json").json(problem);
}

export function createIdempotencyMiddleware(db: DbClient): RequestHandler {
  return async (request: Request, response: Response, next) => {
    // Idempotency only applies to mutating HTTP methods
    const method = request.method.toUpperCase();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      return next();
    }

    const idempotencyKey =
      (request.headers["idempotency-key"] as string | undefined)?.trim() ??
      (request.headers["x-idempotency-key"] as string | undefined)?.trim();

    if (!idempotencyKey) {
      return next();
    }

    if (idempotencyKey.length === 0 || idempotencyKey.length > 256) {
      return sendProblem(
        response,
        400,
        "VALIDATION_ERROR",
        "Invalid Idempotency-Key",
        "Idempotency-Key header must be between 1 and 256 characters."
      );
    }

    const user = request.user;
    if (!user) {
      // If endpoint requires auth, requireAuth will handle it; otherwise proceed
      return next();
    }

    // Extract tenant / organization ID
    const reqBody =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : undefined;
    const bodyOrgId =
      typeof reqBody?.["organizationId"] === "string" ? reqBody["organizationId"] : undefined;
    const paramOrgId =
      typeof request.params["orgId"] === "string" ? request.params["orgId"] : undefined;
    const orgId = paramOrgId ?? bodyOrgId;

    if (!orgId) {
      // Organization scope required for tenant-scoped idempotency table
      return next();
    }

    const route = `${method}:${request.baseUrl}${request.path}`;
    const fingerprint = computeRequestFingerprint(request);

    try {
      const result = await runInTenantTransaction(db, { organizationId: orgId }, (client) =>
        acquireIdempotencyKey(client, {
          organizationId: orgId,
          actorUserId: user.id,
          route,
          key: idempotencyKey,
          requestFingerprint: fingerprint
        })
      );

      if (result.status === "in_flight") {
        return sendProblem(
          response,
          409,
          "IDEMPOTENCY_CONCURRENT_REQUEST",
          "Concurrent Request",
          "A request with this Idempotency-Key is currently in progress."
        );
      }

      if (result.status === "completed") {
        if (result.requestFingerprint && result.requestFingerprint !== fingerprint) {
          return sendProblem(
            response,
            422,
            "IDEMPOTENCY_FINGERPRINT_MISMATCH",
            "Idempotency Key Mismatch",
            "This Idempotency-Key was previously used with a different request payload."
          );
        }

        response.setHeader("Idempotent-Replay", "true");
        return response.status(result.responseStatus ?? 200).json(result.responseBody);
      }

      // Result is "acquired" - intercept response completion
      const originalJson: Response["json"] = response.json.bind(response);
      const originalSend: Response["send"] = response.send.bind(response);
      let capturedBody: unknown = undefined;

      response.json = (body: unknown) => {
        capturedBody = body;
        return originalJson(body);
      };

      response.send = (body: unknown) => {
        if (capturedBody === undefined && typeof body === "string") {
          try {
            capturedBody = JSON.parse(body);
          } catch {
            capturedBody = body;
          }
        }
        return originalSend(body);
      };

      response.on("finish", () => {
        const statusCode = response.statusCode;
        const bodyToPersist = capturedBody ?? {};
        if (statusCode < 500) {
          void runInTenantTransaction(db, { organizationId: orgId }, (client) =>
            completeIdempotencyKey(client, {
              organizationId: orgId,
              actorUserId: user.id,
              route,
              key: idempotencyKey,
              responseStatus: statusCode,
              responseBody: bodyToPersist
            })
          ).catch(() => {});
        } else {
          // 5xx error: release key so user can retry safely
          void runInTenantTransaction(db, { organizationId: orgId }, (client) =>
            releaseIdempotencyKey(client, {
              organizationId: orgId,
              actorUserId: user.id,
              route,
              key: idempotencyKey
            })
          ).catch(() => {});
        }
      });

      return next();
    } catch (error) {
      return next(error);
    }
  };
}
