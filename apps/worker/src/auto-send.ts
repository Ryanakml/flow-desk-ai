import { type DbClient, countRecentAutoReplies, createMessage } from "@flowdesk/db";
import {
  validateAutoSendPolicy,
  appendAiDisclaimer,
  type PreSendValidationContext
} from "@flowdesk/domain";

export interface AutoSendEvaluationParams {
  organizationId: string;
  conversationId: string;
  channelId: string;
  confidenceScore: number;
  draftContent: string;
  isWithinBusinessHours: boolean;
  isWithinServiceWindow: boolean;
  customerIntent?: string | undefined;
  botMode?: "draft" | "auto" | "off" | undefined;
  minConfidenceThreshold?: number | undefined;
  isKillswitchActive?: boolean | undefined;
}

export interface AutoSendEvaluationResult {
  autoSent: boolean;
  reason: string;
  content: string;
  messageId?: string | undefined;
}

export async function evaluateAndProcessAutoSend(
  db: DbClient,
  params: AutoSendEvaluationParams
): Promise<AutoSendEvaluationResult> {
  const recentCount = await countRecentAutoReplies(
    db,
    params.organizationId,
    params.conversationId,
    60
  );

  const context: PreSendValidationContext = {
    botMode: params.botMode ?? "auto",
    confidenceScore: params.confidenceScore,
    minConfidenceThreshold: params.minConfidenceThreshold ?? 0.9,
    isWithinBusinessHours: params.isWithinBusinessHours,
    isWithinServiceWindow: params.isWithinServiceWindow,
    customerIntent: params.customerIntent,
    autoReplyCountLastHour: recentCount,
    isKillswitchActive: params.isKillswitchActive ?? false
  };

  const policyResult = validateAutoSendPolicy(context);

  if (!policyResult.allowed) {
    return {
      autoSent: false,
      reason: policyResult.reason,
      content: params.draftContent
    };
  }

  const finalContent = appendAiDisclaimer(params.draftContent);

  const createdMessage = await createMessage(db, {
    organizationId: params.organizationId,
    conversationId: params.conversationId,
    channelId: params.channelId,
    direction: "outbound",
    senderType: "bot",
    content: finalContent,
    status: "queued",
    metadata: {
      autoSent: true,
      confidenceScore: params.confidenceScore,
      policyReason: policyResult.reason
    }
  });

  return {
    autoSent: true,
    reason: policyResult.reason,
    content: finalContent,
    messageId: createdMessage.id
  };
}
