import { describe, expect, it } from "vitest";
import { redactRecord } from "./index.js";

describe("redactRecord", () => {
  it("redacts nested-boundary inputs by key", () => {
    expect(redactRecord({ accessToken: "secret", status: "ok" })).toEqual({
      accessToken: "[REDACTED]",
      status: "ok"
    });
  });
});
