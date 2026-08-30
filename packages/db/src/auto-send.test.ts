import { describe, expect, it } from "vitest";
import type { DbClient } from "./auth.js";
import { countRecentAutoReplies } from "./auto-send.js";

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
});
