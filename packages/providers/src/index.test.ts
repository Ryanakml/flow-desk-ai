import { describe, expect, it } from "vitest";
import type { HealthCheckedProvider } from "./index.js";

describe("provider boundary", () => {
  it("can be replaced by a deterministic fake", async () => {
    const fake: HealthCheckedProvider = {
      name: "fake",
      checkHealth() {
        return Promise.resolve({
          status: "available" as const,
          checkedAt: "2026-01-01T00:00:00.000Z"
        });
      }
    };
    await expect(fake.checkHealth()).resolves.toMatchObject({ status: "available" });
  });
});
