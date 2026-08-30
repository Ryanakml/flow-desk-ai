import express, { type Request, type Response } from "express";
import type { DbClient } from "@flowdesk/db";
import { recordWebhookEvent } from "@flowdesk/db";
import { computeSha256, getSecurityHeaders, verifyMetaSignature } from "@flowdesk/security";

/**
 * Minimal logger interface accepted by the ingress app. Typed narrowly so the
 * app module does not depend directly on pino — any compatible logger works,
 * including test spies.
 */
export interface IngressLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface IngressAppOptions {
  webhookVerifyToken?: string;
  webhookAppSecret?: string;
  dbClient?: DbClient;
  /** Optional structured logger. When omitted, no events are emitted. */
  logger?: IngressLogger;
}

/**
 * Safely parses the Meta WhatsApp Cloud API phone_number_id from changes[0].value.metadata.
 */
function extractPhoneNumberId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const entry = (payload as Record<string, unknown>)["entry"];
  if (!Array.isArray(entry) || entry.length === 0) return null;
  const firstEntry: unknown = entry[0];
  if (typeof firstEntry !== "object" || firstEntry === null) return null;
  const changes = (firstEntry as Record<string, unknown>)["changes"];
  if (!Array.isArray(changes) || changes.length === 0) return null;
  const firstChange: unknown = changes[0];
  if (typeof firstChange !== "object" || firstChange === null) return null;
  const value = (firstChange as Record<string, unknown>)["value"];
  if (typeof value !== "object" || value === null) return null;
  const metadata = (value as Record<string, unknown>)["metadata"];
  if (typeof metadata !== "object" || metadata === null) return null;
  const phoneId = (metadata as Record<string, unknown>)["phone_number_id"];
  return typeof phoneId === "string" ? phoneId : null;
}

export function createIngressApp(options?: IngressAppOptions) {
  const app = express();
  app.disable("x-powered-by");

  // Apply defensive HTTP security headers
  const securityHeaders = getSecurityHeaders();
  app.use((_req, res, next) => {
    for (const [header, val] of Object.entries(securityHeaders)) {
      res.setHeader(header, val);
    }
    next();
  });

  const defaultVerifyToken =
    options?.webhookVerifyToken ??
    process.env["WEBHOOK_VERIFY_TOKEN"] ??
    "flowdesk_webhook_verify_token_default";

  const defaultAppSecret =
    options?.webhookAppSecret ??
    process.env["WEBHOOK_APP_SECRET"] ??
    "flowdesk_webhook_app_secret_default";

  const dbClient = options?.dbClient;
  const logger = options?.logger;

  // Health and readiness endpoints
  app.get("/livez", (_req, res) => res.json({ status: "ok" }));
  app.get("/readyz", (_req, res) => res.json({ status: "ready", acceptingWebhooks: true }));

  /**
   * Meta Webhook Verification Handshake
   * Validates hub.mode, hub.verify_token, and returns hub.challenge.
   */
  app.get("/webhooks/whatsapp", (req: Request, res: Response): void => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === defaultVerifyToken && typeof challenge === "string") {
      res.status(200).type("text/plain").send(challenge);
      return;
    }

    res.status(403).json({
      type: "https://flowdesk.dev/errors/forbidden",
      title: "Forbidden",
      status: 403,
      detail: "Webhook verification failed: invalid verify token or mode"
    });
  });

  /**
   * Meta Webhook Callback Ingress
   * Captures raw byte buffer, verifies X-Hub-Signature-256 in constant time,
   * computes SHA-256 payload hash, and durably persists before HTTP 200 acknowledgment.
   */
  app.post(
    "/webhooks/whatsapp",
    express.raw({ type: "application/json", limit: "5mb" }),
    (req: Request, res: Response): void => {
      const signatureHeader = req.header("x-hub-signature-256");
      const rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(typeof req.body === "string" ? req.body : "", "utf8");

      if (!rawBody || rawBody.length === 0) {
        res.status(400).json({
          type: "https://flowdesk.dev/errors/bad-request",
          title: "Bad Request",
          status: 400,
          detail: "Empty webhook payload"
        });
        return;
      }

      const isValid = verifyMetaSignature(rawBody, defaultAppSecret, signatureHeader);
      if (!isValid) {
        res.status(401).json({
          type: "https://flowdesk.dev/errors/unauthorized",
          title: "Unauthorized",
          status: 401,
          detail: "Invalid or missing X-Hub-Signature-256 signature"
        });
        return;
      }

      // Safe JSON parsing after signature is verified
      let parsedPayload: unknown;
      try {
        parsedPayload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        res.status(400).json({
          type: "https://flowdesk.dev/errors/bad-request",
          title: "Bad Request",
          status: 400,
          detail: "Malformed JSON payload"
        });
        return;
      }

      const payloadHash = computeSha256(rawBody);
      const phoneNumberId = extractPhoneNumberId(parsedPayload);
      // Propagate request/correlation IDs into log context; never log the
      // raw payload, signature, or any customer message content.
      const requestId = req.header("x-request-id");
      const correlationId = req.header("x-correlation-id") ?? requestId;

      // If database client is provided, persist event durably before acknowledging
      if (dbClient) {
        recordWebhookEvent(dbClient, {
          provider: "whatsapp",
          payloadHash,
          rawPayload: rawBody.toString("utf8"),
          phoneNumberId
        })
          .then((result) => {
            // Log only control-plane identifiers — no payload, no signature, no message text.
            logger?.info(
              {
                eventId: result.webhookEvent.id,
                phoneNumberId,
                organizationId: result.webhookEvent.organizationId,
                deduplicated: result.deduplicated,
                ...(requestId ? { requestId } : {}),
                ...(correlationId ? { correlationId } : {})
              },
              "ingress.webhook.received"
            );
            res.status(200).json({
              status: "received",
              deduplicated: result.deduplicated,
              eventId: result.webhookEvent.id
            });
          })
          .catch((error: unknown) => {
            const errorMessage = error instanceof Error ? error.message : "Database error";
            logger?.error(
              {
                phoneNumberId,
                errorMessage,
                ...(requestId ? { requestId } : {}),
                ...(correlationId ? { correlationId } : {})
              },
              "ingress.webhook.persistence_failed"
            );
            res.status(503).json({
              type: "https://flowdesk.dev/errors/service-unavailable",
              title: "Service Unavailable",
              status: 503,
              detail: `Durable webhook persistence failed; please retry: ${errorMessage}`
            });
          });
        return;
      }

      // Fallback acknowledgment when operating without database client
      res.status(200).json({
        status: "received",
        payloadReceived: typeof parsedPayload === "object" && parsedPayload !== null
      });
    }
  );

  return app;
}
