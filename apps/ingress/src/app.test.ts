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

  describe("Durable Webhook Persistence & Deduplication (M2-04)", () => {
    interface MockEvent {
      id: string;
      provider: string;
      payloadHash: string;
      rawPayload: string;
      phoneNumberId: string | null;
      status: string;
    }

    function createMockDbClient(failOnInsert = false) {
      const persistedEvents = new Map<string, MockEvent>();

      return {
        persistedEvents,
        client: {
          async query(queryText: string, values: unknown[] = []) {
            await Promise.resolve();
            const sql = queryText.replace(/\s+/g, " ").trim();

            if (failOnInsert && sql.includes("INSERT INTO flowdesk.webhook_events")) {
              throw new Error("Connection terminated unexpectedly");
            }

            if (sql.includes("SELECT organization_id FROM flowdesk.channels")) {
              return {
                rows: [{ organization_id: "org-123" }],
                rowCount: 1,
                command: "SELECT",
                oid: 0,
                fields: []
              };
            }

            if (sql.includes("INSERT INTO flowdesk.webhook_events")) {
              const provider = values[0] as string;
              const payloadHash = values[1] as string;
              const phoneId = (values[2] as string | null) ?? null;
              const orgId = values[3] as string | null;
              const raw = values[4] as string;

              for (const ev of persistedEvents.values()) {
                if (ev.provider === provider && ev.payloadHash === payloadHash) {
                  return { rows: [], rowCount: 0, command: "INSERT", oid: 0, fields: [] };
                }
              }

              const id = `evt-${persistedEvents.size + 1}`;
              const record: MockEvent = {
                id,
                provider,
                payloadHash,
                rawPayload: raw,
                phoneNumberId: phoneId,
                status: "received"
              };
              persistedEvents.set(id, record);
              return {
                rows: [
                  {
                    ...record,
                    organizationId: orgId,
                    correlationId: "corr-1",
                    processingError: null,
                    receivedAt: new Date(),
                    processedAt: null,
                    createdAt: new Date(),
                    updatedAt: new Date()
                  }
                ],
                rowCount: 1,
                command: "INSERT",
                oid: 0,
                fields: []
              };
            }

            if (sql.includes("SELECT set_config")) {
              return {
                rows: [{ set_config: values[0] }],
                rowCount: 1,
                command: "SELECT",
                oid: 0,
                fields: []
              };
            }

            if (sql.includes("INSERT INTO flowdesk.outbox_events")) {
              return { rows: [], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
            }

            if (
              sql.includes("FROM flowdesk.webhook_events WHERE provider = $1 AND payload_hash = $2")
            ) {
              const provider = values[0] as string;
              const payloadHash = values[1] as string;
              for (const ev of persistedEvents.values()) {
                if (ev.provider === provider && ev.payloadHash === payloadHash) {
                  return {
                    rows: [
                      {
                        ...ev,
                        organizationId: "org-123",
                        correlationId: "corr-1",
                        processingError: null,
                        receivedAt: new Date(),
                        processedAt: null,
                        createdAt: new Date(),
                        updatedAt: new Date()
                      }
                    ],
                    rowCount: 1,
                    command: "SELECT",
                    oid: 0,
                    fields: []
                  };
                }
              }
            }

            return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
          }
        }
      };
    }

    const payload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba_1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+1234567890",
                  phone_number_id: "10987654321"
                },
                messages: [{ id: "wamid.001", text: { body: "Inbound test" } }]
              }
            }
          ]
        }
      ]
    });

    it("durably persists inbound webhook and returns 200 with event ID", async () => {
      const mockDb = createMockDbClient();
      const ingressApp = createIngressApp({
        webhookVerifyToken: verifyToken,
        webhookAppSecret: appSecret,
        dbClient: mockDb.client as never
      });

      const signature = computeMetaSignature(payload, appSecret);

      const res = await request(ingressApp)
        .post("/webhooks/whatsapp")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", signature)
        .send(payload)
        .expect(200);

      const body = res.body as { status: string; deduplicated: boolean; eventId: string };
      expect(body.status).toBe("received");
      expect(body.deduplicated).toBe(false);
      expect(body.eventId).toBe("evt-1");
      expect(mockDb.persistedEvents.size).toBe(1);
    });

    it("detects duplicate payload on subsequent delivery, returning deduplicated: true", async () => {
      const mockDb = createMockDbClient();
      const ingressApp = createIngressApp({
        webhookVerifyToken: verifyToken,
        webhookAppSecret: appSecret,
        dbClient: mockDb.client as never
      });

      const signature = computeMetaSignature(payload, appSecret);

      // Delivery 1
      await request(ingressApp)
        .post("/webhooks/whatsapp")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", signature)
        .send(payload)
        .expect(200);

      // Delivery 2 (identical retry)
      const res = await request(ingressApp)
        .post("/webhooks/whatsapp")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", signature)
        .send(payload)
        .expect(200);

      const body = res.body as { status: string; deduplicated: boolean; eventId: string };
      expect(body.status).toBe("received");
      expect(body.deduplicated).toBe(true);
      expect(body.eventId).toBe("evt-1");
      expect(mockDb.persistedEvents.size).toBe(1); // exactly 1 database row
    });

    it("returns HTTP 503 retryable error when database persistence fails", async () => {
      const failingDb = createMockDbClient(true);
      const ingressApp = createIngressApp({
        webhookVerifyToken: verifyToken,
        webhookAppSecret: appSecret,
        dbClient: failingDb.client as never
      });

      const signature = computeMetaSignature(payload, appSecret);

      const res = await request(ingressApp)
        .post("/webhooks/whatsapp")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", signature)
        .send(payload)
        .expect(503);

      const body = res.body as ProblemDetails;
      expect(body.status).toBe(503);
      expect(body.detail).toContain("Durable webhook persistence failed; please retry");
    });
  });

  describe("Structured Webhook Logging (Issue-A fix)", () => {
    interface MockEvent {
      id: string;
      provider: string;
      payloadHash: string;
      rawPayload: string;
      phoneNumberId: string | null;
      status: string;
    }

    function createLoggingMockDb(orgId: string | null = "org-logging-001") {
      const persistedEvents = new Map<string, MockEvent>();
      return {
        persistedEvents,
        client: {
          async query(queryText: string, values: unknown[] = []) {
            await Promise.resolve();
            const sql = queryText.replace(/\s+/g, " ").trim();

            if (sql.includes("SELECT organization_id FROM flowdesk.channels")) {
              if (!orgId) return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
              return {
                rows: [{ organization_id: orgId }],
                rowCount: 1,
                command: "SELECT",
                oid: 0,
                fields: []
              };
            }
            if (sql.includes("INSERT INTO flowdesk.webhook_events")) {
              const id = `evt-log-${persistedEvents.size + 1}`;
              const phoneId = (values[2] as string | null) ?? null;
              const record: MockEvent = {
                id,
                provider: values[0] as string,
                payloadHash: values[1] as string,
                rawPayload: values[4] as string,
                phoneNumberId: phoneId,
                status: "received"
              };
              persistedEvents.set(id, record);
              return {
                rows: [
                  {
                    ...record,
                    organizationId: orgId,
                    correlationId: "corr-log-1",
                    processingError: null,
                    receivedAt: new Date(),
                    processedAt: null,
                    createdAt: new Date(),
                    updatedAt: new Date()
                  }
                ],
                rowCount: 1,
                command: "INSERT",
                oid: 0,
                fields: []
              };
            }
            if (sql.includes("SELECT set_config")) {
              return {
                rows: [{ set_config: values[0] }],
                rowCount: 1,
                command: "SELECT",
                oid: 0,
                fields: []
              };
            }
            if (sql.includes("INSERT INTO flowdesk.outbox_events")) {
              return { rows: [], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
            }
            return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
          }
        }
      };
    }

    const loggingPayload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba_log",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+628001234567",
                  phone_number_id: "99988877766"
                },
                messages: [{ id: "wamid.log.001", type: "text", text: { body: "Hello log test" } }]
              }
            }
          ]
        }
      ]
    });

    it("emits ingress.webhook.received log with control-plane fields on persistence success", async () => {
      const mockDb = createLoggingMockDb("org-logging-001");
      const infoLogs: Array<{ ctx: Record<string, unknown>; msg: string }> = [];
      const ingressApp = createIngressApp({
        webhookVerifyToken: verifyToken,
        webhookAppSecret: appSecret,
        dbClient: mockDb.client as never,
        logger: {
          info: (ctx, msg) => infoLogs.push({ ctx, msg }),
          warn: () => undefined,
          error: () => undefined
        }
      });

      const signature = computeMetaSignature(loggingPayload, appSecret);

      await request(ingressApp)
        .post("/webhooks/whatsapp")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", signature)
        .set("x-request-id", "req-abc")
        .set("x-correlation-id", "corr-xyz")
        .send(loggingPayload)
        .expect(200);

      const receivedLog = infoLogs.find((l) => l.msg === "ingress.webhook.received");
      expect(receivedLog).toBeDefined();
      expect(receivedLog!.ctx).toMatchObject({
        phoneNumberId: "99988877766",
        organizationId: "org-logging-001",
        deduplicated: false,
        requestId: "req-abc",
        correlationId: "corr-xyz"
      });
      expect(receivedLog!.ctx).toHaveProperty("eventId");
      // Must NOT log raw payload, signature, or message body
      expect(JSON.stringify(receivedLog!.ctx)).not.toContain("Hello log test");
      expect(JSON.stringify(receivedLog!.ctx)).not.toContain("sha256=");
    });

    it("emits ingress.webhook.persistence_failed log with phoneNumberId when DB throws", async () => {
      const errorLogs: Array<{ ctx: Record<string, unknown>; msg: string }> = [];
      const failingDb = {
        async query() {
          await Promise.resolve();
          throw new Error("Connection terminated unexpectedly");
        }
      };
      const ingressApp = createIngressApp({
        webhookVerifyToken: verifyToken,
        webhookAppSecret: appSecret,
        dbClient: failingDb as never,
        logger: {
          info: () => undefined,
          warn: () => undefined,
          error: (ctx, msg) => errorLogs.push({ ctx, msg })
        }
      });

      const signature = computeMetaSignature(loggingPayload, appSecret);

      await request(ingressApp)
        .post("/webhooks/whatsapp")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", signature)
        .send(loggingPayload)
        .expect(503);

      const failLog = errorLogs.find((l) => l.msg === "ingress.webhook.persistence_failed");
      expect(failLog).toBeDefined();
      expect(failLog!.ctx).toMatchObject({
        phoneNumberId: "99988877766",
        errorMessage: "Connection terminated unexpectedly"
      });
      // Must NOT log raw payload or signature
      expect(JSON.stringify(failLog!.ctx)).not.toContain("Hello log test");
    });

    it("includes organizationId: null in log when phoneNumberId has no matching channel", async () => {
      const mockDb = createLoggingMockDb(null); // no org resolved
      const infoLogs: Array<{ ctx: Record<string, unknown>; msg: string }> = [];
      const ingressApp = createIngressApp({
        webhookVerifyToken: verifyToken,
        webhookAppSecret: appSecret,
        dbClient: mockDb.client as never,
        logger: {
          info: (ctx, msg) => infoLogs.push({ ctx, msg }),
          warn: () => undefined,
          error: () => undefined
        }
      });

      const signature = computeMetaSignature(loggingPayload, appSecret);

      await request(ingressApp)
        .post("/webhooks/whatsapp")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", signature)
        .send(loggingPayload)
        .expect(200);

      const receivedLog = infoLogs.find((l) => l.msg === "ingress.webhook.received");
      expect(receivedLog).toBeDefined();
      // organizationId is null when phone_number_id doesn't match any channel
      expect(receivedLog!.ctx["organizationId"]).toBeNull();
    });
  });
});
