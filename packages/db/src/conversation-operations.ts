import {
  assertValidConversationStatusTransition,
  calculateBusinessDeadline,
  type BusinessHoursSchedule
} from "@flowdesk/domain";
import { recordAuditEvent } from "./audit.js";
import type { DbClient } from "./auth.js";
import {
  getConversationById,
  OptimisticConcurrencyError,
  type ConversationRecord
} from "./conversations.js";

export class ConversationAccessRevokedError extends Error {
  constructor(message = "Active conversation access is required.") {
    super(message);
    this.name = "ConversationAccessRevokedError";
  }
}

export class ConversationActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationActionError";
  }
}

export type ConversationOperation =
  | { action: "claim" }
  | { action: "release" }
  | { action: "handoff"; targetUserId: string }
  | { action: "note"; body: string }
  | { action: "tag.add"; tagId: string }
  | { action: "tag.remove"; tagId: string }
  | { action: "read"; lastReadMessageId?: string | null | undefined }
  | { action: "unread" }
  | { action: "wait"; reason: string }
  | { action: "resolve" }
  | { action: "reopen" }
  | { action: "bot.pause" }
  | { action: "bot.resume" }
  | { action: "priority"; priority: "low" | "medium" | "high" | "urgent" };

export interface PerformConversationOperationInput {
  organizationId: string;
  conversationId: string;
  actorUserId: string;
  expectedVersion: number;
  correlationId?: string | null;
  now?: Date | undefined;
  operation: ConversationOperation;
}

interface LockedConversationAccess {
  status: ConversationRecord["status"];
  assignedToUserId: string | null;
  queueId: string | null;
  version: number;
  roleKey: string;
  canAccess: boolean;
  firstResponseSeconds: number | null;
  resolutionSeconds: number | null;
  businessTimezone: string | null;
  weeklySchedule: BusinessHoursSchedule | null;
  holidayDates: Array<Date | string> | null;
  pauseWhileWaiting: boolean | null;
  firstResponseRemainingSeconds: number | null;
  resolutionRemainingSeconds: number | null;
}

async function lockAuthorizedConversation(
  db: DbClient,
  input: PerformConversationOperationInput
): Promise<LockedConversationAccess> {
  const result = await db.query<LockedConversationAccess>(
    `SELECT conversation.status,
            conversation.assigned_to_user_id AS "assignedToUserId",
            conversation.queue_id AS "queueId",
            conversation.version,
            role.key AS "roleKey",
            sla.first_response_seconds AS "firstResponseSeconds",
            sla.resolution_seconds AS "resolutionSeconds",
            business_hours.timezone AS "businessTimezone",
            business_hours.weekly_schedule AS "weeklySchedule",
            business_hours.holiday_dates AS "holidayDates",
            sla.pause_while_waiting AS "pauseWhileWaiting",
            conversation.first_response_remaining_seconds AS "firstResponseRemainingSeconds",
            conversation.resolution_remaining_seconds AS "resolutionRemainingSeconds",
            (
              conversation.queue_id IS NULL
              OR role.key IN ('owner', 'admin', 'supervisor')
              OR EXISTS (
                SELECT 1 FROM flowdesk.queue_memberships AS queue_member
                WHERE queue_member.organization_id = conversation.organization_id
                  AND queue_member.queue_id = conversation.queue_id
                  AND queue_member.user_id = membership.user_id
                  AND queue_member.status = 'active'
              )
            ) AS "canAccess"
     FROM flowdesk.conversations AS conversation
     JOIN flowdesk.memberships AS membership
       ON membership.organization_id = conversation.organization_id
      AND membership.user_id = $3
      AND membership.status = 'active'
     JOIN flowdesk.roles AS role ON role.id = membership.role_id
     LEFT JOIN flowdesk.queues AS queue
       ON queue.organization_id = conversation.organization_id
      AND queue.id = conversation.queue_id
     LEFT JOIN flowdesk.sla_policies AS sla
       ON sla.organization_id = queue.organization_id AND sla.id = queue.sla_policy_id
     LEFT JOIN flowdesk.business_hours_policies AS business_hours
       ON business_hours.organization_id = queue.organization_id
      AND business_hours.id = queue.business_hours_policy_id
     WHERE conversation.organization_id = $1 AND conversation.id = $2
     FOR UPDATE OF conversation, membership`,
    [input.organizationId, input.conversationId, input.actorUserId]
  );
  const access = result.rows[0];
  if (!access || !access.canAccess) throw new ConversationAccessRevokedError();
  if (access.queueId && !["owner", "admin", "supervisor"].includes(access.roleKey)) {
    const queueAccess = await db.query(
      `SELECT id FROM flowdesk.queue_memberships
       WHERE organization_id = $1 AND queue_id = $2 AND user_id = $3 AND status = 'active'
       FOR SHARE`,
      [input.organizationId, access.queueId, input.actorUserId]
    );
    if (!queueAccess.rows[0]) throw new ConversationAccessRevokedError();
  }
  if (access.version !== input.expectedVersion) throw new OptimisticConcurrencyError();
  return access;
}

