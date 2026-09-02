import type { DbClient } from "./auth.js";
import { recordAuditEvent } from "./audit.js";

export type AutomationSafetyScope = "global" | "tenant" | "bot" | "channel" | "conversation";

export interface AutomationSafetyControl {
  id: string;
  organizationId: string | null;
  scope: AutomationSafetyScope;
  scopeId: string | null;
  disabled: boolean;
  reason: string;
  actorUserId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActiveAutomationSafety {
  controlId: string;
  scope: AutomationSafetyScope;
  reason: string;
  expiresAt: Date | null;
}

export async function resolveAutomationSafety(
  db: DbClient,
  input: {
    organizationId: string;
    botConfigId?: string | null;
    channelId?: string | null;
    conversationId?: string | null;
  }
): Promise<ActiveAutomationSafety | null> {
  const result = await db.query<{
    control_id: string;
    scope: AutomationSafetyScope;
    reason: string;
    expires_at: Date | null;
  }>(
    `SELECT * FROM flowdesk.resolve_automation_safety($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
    [
      input.organizationId,
      input.botConfigId ?? null,
      input.channelId ?? null,
      input.conversationId ?? null
    ]
  );
  const row = result.rows[0];
  return row
    ? { controlId: row.control_id, scope: row.scope, reason: row.reason, expiresAt: row.expires_at }
    : null;
}

export async function upsertAutomationSafetyControl(
  db: DbClient,
  input: {
    organizationId?: string | null;
    scope: AutomationSafetyScope;
    scopeId?: string | null;
    disabled: boolean;
    reason: string;
    actorUserId?: string | null;
    expiresAt?: Date | null;
  }
): Promise<AutomationSafetyControl> {
  const conflictTarget =
    input.scope === "global"
      ? "(scope) WHERE scope = 'global'"
      : input.scope === "tenant"
        ? "(organization_id, scope) WHERE scope = 'tenant'"
        : "(organization_id, scope, scope_id) WHERE scope IN ('bot', 'channel', 'conversation')";
  const result = await db.query<{
    id: string;
    organization_id: string | null;
    scope: AutomationSafetyScope;
    scope_id: string | null;
    disabled: boolean;
    reason: string;
    actor_user_id: string | null;
    expires_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO flowdesk.automation_safety_controls
       (organization_id, scope, scope_id, disabled, reason, actor_user_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT ${conflictTarget}
     DO UPDATE SET disabled = EXCLUDED.disabled, reason = EXCLUDED.reason,
                   actor_user_id = EXCLUDED.actor_user_id, expires_at = EXCLUDED.expires_at,
                   updated_at = clock_timestamp()
     RETURNING *`,
    [
      input.organizationId ?? null,
      input.scope,
      input.scopeId ?? null,
      input.disabled,
      input.reason,
      input.actorUserId ?? null,
      input.expiresAt ?? null
    ]
  );
  const row = result.rows[0]!;
  return {
    id: row.id,
    organizationId: row.organization_id,
    scope: row.scope,
    scopeId: row.scope_id,
    disabled: row.disabled,
    reason: row.reason,
    actorUserId: row.actor_user_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function cancelPendingAutomationForConversation(
  db: DbClient,
  input: {
    organizationId: string;
    conversationId: string;
    reason: string;
    actorUserId?: string | null;
  }
): Promise<{ runsCancelled: number; messagesCancelled: number }> {
  const runs = await db.query(
    `UPDATE flowdesk.bot_runs
     SET status = 'cancelled', error_code = 'AUTO_TAKEOVER_CANCELLED', error_detail = $3,
         metadata = metadata || jsonb_build_object('cancelReason', $3::text, 'cancelledAt', clock_timestamp()),
         updated_at = clock_timestamp()
     WHERE organization_id = $1 AND conversation_id = $2 AND mode = 'auto'
       AND status IN ('queued', 'processing', 'completed') AND operator_action IS NULL`,
    [input.organizationId, input.conversationId, input.reason]
  );

  const messages = await db.query(
    `UPDATE flowdesk.messages AS message
     SET status = 'failed', error_detail = $3, updated_at = clock_timestamp()
     WHERE message.organization_id = $1 AND message.conversation_id = $2
       AND message.sender_type = 'bot' AND message.status = 'queued'
       AND message.metadata ? 'aiBotRunId'
       AND EXISTS (
         SELECT 1 FROM flowdesk.outbound_intents AS intent
         WHERE intent.organization_id = message.organization_id
           AND intent.message_id = message.id AND intent.state = 'queued'
       )`,
    [input.organizationId, input.conversationId, input.reason]
  );
  await db.query(
    `UPDATE flowdesk.outbound_intents AS intent
     SET state = 'failed', last_error = $3, updated_at = clock_timestamp()
     FROM flowdesk.messages AS message
     WHERE intent.organization_id = $1 AND message.conversation_id = $2
       AND message.organization_id = intent.organization_id AND message.id = intent.message_id
       AND message.sender_type = 'bot' AND message.metadata ? 'aiBotRunId'
       AND intent.state = 'queued'`,
    [input.organizationId, input.conversationId, input.reason]
  );

  await recordAuditEvent(db, {
    organizationId: input.organizationId,
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: "bot:auto:pending-cancelled",
    targetType: "conversation",
    targetId: input.conversationId,
    result: "allowed",
    metadata: { reason: input.reason, runsCancelled: runs.rowCount ?? 0, messagesCancelled: messages.rowCount ?? 0 }
  });
  return { runsCancelled: runs.rowCount ?? 0, messagesCancelled: messages.rowCount ?? 0 };
}
