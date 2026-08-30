import { describe, expect, it } from "vitest";
import {
  validateAutoSendPolicy,
  appendAiDisclaimer,
  AI_DISCLAIMER_FOOTER,
  type PreSendValidationContext
} from "./auto-send.js";

describe("Pre-Send Auto-Send Policy Engine (M5-02)", () => {
  const baseValidContext: PreSendValidationContext = {
    botMode: "auto",
    confidenceScore: 0.95,
    isWithinBusinessHours: true,
    isWithinServiceWindow: true,
    autoReplyCountLastHour: 1,
    customerIntent: "general_inquiry"
  };

  it("passes validation when all policy criteria are met", () => {
    const result = validateAutoSendPolicy(baseValidContext);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("Policy validation passed");
    expect(result.disclaimerFooter).toBe(AI_DISCLAIMER_FOOTER);
  });

  it("appends AI disclaimer footer correctly without duplicating", () => {
    const original = "Halo, terima kasih telah menghubungi CS kami.";
    const appended = appendAiDisclaimer(original);
    expect(appended).toContain(AI_DISCLAIMER_FOOTER);
    expect(appended).toBe(
      "Halo, terima kasih telah menghubungi CS kami.\n\n_Balasan otomatis oleh AI FlowDesk_"
    );

    // Idempotent check
    const doubleAppended = appendAiDisclaimer(appended);
    expect(doubleAppended).toBe(appended);
  });

  it("rejects when killswitch is active", () => {
    const result = validateAutoSendPolicy({
      ...baseValidContext,
      isKillswitchActive: true
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Emergency killswitch is active");
  });

  it("rejects when bot mode is not 'auto'", () => {
    const draftResult = validateAutoSendPolicy({
      ...baseValidContext,
      botMode: "draft"
    });
    expect(draftResult.allowed).toBe(false);
    expect(draftResult.reason).toContain("draft");

    const offResult = validateAutoSendPolicy({
      ...baseValidContext,
      botMode: "off"
    });
    expect(offResult.allowed).toBe(false);
    expect(offResult.reason).toContain("off");
  });

  it("rejects when confidence score is below threshold", () => {
    const lowConfidence = validateAutoSendPolicy({
      ...baseValidContext,
      confidenceScore: 0.85 // below default 0.90
    });
    expect(lowConfidence.allowed).toBe(false);
    expect(lowConfidence.reason).toContain("below threshold 0.9");

    const customThreshold = validateAutoSendPolicy({
      ...baseValidContext,
      confidenceScore: 0.92,
      minConfidenceThreshold: 0.95
    });
    expect(customThreshold.allowed).toBe(false);
    expect(customThreshold.reason).toContain("below threshold 0.95");
  });

  it("rejects when outside of business hours", () => {
    const result = validateAutoSendPolicy({
      ...baseValidContext,
      isWithinBusinessHours: false
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Outside of business hours");
  });

  it("rejects when outside of WhatsApp 24h service window", () => {
    const result = validateAutoSendPolicy({
      ...baseValidContext,
      isWithinServiceWindow: false
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("24h WhatsApp service window");
  });

  it("rejects when customer intent requires human intervention", () => {
    const escalationIntents = ["escalate", "human_required", "complaint"];
    for (const intent of escalationIntents) {
      const result = validateAutoSendPolicy({
        ...baseValidContext,
        customerIntent: intent
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("requires human agent intervention");
    }
  });

  it("rejects when rate limit is reached", () => {
    const result = validateAutoSendPolicy({
      ...baseValidContext,
      autoReplyCountLastHour: 3 // max default = 3
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Auto-reply rate limit exceeded");
  });
});
