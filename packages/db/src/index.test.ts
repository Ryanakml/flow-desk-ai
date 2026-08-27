import { describe, expect, it } from "vitest";
import { assertLocalDatabaseReset, createDatabaseId, DATABASE_ROLE_NAMES } from "./index.js";

describe("assertLocalDatabaseReset", () => {
  it("rejects non-local environments", () =>
    expect(() => assertLocalDatabaseReset("staging")).toThrow());

  it("creates UUIDv7 identifiers", () => {
    expect(createDatabaseId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("keeps the runtime role explicitly non-privileged", () => {
    expect(DATABASE_ROLE_NAMES.runtime).toBe("flowdesk_runtime");
  });
});
