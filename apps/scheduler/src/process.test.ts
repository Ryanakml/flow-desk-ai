import { describe, expect, it } from "vitest";
import type { DbClient } from "@flowdesk/db";
import { schedulerState, runAnalyticsAggregationJob } from "./process.js";

describe("scheduler skeleton", () => {
  it("does not schedule domain jobs during M0", () =>
    expect(schedulerState().schedulesJobs).toBe(false));

  it("schedules analytics aggregation job across organizations in M6", async () => {
    const mockDb: DbClient = {
      async query(sql: string) {
        await Promise.resolve();
        if (sql.includes("flowdesk.organizations")) {
          return {
            rows: [{ id: "org-sched-1" }],
            rowCount: 1,
            command: "SELECT",
            oid: 0,
            fields: []
          };
        }
        if (sql.includes("flowdesk.analytics_watermarks")) {
          return {
            rows: [{ last_aggregated_at: new Date() }],
            rowCount: 1,
            command: "SELECT",
            oid: 0,
            fields: []
          };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }
    } as unknown as DbClient;

    const result = await runAnalyticsAggregationJob(mockDb);
    expect(result.organizationsProcessed).toBe(1);
    expect(result.totalBucketsAggregated).toBe(0);
  });
});
