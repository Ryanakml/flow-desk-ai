import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, verifyApiKeyHash } from "@flowdesk/security";
import { getAnalyticsOverview, getVolumeTimeSeries } from "@flowdesk/db";
import type { DbClient } from "@flowdesk/db";

describe("Milestone 6 End-to-End Community Platform Suite (M6-06)", () => {
  it("generates and verifies scoped developer API keys with cryptographic security", () => {
    const { rawKey } = generateApiKey();
    expect(rawKey.startsWith("fd_live_")).toBe(true);

    const hash = hashApiKey(rawKey);
    expect(verifyApiKeyHash(rawKey, hash)).toBe(true);
    expect(verifyApiKeyHash("fd_live_invalid_key", hash)).toBe(false);
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
