import { describe, expect, it } from "vitest";
import { schedulerState } from "./process.js";

describe("scheduler skeleton", () => {
  it("does not schedule domain jobs during M0", () =>
    expect(schedulerState().schedulesJobs).toBe(false));
});
