import { describe, expect, it } from "vitest";
import { workerState } from "./process.js";

describe("worker process state", () => {
  it("reflects active and idle job claiming modes", () => {
    expect(workerState(true).claimsJobs).toBe(true);
    expect(workerState(false).claimsJobs).toBe(false);
  });
});
