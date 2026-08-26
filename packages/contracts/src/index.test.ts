import { describe, expect, it } from "vitest";
import { BuildInfoSchema } from "./index.js";

describe("BuildInfoSchema", () => {
  it("rejects an unknown environment", () => {
    expect(() =>
      BuildInfoSchema.parse({ service: "api", version: "dev", gitSha: "x", environment: "qa" })
    ).toThrow();
  });
});