async function assertTargetCanAccessQueue(
  db: DbClient,
  input: PerformConversationOperationInput,
  queueId: string | null,
  targetUserId: string
): Promise<void> {
  const result = await db.query(
    `SELECT 1
     FROM flowdesk.memberships AS membership
     JOIN flowdesk.roles AS role ON role.id = membership.role_id
     WHERE membership.organization_id = $1 AND membership.user_id = $2
       AND membership.status = 'active'
       AND (
         $3::uuid IS NULL
         OR role.key IN ('owner', 'admin', 'supervisor')
         OR EXISTS (
           SELECT 1 FROM flowdesk.queue_memberships AS queue_member
           WHERE queue_member.organization_id = membership.organization_id
             AND queue_member.queue_id = $3 AND queue_member.user_id = membership.user_id
             AND queue_member.status = 'active'
         )
       )
     FOR SHARE OF membership`,
    [input.organizationId, targetUserId, queueId]
  );
  if (!result.rows[0]) {
    throw new ConversationActionError("The handoff target is not an active queue member.");
  }
}

async function bumpConversation(
  db: DbClient,
  input: PerformConversationOperationInput,
  assignments: string[] = [],
  values: unknown[] = []
): Promise<void> {
  values.push(input.organizationId, input.conversationId, input.expectedVersion);
  const organizationIndex = values.length - 2;
  const conversationIndex = values.length - 1;
  const versionIndex = values.length;
  const result = await db.query(
    `UPDATE flowdesk.conversations
     SET ${assignments.length > 0 ? `${assignments.join(", ")}, ` : ""}
         version = version + 1, updated_at = clock_timestamp()
     WHERE organization_id = $${organizationIndex} AND id = $${conversationIndex}
       AND version = $${versionIndex}`,
    values
  );
  if ((result.rowCount ?? 0) !== 1) throw new OptimisticConcurrencyError();
}

