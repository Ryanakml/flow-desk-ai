import { describe, expect, it } from "vitest";
import { workerState } from "./process.js";

describe("worker skeleton", () => {
  it("does not claim domain jobs during M0", () => expect(workerState().claimsJobs).toBe(false));
});
