import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  setGlobalKillswitch,
  getGlobalKillswitch,
  isAutoSendKillswitchActive
} from "./killswitch.js";

describe("Multi-Level Emergency Killswitch (M5-03)", () => {
  const originalEnv = process.env["GLOBAL_AUTO_SEND_DISABLED"];

  beforeEach(() => {
    delete process.env["GLOBAL_AUTO_SEND_DISABLED"];
    setGlobalKillswitch(false);
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["GLOBAL_AUTO_SEND_DISABLED"] = originalEnv;
    } else {
      delete process.env["GLOBAL_AUTO_SEND_DISABLED"];
    }
    setGlobalKillswitch(false);
  });

  it("evaluates global killswitch via memory setter", () => {
    expect(getGlobalKillswitch()).toBe(false);
    setGlobalKillswitch(true);
    expect(getGlobalKillswitch()).toBe(true);
  });

  it("evaluates global killswitch via environment variable", () => {
    process.env["GLOBAL_AUTO_SEND_DISABLED"] = "true";
    expect(getGlobalKillswitch()).toBe(true);
  });

  it("correctly evaluates multi-level killswitch state", () => {
    // All inactive
    expect(
      isAutoSendKillswitchActive({
        globalDisabled: false,
        tenantDisabled: false,
        conversationPaused: false
      })
    ).toBe(false);

    // Global active
    expect(
      isAutoSendKillswitchActive({
        globalDisabled: true,
        tenantDisabled: false,
        conversationPaused: false
      })
    ).toBe(true);

    // Tenant active
    expect(
      isAutoSendKillswitchActive({
        globalDisabled: false,
        tenantDisabled: true,
        conversationPaused: false
      })
    ).toBe(true);

    // Conversation paused
    expect(
      isAutoSendKillswitchActive({
        globalDisabled: false,
        tenantDisabled: false,
        conversationPaused: true
      })
    ).toBe(true);
  });
});
