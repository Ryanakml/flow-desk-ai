import { describe, expect, it } from "vitest";
import { assertLocalDatabaseReset } from "./index.js";

describe("assertLocalDatabaseReset", () => {
  it("rejects non-local environments", () =>
    expect(() => assertLocalDatabaseReset("staging")).toThrow());
});
