import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { context, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import pino, { type DestinationStream, type Logger } from "pino";

export interface RequestContext {
  requestId: string;
  correlationId: string;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(input: Partial<RequestContext>, callback: () => T): T {
  const value = {
    requestId: input.requestId ?? randomUUID(),
    correlationId: input.correlationId ?? input.requestId ?? randomUUID()
  };
  return requestContext.run(value, callback);
}

export function currentRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}

export function createLogger(
  input: {
    service: string;
    environment: string;
    version: string;
    level: string;
  },
  destination?: DestinationStream
): Logger {
  const options = {
    level: input.level,
    base: { service: input.service, environment: input.environment, version: input.version },
    mixin() {
      const request = currentRequestContext();
      const span = trace.getSpan(context.active());
      return {
        ...(request ?? {}),
        ...(span ? { traceId: span.spanContext().traceId } : {})
      };
    },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "authorization",
        "cookie",
        "token",
        "accessToken",
        "refreshToken",
        "password",
        "secret",
        "messageText",
        "providerPayload"
      ],
      censor: "[REDACTED]"
    }
  };
  return destination ? pino(options, destination) : pino(options);
}

export function initializeTelemetry(input: {
  service: string;
  endpoint?: string;
}): () => Promise<void> {
  process.env["OTEL_SERVICE_NAME"] = input.service;
  if (!input.endpoint) return () => Promise.resolve();

  process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] = input.endpoint;
  const endpoint = input.endpoint.endsWith("/") ? input.endpoint : `${input.endpoint}/`;
  const sdk = new NodeSDK({
    serviceName: input.service,
    traceExporter: new OTLPTraceExporter({ url: new URL("v1/traces", endpoint).toString() })
  });
  sdk.start();
  return () => sdk.shutdown();
}

export function createProcessHealthServer(input: {
  service: string;
  version: string;
  gitSha: string;
  environment: string;
}): Server {
  return createServer((request, response) => {
    if (request.url === "/livez" || request.url === "/readyz") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok", ...input }));
      return;
    }
    response.writeHead(404, { "content-type": "application/problem+json" });
    response.end(JSON.stringify({ title: "Not Found", status: 404 }));
  });
}
