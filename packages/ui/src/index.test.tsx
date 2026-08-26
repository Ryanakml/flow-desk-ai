import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./index.js";

describe("StatusBadge", () => {
  it("encodes machine-readable health state", () => {
    const element = StatusBadge({ children: "API", healthy: true }) as ReactElement<{
      "data-status": string;
    }>;
    expect(element.props["data-status"]).toBe("healthy");
  });
});
