import { describe, expect, it } from "vitest";
import { syntheticFixture } from "./index.js";

describe("syntheticFixture", () => {
  it("contains no realistic customer identifiers", () =>
    expect(syntheticFixture.organizationId).toMatch(/^0{8}/));
});
