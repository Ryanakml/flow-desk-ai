import {
  type DbClient,
  countRecentAutoReplies,
  createMessage,
  createOutboundMessageWithOutbox,
  getMonthlyAiSpend,
  getOutboundMessageByBotRun,
  MICROCENTS_PER_CENT,
  recordAuditEvent,
  resolveAutomationSafety
} from "@flowdesk/db";
import {
  validateAutoSendPolicy,
  appendAiDisclaimer,
  calculateServiceWindow,
  DEFAULT_MIN_CONFIDENCE_THRESHOLD,
  type PreSendValidationContext
} from "@flowdesk/domain";
import { recordAutoSendOutcome, setEmergencyKillswitchActive } from "@flowdesk/observability";

interface AutoRunState {
  run_id: string;
  trigger_message_id: string | null;
  bot_config_id: string | null;
  run_status: string;
  run_mode: string;
  confidence: number | null;
  suggested_content: string | null;
  operator_action: string | null;
  run_created_at: Date;
  conversation_id: string;
  channel_id: string;
  conversation_status: string;
  bot_paused: boolean;
  assigned_to_user_id: string | null;
  last_inbound_at: Date | null;
  config_id: string | null;
  config_mode: string | null;
  emergency_disabled: boolean | null;
  confidence_threshold: number | null;
  config_is_current: boolean | null;
  auto_enabled: boolean | null;
  rate_limit_per_hour: number | null;
  monthly_cost_ceiling_cents: number | null;
  customer_consent_required: boolean | null;
  ai_disclosure_enabled: boolean | null;
}

export interface CompletedAutoRunResult {
  autoSent: boolean;
  reason: string;
  messageId?: string;
}

/**
 * Final AUTO gate. The caller must already be inside the tenant transaction that completed the
 * grounded run. Locking the run and conversation serializes this decision with takeover/pause
 * operations; the unique bot-run message index makes retries idempotent.
 */
