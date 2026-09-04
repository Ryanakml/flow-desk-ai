import { describe, expect, it, vi } from "vitest";
import {
  generateApiKey,
  hashApiKey,
  verifyApiKeyHash,
  computeWebhookSignature,
  verifyWebhookSignature,
  hasRequiredScope
} from "@flowdesk/security";
import {
  getAnalyticsOverview,
  getVolumeTimeSeries,
  aggregateHourlyMetricsForOrg,
  type DbClient
} from "@flowdesk/db";
import { dispatchDeveloperWebhook } from "./webhook-dispatch.js";

const testWebhookSecret = (seed = "test") => `whsec_${seed.padEnd(32, "x")}`;

describe("Milestone 6 End-to-End Community Platform Suite (M6-06)", () => {
  describe("M6-02: Developer API Keys & Scopes", () => {
    it("generates and verifies scoped developer API keys with cryptographic security", () => {
      const { rawKey, keyPrefix, keyHash } = generateApiKey();
      expect(rawKey.startsWith("fd_live_")).toBe(true);
      expect(keyPrefix).toBe("fd_live_");

      const computedHash = hashApiKey(rawKey);
      expect(computedHash).toBe(keyHash);
      expect(verifyApiKeyHash(rawKey, keyHash)).toBe(true);
      expect(verifyApiKeyHash("fd_live_invalid_key_12345", keyHash)).toBe(false);

      // Scopes enforcement check
      expect(
        hasRequiredScope(["conversations:read", "conversations:write"], "conversations:read")
      ).toBe(true);
      expect(hasRequiredScope(["conversations:read"], "conversations:write")).toBe(false);
      expect(hasRequiredScope(["*"], "anything:allowed")).toBe(true);
    });
  });

  describe("M6-02: Webhook Signing & Verification", () => {
    it("computes HMAC-SHA256 signature and verifies within clock tolerance", () => {
      const payload = JSON.stringify({ event: "conversation.created", conversationId: "conv-101" });
      const secret = testWebhookSecret("valid");
      const nowSeconds = Math.floor(Date.now() / 1000);

      const header = computeWebhookSignature(payload, secret, nowSeconds);
      expect(header).toContain(`t=${nowSeconds},v1=`);

      // Valid verification
      const isValid = verifyWebhookSignature(payload, secret, header, 300);
      expect(isValid).toBe(true);

      // Tampered payload fails
      const tamperedValid = verifyWebhookSignature(payload + "tampered", secret, header, 300);
      expect(tamperedValid).toBe(false);

      // Wrong secret fails
      const wrongSecretValid = verifyWebhookSignature(
        payload,
        testWebhookSecret("wrong"),
        header,
        300
      );
      expect(wrongSecretValid).toBe(false);

      // Expired signature (> 300s) fails
      const oldHeader = computeWebhookSignature(payload, secret, nowSeconds - 400);
      const expiredValid = verifyWebhookSignature(payload, secret, oldHeader, 300);
      expect(expiredValid).toBe(false);
    });
  });

  describe("M6-02: Webhook Dispatch Engine & Retries", () => {
    it("successfully dispatches webhook and records delivered outcome", async () => {
      const queries: string[] = [];
      const mockDb: DbClient = {
        async query(sql: string) {
          await Promise.resolve();
          queries.push(sql);
          if (sql.includes("flowdesk.webhook_deliveries") && sql.includes("INSERT")) {
            return {
              rows: [
                {
                  id: "del-1",
                  organization_id: "org-1",
                  subscription_id: "sub-1",
                  event_id: "evt-1",
                  event_type: "conversation.created",
                  payload: { test: true },
                  status: "pending",
                  attempt_count: 0,
                  max_attempts: 5,
                  next_attempt_at: new Date(),
                  delivered_at: null,
                  response_status_code: null,
                  last_error: null,
                  created_at: new Date(),
                  updated_at: new Date()
                }
              ],
              rowCount: 1,
              command: "INSERT",
              oid: 0,
              fields: []
            };
          }
          return { rows: [], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }
      } as unknown as DbClient;

      // Mock successful fetch
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("OK")
      });

      const event = {
        id: "outbox-1",
        organizationId: "org-1",
        aggregateType: "webhook_subscription",
        aggregateId: "sub-1",
        eventType: "developer.webhook.dispatch",
        payload: {
          subscriptionId: "sub-1",
          eventId: "evt-1",
          eventType: "conversation.created",
          url: "https://example.com/webhooks",
          secret: testWebhookSecret("sub1"),
          payload: { event: "conversation.created", id: "conv-1" }
        },
        correlationId: "evt-1",
        causationId: null,
        publishedAt: null,
        schemaVersion: 1,
        attempts: 1,
        maxAttempts: 5,
        backoffSeconds: 30,
        lockedAt: new Date(),
        lastError: null,
        occurredAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const outcome = await dispatchDeveloperWebhook(mockDb, event, {
        fetchFn: mockFetch as unknown as typeof fetch
      });

      expect(outcome.status).toBe("delivered");
      expect(outcome.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify delivery outcome update was performed
      const updateQuery = queries.find((q) => q.includes("UPDATE flowdesk.webhook_deliveries"));
      expect(updateQuery).toBeDefined();
    });

    it("handles webhook failure with retry exponential backoff and dead letter on max attempts", async () => {
      const mockDb: DbClient = {
        async query(sql: string) {
          await Promise.resolve();
          if (sql.includes("flowdesk.webhook_deliveries") && sql.includes("INSERT")) {
            return {
              rows: [
                {
                  id: "del-2",
                  organization_id: "org-1",
                  subscription_id: "sub-1",
                  event_id: "evt-2",
                  event_type: "message.received",
                  payload: { test: true },
                  status: "pending",
                  attempt_count: 4,
                  max_attempts: 5,
                  next_attempt_at: new Date(),
                  delivered_at: null,
                  response_status_code: null,
                  last_error: null,
                  created_at: new Date(),
                  updated_at: new Date()
                }
              ],
              rowCount: 1,
              command: "INSERT",
              oid: 0,
              fields: []
            };
          }
          return { rows: [], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }
      } as unknown as DbClient;

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.resolve("Service Unavailable")
      });

      const eventFail = {
        id: "outbox-2",
        organizationId: "org-1",
        aggregateType: "webhook_subscription",
        aggregateId: "sub-1",
        eventType: "developer.webhook.dispatch",
        payload: {
          subscriptionId: "sub-1",
          eventId: "evt-2",
          eventType: "message.received",
          url: "https://example.com/webhooks",
          secret: testWebhookSecret("sub2"),
          payload: { event: "message.received" }
        },
        correlationId: "evt-2",
        causationId: null,
        publishedAt: null,
        schemaVersion: 1,
        attempts: 5,
        maxAttempts: 5,
        backoffSeconds: 30,
        lockedAt: new Date(),
        lastError: null,
        occurredAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const outcome = await dispatchDeveloperWebhook(mockDb, eventFail, {
        fetchFn: mockFetch as unknown as typeof fetch
      });

      expect(outcome.status).toBe("dead_letter");
      expect(outcome.statusCode).toBe(503);
    });
  });

  describe("M6-03: Analytics Engine & Hourly Aggregation", () => {
    it("aggregates hourly metrics for tenant into rollups and advances watermark", async () => {
      const queries: string[] = [];
      const mockDb: DbClient = {
        async query(sql: string) {
          await Promise.resolve();
          queries.push(sql);
          if (sql.includes("analytics_watermarks")) {
            return {
              rows: [{ last_aggregated_hour: new Date("2026-08-30T00:00:00Z") }],
              rowCount: 1,
              command: "SELECT",
              oid: 0,
              fields: []
            };
          }
          if (sql.includes("FROM flowdesk.messages") && sql.includes("date_trunc")) {
            return {
              rows: [
                {
                  bucket: new Date("2026-08-30T01:00:00Z"),
                  inbound_count: "20",
                  outbound_count: "18",
                  bot_count: "12",
                  human_count: "6"
                }
              ],
              rowCount: 1,
              command: "SELECT",
              oid: 0,
              fields: []
            };
          }
          if (sql.includes("FROM flowdesk.conversations") && sql.includes("date_trunc")) {
            return {
              rows: [
                {
                  bucket: new Date("2026-08-30T01:00:00Z"),
                  created_count: "10",
                  resolved_count: "8",
                  frt_count: "7",
                  frt_total_seconds: "420",
                  res_count: "8",
                  res_total_seconds: "3600",
                  sla_met: "7",
                  sla_breach: "1"
                }
              ],
              rowCount: 1,
              command: "SELECT",
              oid: 0,
              fields: []
            };
          }
          return { rows: [], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
        }
      } as unknown as DbClient;

      const upsertedCount = await aggregateHourlyMetricsForOrg(mockDb, "org-m6-test");
      expect(upsertedCount).toBeGreaterThanOrEqual(1);

      // Verify aggregate insert and watermark advance occurred
      const insertAgg = queries.find((q) => q.includes("flowdesk.analytics_aggregates_hourly"));
      expect(insertAgg).toBeDefined();

      const advanceWatermark = queries.find((q) => q.includes("flowdesk.analytics_watermarks"));
      expect(advanceWatermark).toBeDefined();
    });

    it("aggregates real-time tenant analytics metrics and daily message volume series", async () => {
      const orgId = "org-e2e-m6";
      const mockDb: DbClient = {
        async query(sql: string) {
          await Promise.resolve();
          if (sql.includes("flowdesk.conversations")) {
            return {
              rows: [{ total: "120", open: "15", assigned: "70", resolved: "105" }],
              rowCount: 1,
              command: "SELECT",
              oid: 0,
              fields: []
            };
          }
          if (sql.includes("flowdesk.messages") && sql.includes("GROUP BY")) {
            return {
              rows: [
                { day: "2026-08-29", inbound: "100", outbound: "80", bot: "60" },
                { day: "2026-08-30", inbound: "150", outbound: "120", bot: "110" }
              ],
              rowCount: 2,
              command: "SELECT",
              oid: 0,
              fields: []
            };
          }
          if (sql.includes("flowdesk.messages")) {
            return {
              rows: [{ total: "450", inbound: "250", outbound: "200", bot: "300", human: "150" }],
              rowCount: 1,
              command: "SELECT",
              oid: 0,
              fields: []
            };
          }
          return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
        }
      } as unknown as DbClient;

      const overview = await getAnalyticsOverview(mockDb, orgId, 30);
      expect(overview.totalConversations).toBe(120);
      expect(overview.openConversations).toBe(15);
      expect(overview.botAutomationRate).toBe(66.7);

      const series = await getVolumeTimeSeries(mockDb, orgId, 7);
      expect(series).toHaveLength(2);
      expect(series[1]?.bot).toBe(110);
    });
  });
});
