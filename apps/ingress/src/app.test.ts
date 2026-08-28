import request from "supertest";
import { describe, expect, it } from "vitest";
import { computeMetaSignature } from "@flowdesk/security";
import { createIngressApp } from "./app.js";

interface ProblemDetails {
  status: number;
  detail: string;
  title: string;
  type: string;
}

describe("Ingress Application & Webhook Routes (M2-03)", () => {
  const verifyToken = "test_custom_verify_token_123";
  const appSecret = "test_custom_app_secret_456";
  const app = createIngressApp({
    webhookVerifyToken: verifyToken,
    webhookAppSecret: appSecret
  });

  describe("Health & Security Headers", () => {
    it("returns 200 for /livez", async () => {
      const res = await request(app).get("/livez").expect(200);
      expect(res.body).toEqual({ status: "ok" });
    });

    it("returns 200 for /readyz with acceptingWebhooks true", async () => {
      const res = await request(app).get("/readyz").expect(200);
      expect(res.body).toEqual({ status: "ready", acceptingWebhooks: true });
    });

    it("includes defensive security headers", async () => {
      const res = await request(app).get("/livez");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["x-powered-by"]).toBeUndefined();
    });
  });

  describe("GET /webhooks/whatsapp (Verification Handshake)", () => {
    it("successfully verifies valid hub challenge handshake", async () => {
      const res = await request(app)
        .get("/webhooks/whatsapp")
        .query({
          "hub.mode": "subscribe",
          "hub.verify_token": verifyToken,
          "hub.challenge": "1158201236"
        })
        .expect(200);

      expect(res.text).toBe("1158201236");
      expect(res.headers["content-type"]).toContain("text/plain");
    });

    it("returns 403 when verify_token does not match", async () => {
      const res = await request(app)
        .get("/webhooks/whatsapp")
        .query({
          "hub.mode": "subscribe",
          "hub.verify_token": "wrong_token",
          "hub.challenge": "1158201236"
        })
        .expect(403);

      const body = res.body as ProblemDetails;
      expect(body.status).toBe(403);
      expect(body.detail).toContain("Webhook verification failed");
    });

    it("returns 403 when hub.mode is not subscribe", async () => {
      await request(app)
        .get("/webhooks/whatsapp")
        .query({
          "hub.mode": "unsubscribe",
          "hub.verify_token": verifyToken,
          "hub.challenge": "1158201236"
        })
        .expect(403);
    });

    it("returns 403 when query parameters are missing", async () => {
      await request(app).get("/webhooks/whatsapp").expect(403);
    });
  });

  describe("POST /webhooks/whatsapp (Callback Ingress)", () => {
    const validPayload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba_12345",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                messages: [{ id: "wamid.123", text: { body: "Hello" } }]
              }
            }
          ]
        }
      ]
    });

    it("accepts callback with valid X-Hub-Signature-256 header", async () => {
      const signature = computeMetaSignature(validPayload, appSecret);

      const res = await request(app)
        .post("/webhooks/whatsapp")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", signature)
        .send(validPayload)
        .expect(200);

      expect(res.body).toEqual({
        status: "received",
        payloadReceived: true
      });
    });

    it("rejects callback with missing signature header with 401", async () => {
      const res = await request(app)
        .post("/webhooks/whatsapp")
        .set("Content-Type", "application/json")
        .send(validPayload)
        .expect(401);

      const body = res.body as ProblemDetails;
      expect(body.status).toBe(401);
      expect(body.detail).toContain("Invalid or missing X-Hub-Signature-256 signature");
    });

    it("rejects callback with forged/tampered signature header with 401", async () => {
      const signature = computeMetaSignature(validPayload, appSecret);
      const forged = signature.slice(0, -4) + "dead";

      const res = await request(app)
        .post("/webhooks/whatsapp")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", forged)
        .send(validPayload)
        .expect(401);

      const body = res.body as ProblemDetails;
      expect(body.status).toBe(401);
    });

    it("rejects callback when payload body was tampered with", async () => {
      const signature = computeMetaSignature(validPayload, appSecret);
      const tamperedBody = validPayload.replace("Hello", "Tampered");

      const res = await request(app)
        .post("/webhooks/whatsapp")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", signature)
        .send(tamperedBody)
        .expect(401);

      const body = res.body as ProblemDetails;
      expect(body.status).toBe(401);
    });

    it("returns 400 when body is empty", async () => {
      const res = await request(app)
        .post("/webhooks/whatsapp")
        .set("Content-Type", "application/json")
        .send("")
        .expect(400);

      const body = res.body as ProblemDetails;
      expect(body.status).toBe(400);
      expect(body.detail).toContain("Empty webhook payload");
    });

    it("returns 400 when body is valid signature but not valid JSON", async () => {
      const malformed = "this is not json {";
      const signature = computeMetaSignature(malformed, appSecret);

      const res = await request(app)
        .post("/webhooks/whatsapp")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", signature)
        .send(malformed)
        .expect(400);

      const body = res.body as ProblemDetails;
      expect(body.status).toBe(400);
      expect(body.detail).toContain("Malformed JSON payload");
    });
  });
});
