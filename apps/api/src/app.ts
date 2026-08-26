import { randomUUID } from "node:crypto";
import { BuildInfoSchema, type Problem } from "@flowdesk/contracts";
import { runWithRequestContext } from "@flowdesk/observability";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";

export interface ApiAppOptions {
  service: string;
  version: string;
  gitSha: string;
  environment: "local" | "preview" | "staging" | "production";
  logRequest?: (event: {
    requestId: string;
    correlationId: string;
    method: string;
    path: string;
    statusCode: number;
    durationMs: number;
  }) => void;
}

export function createApiApp(options: ApiAppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(((request, response, next) => {
    const startedAt = performance.now();
    const requestId = request.header("x-request-id") ?? randomUUID();
    const correlationId = request.header("x-correlation-id") ?? requestId;
    response.setHeader("x-request-id", requestId);
    response.once("finish", () => {
      options.logRequest?.({
        requestId,
        correlationId,
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100
      });
    });
    runWithRequestContext({ requestId, correlationId }, next);
  }) satisfies RequestHandler);

  app.get("/livez", (_request, response) => response.status(200).json({ status: "ok" }));
  app.get("/readyz", (_request, response) =>
    response.status(200).json({ status: "ready", checks: { configuration: "ok" } })
  );
  app.get("/api/v1/system/build", (_request, response) => {
    response.json(BuildInfoSchema.parse(options));
  });

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

  app.use(((error: unknown, _request, response, next) => {
    const problem: Problem = {
      type: "https://flowdesk.dev/problems/internal-error",
      title: "Internal server error",
      status: 500,
      code: "INTERNAL_ERROR",
      detail: "The request could not be completed.",
      requestId: response.getHeader("x-request-id")?.toString() ?? "unknown"
    };
    void error;
    void next;
    response.status(500).type("application/problem+json").json(problem);
  }) satisfies ErrorRequestHandler);

  return app;
}
