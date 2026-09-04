import { describe, expect, it } from "vitest";
import type { DbClient } from "./auth.js";
import { countRecentAutoReplies, getMonthlyAiSpend, MICROCENTS_PER_CENT } from "./auto-send.js";

function createMockDb(count: number): DbClient {
  return {
    async query() {
      await Promise.resolve();
      return {
        rows: [{ count: String(count) }],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: []
      };
    }
  } as unknown as DbClient;
}

describe("DB Auto-Send Rate-Limit Counter (M5-02)", () => {
  it("queries recent bot outbound messages count for a conversation", async () => {
    const db = createMockDb(2);
    const count = await countRecentAutoReplies(
      db,
      "a0000000-0000-4000-8000-000000000001",
      "b0000000-0000-7000-8000-000000000001",
      60
    );
    expect(count).toBe(2);
  });

  it("calculates monthly AI spend in microcents and cents (#179)", async () => {
    const mockDb = {
      async query(queryText: string, params: unknown[]) {
        await Promise.resolve();
        expect(queryText).toContain("COALESCE(SUM(cost_estimate_microcents), 0)");
        expect(queryText).toContain("date_trunc('month', clock_timestamp())");
        expect(params).toEqual(["org-1"]);
        return {
          rows: [{ total_microcents: "250000000" }], // 250,000,000 microcents = 250 cents ($2.50)
          rowCount: 1
        };
      }
    } as unknown as DbClient;

    const spend = await getMonthlyAiSpend(mockDb, "org-1");
    expect(spend.totalMicrocents).toBe(250_000_000n);
    expect(spend.totalCents).toBe(250);
    expect(MICROCENTS_PER_CENT).toBe(1_000_000n);
  });
});
