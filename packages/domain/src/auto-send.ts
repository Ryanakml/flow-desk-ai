/**
 * M5-02: Policy-Controlled Auto-Send Engine & Pre-Send Validation
 */

export interface PreSendValidationContext {
  botMode: "draft" | "auto" | "off";
  confidenceScore: number;
  minConfidenceThreshold?: number | undefined;
  isWithinBusinessHours: boolean;
  isWithinServiceWindow: boolean;
  customerIntent?: string | undefined;
  autoReplyCountLastHour: number;
  maxAutoRepliesPerHour?: number | undefined;
  isKillswitchActive?: boolean | undefined;
}

export interface PreSendValidationResult {
  allowed: boolean;
  reason: string;
  disclaimerFooter?: string | undefined;
}

export const DEFAULT_MIN_CONFIDENCE_THRESHOLD = 0.9;
export const DEFAULT_MAX_AUTO_REPLIES_PER_HOUR = 3;
export const AI_DISCLAIMER_FOOTER = "_Balasan otomatis oleh AI FlowDesk_";

export function appendAiDisclaimer(content: string): string {
  const trimmed = content.trim();
  if (trimmed.endsWith(AI_DISCLAIMER_FOOTER)) {
    return trimmed;
  }
  return `${trimmed}\n\n${AI_DISCLAIMER_FOOTER}`;
}

export function validateAutoSendPolicy(context: PreSendValidationContext): PreSendValidationResult {
  if (context.isKillswitchActive) {
    return {
      allowed: false,
      reason: "Emergency killswitch is active"
    };
  }

  if (context.botMode !== "auto") {
    return {
      allowed: false,
      reason: `Bot mode is '${context.botMode}' (must be 'auto')`
    };
  }

  const threshold = context.minConfidenceThreshold ?? DEFAULT_MIN_CONFIDENCE_THRESHOLD;
  if (context.confidenceScore < threshold) {
    return {
      allowed: false,
      reason: `Confidence score ${context.confidenceScore} is below threshold ${threshold}`
    };
  }

  if (!context.isWithinBusinessHours) {
    return {
      allowed: false,
      reason: "Outside of business hours"
    };
  }

  if (!context.isWithinServiceWindow) {
    return {
      allowed: false,
      reason: "Outside of 24h WhatsApp service window"
    };
  }

  if (
    context.customerIntent === "escalate" ||
    context.customerIntent === "human_required" ||
    context.customerIntent === "complaint"
  ) {
    return {
      allowed: false,
      reason: `Customer intent '${context.customerIntent}' requires human agent intervention`
    };
  }

  const maxAuto = context.maxAutoRepliesPerHour ?? DEFAULT_MAX_AUTO_REPLIES_PER_HOUR;
  if (context.autoReplyCountLastHour >= maxAuto) {
    return {
      allowed: false,
      reason: `Auto-reply rate limit exceeded (${context.autoReplyCountLastHour}/${maxAuto} in the last hour)`
    };
  }

  return {
    allowed: true,
    reason: "Policy validation passed",
    disclaimerFooter: AI_DISCLAIMER_FOOTER
  };
}
