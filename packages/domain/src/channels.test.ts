import { describe, expect, it } from "vitest";
import { canTransitionChannelStatus, assertValidChannelStatusTransition } from "./channels.js";

describe("Channel Connection State Machine (M2-01)", () => {
  it("allows valid forward transitions", () => {
    // Draft -> Connecting -> Active
    expect(canTransitionChannelStatus("draft", "connecting")).toBe(true);
    expect(canTransitionChannelStatus("connecting", "active")).toBe(true);

    // Active -> Degraded -> Active
    expect(canTransitionChannelStatus("active", "degraded")).toBe(true);
    expect(canTransitionChannelStatus("degraded", "active")).toBe(true);

    // Active -> Disconnected -> Connecting
    expect(canTransitionChannelStatus("active", "disconnected")).toBe(true);
    expect(canTransitionChannelStatus("disconnected", "connecting")).toBe(true);
  });

  it("permits self-transitions (no-op status)", () => {
    expect(canTransitionChannelStatus("active", "active")).toBe(true);
    expect(canTransitionChannelStatus("draft", "draft")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    // Draft cannot go directly to Active without verification
    expect(canTransitionChannelStatus("draft", "active")).toBe(false);
    expect(canTransitionChannelStatus("draft", "degraded")).toBe(false);

    // Disconnected cannot jump to Active without connecting
    expect(canTransitionChannelStatus("disconnected", "active")).toBe(false);
  });

  it("assertValidChannelStatusTransition throws on illegal transitions", () => {
    expect(() => assertValidChannelStatusTransition("draft", "active")).toThrow(
      "Invalid channel status transition from 'draft' to 'active'."
    );
    expect(() => assertValidChannelStatusTransition("connecting", "active")).not.toThrow();
  });
});
