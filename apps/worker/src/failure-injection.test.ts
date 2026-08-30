/**
 * M5-05: Failure Injection & Component Degradation Test Suite
 */
import type { DbClient } from "@flowdesk/db";
import { evaluateAndProcessAutoSend } from "./auto-send.js";

describe("Failure Injection & Component Degradation Drills (M5-05)", () => {
  it("fails safe when database experiences connection timeout", async () => {
    const failingDb = {
      async query() {
        await Promise.resolve();
        throw new Error("DB Connection Pool Timeout (simulated fault)");
      }
    } as unknown as DbClient;

    await expect(
      evaluateAndProcessAutoSend(failingDb, {
        organizationId: "org-fault-1",
        conversationId: "conv-fault-1",
        channelId: "chan-fault-1",
        confidenceScore: 0.95,
        draftContent: "Test content",
        isWithinBusinessHours: true,
        isWithinServiceWindow: true
      })
    ).rejects.toThrow("DB Connection Pool Timeout");
  });

  it("handles backoff gracefully on rate limit injection", async () => {
    const rateLimitedDb = {
      async query() {
        await Promise.resolve();
        return {
          rows: [{ count: "3" }], // rate limit reached
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }
    } as unknown as DbClient;

    const result = await evaluateAndProcessAutoSend(rateLimitedDb, {
      organizationId: "org-fault-2",
      conversationId: "conv-fault-2",
      channelId: "chan-fault-2",
      confidenceScore: 0.98,
      draftContent: "Rapid response",
      isWithinBusinessHours: true,
      isWithinServiceWindow: true
    });

    expect(result.autoSent).toBe(false);
    expect(result.reason).toContain("rate limit exceeded");
  });
});
