import { describe, expect, it } from "vitest";
import type { DbClient } from "./auth.js";
import { canAccessRealtimeRoom, getRealtimeVersion } from "./realtime.js";

function mockDb(allowed: boolean) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const db = {
    async query(sql: string, values: unknown[] = []) {
      await Promise.resolve();
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), values });
      if (sql.includes("SELECT version")) return { rows: [{ version: "7" }] };
      if (sql.trimStart().startsWith("SELECT 1")) return { rows: allowed ? [{ value: 1 }] : [] };
      return { rows: [] };
    }
  } as unknown as DbClient;
  return { db, calls };
}

describe("realtime database authorization", () => {
  it("returns the monotonic tenant projection version", async () => {
    const { db, calls } = mockDb(true);
    await expect(getRealtimeVersion(db, "org-1")).resolves.toBe(7);
    expect(calls[0]!.sql).toContain("ON CONFLICT");
  });

  it("authorizes organization, team, and conversation rooms server-side", async () => {
    const { db, calls } = mockDb(true);
    await expect(
      canAccessRealtimeRoom(db, {
        organizationId: "org-1",
        userId: "user-1",
        room: { type: "organization" }
      })
    ).resolves.toBe(true);
    await expect(
      canAccessRealtimeRoom(db, {
        organizationId: "org-1",
        userId: "user-1",
        room: { type: "team", id: "team-1" }
      })
    ).resolves.toBe(true);
    await expect(
      canAccessRealtimeRoom(db, {
        organizationId: "org-1",
        userId: "user-1",
        room: { type: "conversation", id: "conversation-1" }
      })
    ).resolves.toBe(true);
    expect(calls.some((call) => call.sql.includes("team_memberships"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("queue_memberships"))).toBe(true);
  });

  it("fails closed when no active authorization row exists", async () => {
    const { db } = mockDb(false);
    await expect(
      canAccessRealtimeRoom(db, {
        organizationId: "org-1",
        userId: "user-1",
        room: { type: "conversation", id: "conversation-1" }
      })
    ).resolves.toBe(false);
  });
});