async function recordTimeline(
  db: DbClient,
  input: PerformConversationOperationInput,
  payload: Record<string, unknown> = {}
): Promise<void> {
  await db.query(
    `INSERT INTO flowdesk.conversation_events
       (organization_id, conversation_id, event_type, actor_user_id, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      input.organizationId,
      input.conversationId,
      `conversation.${input.operation.action}`,
      input.actorUserId,
      JSON.stringify(payload)
    ]
  );
}

function businessPolicyFromAccess(access: LockedConversationAccess) {
  return access.businessTimezone && access.weeklySchedule
    ? {
        timezone: access.businessTimezone,
        weeklySchedule: access.weeklySchedule,
        holidayDates: (access.holidayDates ?? []).map((date) =>
          typeof date === "string" ? date.slice(0, 10) : date.toISOString().slice(0, 10)
        )
      }
    : null;
}

/** Must run inside one tenant transaction so state, timeline, and audit commit atomically. */
export async function performConversationOperation(
  db: DbClient,
  input: PerformConversationOperationInput
): Promise<ConversationRecord> {
  const access = await lockAuthorizedConversation(db, input);
  const operation = input.operation;
  let timelinePayload: Record<string, unknown> = {};

  switch (operation.action) {
    case "claim": {
      if (access.status === "closed")
        throw new ConversationActionError("Closed conversations cannot be claimed.");
      if (access.assignedToUserId && access.assignedToUserId !== input.actorUserId) {
        throw new ConversationActionError("Conversation is already claimed by another operator.");
      }
      const startedAt = input.now ?? new Date();
      const businessPolicy = businessPolicyFromAccess(access);
      const firstResponseDueAt = access.firstResponseSeconds
        ? calculateBusinessDeadline(startedAt, access.firstResponseSeconds, businessPolicy)
        : null;
      const resolutionDueAt = access.resolutionSeconds
        ? calculateBusinessDeadline(startedAt, access.resolutionSeconds, businessPolicy)
        : null;
      await bumpConversation(
        db,
        input,
        [
          "assigned_to_user_id = $1",
          "status = CASE WHEN status = 'new' THEN 'open' ELSE status END",
          "first_response_due_at = COALESCE(first_response_due_at, $2::timestamptz)",
          "resolution_due_at = COALESCE(resolution_due_at, $3::timestamptz)"
        ],
        [input.actorUserId, firstResponseDueAt, resolutionDueAt]
      );
      break;
    }
    case "release":
      if (
        access.assignedToUserId !== input.actorUserId &&
        !["owner", "admin", "supervisor"].includes(access.roleKey)
      ) {
        throw new ConversationActionError(
          "Only the assignee or a supervisor can release this conversation."
        );
      }
      await bumpConversation(db, input, ["assigned_to_user_id = NULL"]);
      break;
    case "handoff":
      if (!["owner", "admin", "supervisor"].includes(access.roleKey)) {
        throw new ConversationActionError("Supervisor access is required for handoff.");
      }
      await assertTargetCanAccessQueue(db, input, access.queueId, operation.targetUserId);
      await bumpConversation(db, input, ["assigned_to_user_id = $1"], [operation.targetUserId]);
      timelinePayload = { targetUserId: operation.targetUserId };
      break;
    case "note": {
      await bumpConversation(db, input);
      const note = await db.query<{ id: string }>(
        `INSERT INTO flowdesk.conversation_notes
           (organization_id, conversation_id, author_user_id, body)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [input.organizationId, input.conversationId, input.actorUserId, operation.body]
      );
      timelinePayload = { noteId: note.rows[0]!.id };
      break;
    }
    case "tag.add":
      await bumpConversation(db, input);
      await db.query(
        `INSERT INTO flowdesk.conversation_tags
           (organization_id, conversation_id, tag_id, added_by_user_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [input.organizationId, input.conversationId, operation.tagId, input.actorUserId]
      );
      timelinePayload = { tagId: operation.tagId };
      break;
    case "tag.remove":
      await bumpConversation(db, input);
      await db.query(
        `DELETE FROM flowdesk.conversation_tags
         WHERE organization_id = $1 AND conversation_id = $2 AND tag_id = $3`,
        [input.organizationId, input.conversationId, operation.tagId]
      );
      timelinePayload = { tagId: operation.tagId };
      break;
    case "read":
      await bumpConversation(db, input);
      await db.query(
        `INSERT INTO flowdesk.conversation_read_markers
           (organization_id, conversation_id, user_id, last_read_message_id,
            last_read_at, marked_unread)
         VALUES ($1, $2, $3, $4, clock_timestamp(), false)
         ON CONFLICT (organization_id, conversation_id, user_id)
         DO UPDATE SET last_read_message_id = EXCLUDED.last_read_message_id,
                       last_read_at = EXCLUDED.last_read_at, marked_unread = false,
                       updated_at = clock_timestamp()`,
        [
          input.organizationId,
          input.conversationId,
          input.actorUserId,
          operation.lastReadMessageId ?? null
        ]
      );
      break;
    case "unread":
      await bumpConversation(db, input);
      await db.query(
        `INSERT INTO flowdesk.conversation_read_markers
           (organization_id, conversation_id, user_id, marked_unread)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (organization_id, conversation_id, user_id)
         DO UPDATE SET marked_unread = true, updated_at = clock_timestamp()`,
        [input.organizationId, input.conversationId, input.actorUserId]
      );
      break;
    case "wait":
      assertValidConversationStatusTransition(access.status, "pending");
      if (access.pauseWhileWaiting) {
        await bumpConversation(
          db,
          input,
          [
            "status = 'pending'",
            "waiting_reason = $1",
            "sla_paused_at = $2::timestamptz",
            "first_response_remaining_seconds = CASE WHEN first_responded_at IS NULL AND first_response_due_at IS NOT NULL THEN GREATEST(0, floor(extract(epoch FROM (first_response_due_at - $2::timestamptz))))::integer ELSE NULL END",
            "resolution_remaining_seconds = CASE WHEN resolution_due_at IS NOT NULL THEN GREATEST(0, floor(extract(epoch FROM (resolution_due_at - $2::timestamptz))))::integer ELSE NULL END",
            "first_response_due_at = CASE WHEN first_responded_at IS NULL THEN NULL ELSE first_response_due_at END",
            "resolution_due_at = NULL"
          ],
          [operation.reason, input.now ?? new Date()]
        );
      } else {
        await bumpConversation(
          db,
          input,
          ["status = 'pending'", "waiting_reason = $1"],
          [operation.reason]
        );
      }
      timelinePayload = { reason: operation.reason };
      break;
    case "resolve":
      assertValidConversationStatusTransition(access.status, "resolved");
      await bumpConversation(db, input, [
        "status = 'resolved'",
        "resolved_at = clock_timestamp()",
        "waiting_reason = NULL",
        "sla_paused_at = NULL",
        "first_response_remaining_seconds = NULL",
        "resolution_remaining_seconds = NULL"
      ]);
      break;
    case "reopen": {
      assertValidConversationStatusTransition(access.status, "open");
      const reopenedAt = input.now ?? new Date();
      const businessPolicy = businessPolicyFromAccess(access);
      const firstResponseDueAt = access.firstResponseRemainingSeconds
        ? calculateBusinessDeadline(
            reopenedAt,
            access.firstResponseRemainingSeconds,
            businessPolicy
          )
        : null;
      const resolutionDueAt = access.resolutionRemainingSeconds
        ? calculateBusinessDeadline(reopenedAt, access.resolutionRemainingSeconds, businessPolicy)
        : null;
      await bumpConversation(
        db,
        input,
        [
          "status = 'open'",
          "resolved_at = NULL",
          "waiting_reason = NULL",
          "sla_paused_at = NULL",
          "first_response_due_at = COALESCE($1::timestamptz, first_response_due_at)",
          "resolution_due_at = COALESCE($2::timestamptz, resolution_due_at)",
          "first_response_remaining_seconds = NULL",
          "resolution_remaining_seconds = NULL"
        ],
        [firstResponseDueAt, resolutionDueAt]
      );
      break;
    }
    case "bot.pause":
      await bumpConversation(db, input, ["bot_paused = true"]);
      break;
    case "bot.resume":
      await bumpConversation(db, input, ["bot_paused = false"]);
      break;
    case "priority":
      await bumpConversation(db, input, ["priority = $1"], [operation.priority]);
      timelinePayload = { priority: operation.priority };
      break;
  }

  if (operation.action !== "note") await recordTimeline(db, input, timelinePayload);
  await recordAuditEvent(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: `conversation.${operation.action}`,
    targetType: "conversation",
    targetId: input.conversationId,
    result: "allowed",
    correlationId: input.correlationId ?? null,
    metadata: timelinePayload
  });
  return (await getConversationById(db, input.organizationId, input.conversationId))!;
}
