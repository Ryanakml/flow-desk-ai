import express, { type Request, type Response } from "express";
import { getSecurityHeaders, verifyMetaSignature } from "@flowdesk/security";

export interface IngressAppOptions {
  webhookVerifyToken?: string | undefined;
  webhookAppSecret?: string | undefined;
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
   * Captures raw byte buffer and verifies X-Hub-Signature-256 in constant time before processing.
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

      // Webhook signature verified and payload parsed successfully
      res.status(200).json({
        status: "received",
        payloadReceived: typeof parsedPayload === "object" && parsedPayload !== null
      });
    }
  );

  return app;
}