export async function processCompletedAutoRun(
  db: DbClient,
  input: { organizationId: string; runId: string; correlationId?: string }
): Promise<CompletedAutoRunResult> {
  const existing = await getOutboundMessageByBotRun(db, input.organizationId, input.runId);
  if (existing) return { autoSent: true, reason: "Already dispatched", messageId: existing.id };

  const stateResult = await db.query<AutoRunState>(
    `SELECT run.id AS run_id, run.trigger_message_id, run.bot_config_id,
            run.status AS run_status, run.mode AS run_mode, run.confidence,
            run.suggested_content, run.operator_action, run.created_at AS run_created_at,
            conversation.id AS conversation_id, conversation.channel_id,
            conversation.status AS conversation_status,
            conversation.bot_paused, conversation.assigned_to_user_id,
            conversation.last_inbound_at,
            config.id AS config_id, config.mode AS config_mode,
            config.emergency_disabled, config.confidence_threshold,
            config.auto_enabled, config.rate_limit_per_hour,
            config.monthly_cost_ceiling_cents,
            config.customer_consent_required, config.ai_disclosure_enabled,
            date_trunc('milliseconds', config.updated_at) =
              (run.config_snapshot->>'botConfigUpdatedAt')::timestamptz
              AS config_is_current
     FROM flowdesk.bot_runs AS run
     JOIN flowdesk.conversations AS conversation
       ON conversation.organization_id = run.organization_id
      AND conversation.id = run.conversation_id
     LEFT JOIN flowdesk.bot_configs AS config
       ON config.organization_id = run.organization_id
     WHERE run.organization_id = $1 AND run.id = $2
     FOR UPDATE OF run, conversation`,
    [input.organizationId, input.runId]
  );
  const state = stateResult.rows[0];
  if (!state) return { autoSent: false, reason: "AUTO run context not found" };

  const deny = async (
    reason: string,
    stale = false,
    extraMetadata?: Record<string, unknown>
  ): Promise<CompletedAutoRunResult> => {
    const extraJson = JSON.stringify(extraMetadata ?? {});
    await db.query(
      `UPDATE flowdesk.bot_runs
       SET status = CASE WHEN $3 THEN 'stale' ELSE status END,
           error_code = CASE WHEN $3 THEN 'AUTO_CONTEXT_STALE' ELSE error_code END,
           error_detail = CASE WHEN $3 THEN $2 ELSE error_detail END,
           metadata = metadata || jsonb_build_object(
             'autoDecision', 'denied', 'autoDecisionReason', $2,
             'autoDecisionAt', clock_timestamp()
           ) || $5::jsonb, updated_at = clock_timestamp()
       WHERE organization_id = $1 AND id = $4`,
      [input.organizationId, reason, stale, input.runId, extraJson]
    );
    await recordAuditEvent(db, {
      organizationId: input.organizationId,
      action: "bot:auto-send:denied",
      targetType: "bot_run",
      targetId: input.runId,
      result: "denied",
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      metadata: {
        reason,
        conversationId: state.conversation_id,
        ...(extraMetadata ?? {})
      }
    });
    recordAutoSendOutcome({ status: "denied", reason });
    return { autoSent: false, reason };
  };

  if (process.env["FLOWDESK_GLOBAL_KILLSWITCH"] === "true") {
    return deny("Global emergency killswitch is active", true);
  }

  if (state.run_mode !== "auto" || state.run_status !== "completed" || state.operator_action) {
    return deny("Bot run is not an actionable completed AUTO run");
  }

  const durableSafety = await resolveAutomationSafety(db, {
    organizationId: input.organizationId,
    botConfigId: state.bot_config_id,
    channelId: state.channel_id,
    conversationId: state.conversation_id
  });
  if (durableSafety) {
    return deny(
      `Automation safety stop is active (${durableSafety.scope}): ${durableSafety.reason}`,
      true
    );
  }

  if (state.auto_enabled === false) {
    return deny("AUTO mode is not enabled for tenant/bot", true);
  }

  if (
    state.config_id !== state.bot_config_id ||
    state.config_mode !== "auto" ||
    state.emergency_disabled ||
    state.config_is_current !== true
  ) {
    return deny("AUTO configuration is disabled or changed");
  }

  if (
    (state.rate_limit_per_hour && state.rate_limit_per_hour > 0) ||
    (state.monthly_cost_ceiling_cents && state.monthly_cost_ceiling_cents > 0)
  ) {
    await db.query(`SELECT id FROM flowdesk.bot_configs WHERE organization_id = $1 FOR UPDATE`, [
      input.organizationId
    ]);
  }

  if (state.rate_limit_per_hour && state.rate_limit_per_hour > 0) {
    const hourlySentResult = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM flowdesk.messages
       WHERE organization_id = $1
         AND direction = 'outbound'
         AND metadata->>'aiBotRunId' IS NOT NULL
         AND created_at >= clock_timestamp() - INTERVAL '1 hour'`,
      [input.organizationId]
    );
    const hourlySent = parseInt(hourlySentResult.rows[0]?.count ?? "0", 10);
    if (hourlySent >= state.rate_limit_per_hour) {
      return deny(
        `AUTO hourly rate limit ceiling reached (${hourlySent}/${state.rate_limit_per_hour})`,
        true
      );
    }
  }

  if (state.monthly_cost_ceiling_cents && state.monthly_cost_ceiling_cents > 0) {
    const { totalMicrocents, totalCents } = await getMonthlyAiSpend(db, input.organizationId);
    const ceilingMicrocents = BigInt(state.monthly_cost_ceiling_cents) * MICROCENTS_PER_CENT;
    if (totalMicrocents >= ceilingMicrocents) {
      return deny(
        `AUTO monthly AI cost ceiling reached (${totalCents}/${state.monthly_cost_ceiling_cents} cents)`,
        true,
        {
          monthlySpendCents: totalCents,
          monthlyCostCeilingCents: state.monthly_cost_ceiling_cents,
          totalMicrocents: totalMicrocents.toString()
        }
      );
    }
  }
  if (state.conversation_status === "closed" || state.bot_paused) {
    return deny("Conversation is closed or automation is paused", true);
  }
  if (state.assigned_to_user_id) {
    return deny("Human takeover is active", true);
  }

  const latestCustomer = await db.query<{ id: string }>(
    `SELECT id FROM flowdesk.messages
     WHERE organization_id = $1 AND conversation_id = $2 AND sender_type = 'customer'
     ORDER BY created_at DESC LIMIT 1`,
    [input.organizationId, state.conversation_id]
  );
  if (!state.trigger_message_id || latestCustomer.rows[0]?.id !== state.trigger_message_id) {
    return deny("A newer customer message made the AUTO result stale", true);
  }
  const humanActivity = await db.query(
    `SELECT 1 FROM flowdesk.messages
     WHERE organization_id = $1 AND conversation_id = $2
       AND sender_type = 'agent' AND created_at >= $3
     LIMIT 1`,
    [input.organizationId, state.conversation_id, state.run_created_at]
  );
  if (humanActivity.rows[0]) {
    return deny("Human activity superseded the AUTO result", true);
  }
  if (!state.last_inbound_at || !calculateServiceWindow(state.last_inbound_at).isOpen) {
    return deny("WhatsApp service window is closed");
  }
  if (!state.suggested_content) return deny("Generated answer is empty");

  const recentCount = await countRecentAutoReplies(
    db,
    input.organizationId,
    state.conversation_id,
    60
  );
  const policy = validateAutoSendPolicy({
    botMode: "auto",
    confidenceScore: Number(state.confidence ?? 0),
    minConfidenceThreshold: Math.max(
      Number(state.confidence_threshold ?? DEFAULT_MIN_CONFIDENCE_THRESHOLD),
      DEFAULT_MIN_CONFIDENCE_THRESHOLD
    ),
    isWithinBusinessHours: true,
    isWithinServiceWindow: true,
    autoReplyCountLastHour: recentCount,
    isKillswitchActive: Boolean(state.emergency_disabled)
  });
  if (!policy.allowed) return deny(policy.reason);

  const content = appendAiDisclaimer(state.suggested_content);
  const message = await createOutboundMessageWithOutbox(db, {
    organizationId: input.organizationId,
    conversationId: state.conversation_id,
    senderUserId: null,
    senderType: "bot",
    content,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    metadata: {
      aiBotRunId: input.runId,
      aiTriggerMessageId: state.trigger_message_id,
      aiAutoDecision: "allowed",
      aiAutoPolicyReason: policy.reason
    }
  });
  recordAutoSendOutcome({ status: "sent", reason: policy.reason });
  await db.query(
    `UPDATE flowdesk.bot_runs
     SET operator_action = 'auto_sent', operator_action_at = clock_timestamp(),
         metadata = metadata || jsonb_build_object(
           'autoDecision', 'allowed', 'autoDecisionReason', $3::text,
           'autoDecisionAt', clock_timestamp(), 'outboundMessageId', $2::text
         ), updated_at = clock_timestamp()
     WHERE organization_id = $1 AND id = $4 AND operator_action IS NULL`,
    [input.organizationId, message.id, policy.reason, input.runId]
  );
  await recordAuditEvent(db, {
    organizationId: input.organizationId,
    action: "bot:auto-send:queued",
    targetType: "bot_run",
    targetId: input.runId,
    result: "allowed",
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    metadata: {
      inboundMessageId: state.trigger_message_id,
      conversationId: state.conversation_id,
      outboundMessageId: message.id
    }
  });
  return { autoSent: true, reason: policy.reason, messageId: message.id };
}

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

  const durableSafety = await resolveAutomationSafety(db, {
    organizationId: params.organizationId,
    channelId: params.channelId,
    conversationId: params.conversationId
  });

  const context: PreSendValidationContext = {
    botMode: params.botMode ?? "auto",
    confidenceScore: params.confidenceScore,
    minConfidenceThreshold: params.minConfidenceThreshold ?? 0.9,
    isWithinBusinessHours: params.isWithinBusinessHours,
    isWithinServiceWindow: params.isWithinServiceWindow,
    customerIntent: params.customerIntent,
    autoReplyCountLastHour: recentCount,
    isKillswitchActive: params.isKillswitchActive ?? Boolean(durableSafety)
  };

  const policyResult = validateAutoSendPolicy(context);

  if (!policyResult.allowed) {
    if (durableSafety || params.isKillswitchActive) {
      setEmergencyKillswitchActive(true);
    }
    const reason = durableSafety
      ? `${policyResult.reason}: ${durableSafety.reason}`
      : policyResult.reason;
    recordAutoSendOutcome({ status: "denied", reason });
    return {
      autoSent: false,
      reason,
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

  recordAutoSendOutcome({ status: "sent", reason: policyResult.reason });
  return {
    autoSent: true,
    reason: policyResult.reason,
    content: finalContent,
    messageId: createdMessage.id
  };
}
