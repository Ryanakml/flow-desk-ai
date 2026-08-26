import { describe, expect, it } from "vitest";
import { requireTenantContext } from "./index.js";

describe("requireTenantContext", () => {
  it("rejects missing organization scope", () => {
    expect(() => requireTenantContext({ actorId: "actor", correlationId: "request" })).toThrow();
  });
});
