import { describe, expect, it } from "vitest";
import type { DbClient } from "./auth.js";
import { getAnalyticsOverview, getVolumeTimeSeries } from "./analytics.js";

describe("Database Analytics Module (M6-03)", () => {
  const orgId = "org-123";

  it("calculates analytics overview metrics accurately", async () => {
    const mockDb: DbClient = {
      async query(sql: string) {
        await Promise.resolve();
        if (sql.includes("flowdesk.conversations")) {
          return {
            rows: [{ total: "50", open: "10", assigned: "30", resolved: "40" }],
            rowCount: 1,
            command: "SELECT",
            oid: 0,
            fields: []
          };
        }
        if (sql.includes("flowdesk.messages")) {
          return {
            rows: [{ total: "200", inbound: "100", outbound: "100", bot: "150", human: "50" }],
            rowCount: 1,
            command: "SELECT",
            oid: 0,
            fields: []
          };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }
    } as unknown as DbClient;

    const metrics = await getAnalyticsOverview(mockDb, orgId, 30);
    expect(metrics.totalConversations).toBe(50);
    expect(metrics.openConversations).toBe(10);
    expect(metrics.resolvedConversations).toBe(40);
    expect(metrics.totalMessages).toBe(200);
    expect(metrics.botMessages).toBe(150);
    expect(metrics.botAutomationRate).toBe(75);
  });

  it("retrieves volume time series data points sorted chronologically", async () => {
    const mockDb: DbClient = {
      async query() {
        await Promise.resolve();
        return {
          rows: [
            { day: "2026-08-28", inbound: "10", outbound: "8", bot: "5" },
            { day: "2026-08-29", inbound: "15", outbound: "12", bot: "10" }
          ],
          rowCount: 2,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }
    } as unknown as DbClient;

    const series = await getVolumeTimeSeries(mockDb, orgId, 7);
    expect(series).toHaveLength(2);
    expect(series[0]?.date).toBe("2026-08-28");
    expect(series[0]?.inbound).toBe(10);
    expect(series[1]?.bot).toBe(10);
  });
});
