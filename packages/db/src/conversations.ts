import {
  assertValidConversationStatusTransition,
  assertValidMessageStatusTransition,
  type ConversationPriority,
  type ConversationStatus,
  type MessageDirection,
  type MessageSenderType,
  type MessageStatus
} from "@flowdesk/domain";
import type { DbClient } from "./auth.js";
import { runInTenantTransaction, type TenantContext } from "./tenant-context.js";
import { fanoutDeveloperWebhookEvents } from "./webhook-subscriptions.js";

export class OptimisticConcurrencyError extends Error {
  constructor(message = "Resource version conflict; please reload and retry.") {
    super(message);
    this.name = "OptimisticConcurrencyError";
  }
}

export class ClosedConversationError extends Error {
  constructor(message = "Closed conversations reject outbound messages until reopened.") {
    super(message);
    this.name = "ClosedConversationError";
  }
}

export interface ConversationRecord {
  id: string;
  organizationId: string;
  channelId: string;
  customerPhone: string;
  customerName: string | null;
  status: ConversationStatus;
  priority: ConversationPriority;
  assignedToUserId: string | null;
  queueId: string | null;
  teamId: string | null;
  waitingReason: string | null;
  botPaused: boolean;
  firstResponseDueAt: Date | null;
  resolutionDueAt: Date | null;
  resolvedAt: Date | null;
  firstRespondedAt: Date | null;
  slaPausedAt: Date | null;
  firstResponseRemainingSeconds: number | null;
  resolutionRemainingSeconds: number | null;
  version: number;
  lastMessageAt: Date;
  lastInboundAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageRecord {
  id: string;
  organizationId: string;
  conversationId: string;
  channelId: string;
  direction: MessageDirection;
  senderType: MessageSenderType;
  senderUserId: string | null;
  providerMessageId: string | null;
  content: string;
  status: MessageStatus;
  errorDetail: string | null;
  metadata: Record<string, unknown>;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FindOrCreateConversationInput {
  organizationId: string;
  channelId: string;
  customerPhone: string;
  customerName?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateMessageInput {
  organizationId: string;
  conversationId: string;
  channelId: string;
  direction: MessageDirection;
  senderType: MessageSenderType;
  content: string;
  senderUserId?: string | null;
  providerMessageId?: string | null;
  status?: MessageStatus;
  metadata?: Record<string, unknown>;
  sentAt?: Date | null;
}

/**
 * Finds an existing conversation matching (organization_id, channel_id, customer_phone),
 * or creates a new conversation with status 'new' and version 1.
 */
export async function findOrCreateConversation(
  client: DbClient,
  input: FindOrCreateConversationInput
): Promise<ConversationRecord> {
  const selectRes = await client.query<ConversationRecord>(
    `SELECT
       id, organization_id AS "organizationId", channel_id AS "channelId",
       customer_phone AS "customerPhone", customer_name AS "customerName",
       status, priority, assigned_to_user_id AS "assignedToUserId",
       queue_id AS "queueId", team_id AS "teamId", waiting_reason AS "waitingReason",
       bot_paused AS "botPaused", first_response_due_at AS "firstResponseDueAt",
       resolution_due_at AS "resolutionDueAt", resolved_at AS "resolvedAt",
       first_responded_at AS "firstRespondedAt", sla_paused_at AS "slaPausedAt",
       first_response_remaining_seconds AS "firstResponseRemainingSeconds",
       resolution_remaining_seconds AS "resolutionRemainingSeconds",
       version, last_message_at AS "lastMessageAt", last_inbound_at AS "lastInboundAt", metadata,
       created_at AS "createdAt", updated_at AS "updatedAt"
     FROM flowdesk.conversations
     WHERE organization_id = $1 AND channel_id = $2 AND customer_phone = $3`,
    [input.organizationId, input.channelId, input.customerPhone]
  );

  if (selectRes.rows[0]) {
    return selectRes.rows[0];
  }

  const insertRes = await client.query<ConversationRecord>(
    `INSERT INTO flowdesk.conversations
       (organization_id, channel_id, customer_phone, customer_name, metadata)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (organization_id, channel_id, customer_phone)
     DO UPDATE SET updated_at = clock_timestamp()
     RETURNING
       id, organization_id AS "organizationId", channel_id AS "channelId",
       customer_phone AS "customerPhone", customer_name AS "customerName",
       status, priority, assigned_to_user_id AS "assignedToUserId",
       queue_id AS "queueId", team_id AS "teamId", waiting_reason AS "waitingReason",
       bot_paused AS "botPaused", first_response_due_at AS "firstResponseDueAt",
       resolution_due_at AS "resolutionDueAt", resolved_at AS "resolvedAt",
       first_responded_at AS "firstRespondedAt", sla_paused_at AS "slaPausedAt",
       first_response_remaining_seconds AS "firstResponseRemainingSeconds",
       resolution_remaining_seconds AS "resolutionRemainingSeconds",
       version, last_message_at AS "lastMessageAt", last_inbound_at AS "lastInboundAt", metadata,
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      input.organizationId,
      input.channelId,
      input.customerPhone,
      input.customerName ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );

  const createdConv = insertRes.rows[0]!;
  try {
    await fanoutDeveloperWebhookEvents(client, {
      organizationId: input.organizationId,
      eventType: "conversation.created",
      eventId: `evt_conv_${createdConv.id}`,
      payload: {
        event: "conversation.created",
        timestamp: new Date().toISOString(),
        organizationId: input.organizationId,
        conversationId: createdConv.id,
        conversation: {
          id: createdConv.id,
          channelId: createdConv.channelId,
          customerPhone: createdConv.customerPhone,
          customerName: createdConv.customerName,
          status: createdConv.status,
          createdAt: createdConv.createdAt
        }
      }
    });
  } catch (fanoutErr) {
    if (process.env["NODE_ENV"] === "test" || process.env["NODE_ENV"] === "development") {
      console.warn("[WebhookFanout] Failed to fanout conversation.created:", fanoutErr);
    }
  }

  return createdConv;
}

/**
 * Retrieves a conversation by ID within the tenant scope.
 */
export async function getConversationById(
  client: DbClient,
  organizationId: string,
  id: string
): Promise<ConversationRecord | null> {
  const res = await client.query<ConversationRecord>(
    `SELECT
       id, organization_id AS "organizationId", channel_id AS "channelId",
       customer_phone AS "customerPhone", customer_name AS "customerName",
       status, priority, assigned_to_user_id AS "assignedToUserId",
       queue_id AS "queueId", team_id AS "teamId", waiting_reason AS "waitingReason",
       bot_paused AS "botPaused", first_response_due_at AS "firstResponseDueAt",
       resolution_due_at AS "resolutionDueAt", resolved_at AS "resolvedAt",
       first_responded_at AS "firstRespondedAt", sla_paused_at AS "slaPausedAt",
       first_response_remaining_seconds AS "firstResponseRemainingSeconds",
       resolution_remaining_seconds AS "resolutionRemainingSeconds",
       version, last_message_at AS "lastMessageAt", last_inbound_at AS "lastInboundAt", metadata,
       created_at AS "createdAt", updated_at AS "updatedAt"
     FROM flowdesk.conversations
     WHERE organization_id = $1 AND id = $2`,
    [organizationId, id]
  );
  return res.rows[0] ?? null;
}

/**
 * Transitions conversation status with state-machine validation and optimistic concurrency version check.
 */
export async function updateConversationStatus(
  client: DbClient,
  organizationId: string,
  id: string,
  expectedVersion: number,
  targetStatus: ConversationStatus
): Promise<ConversationRecord> {
  const current = await getConversationById(client, organizationId, id);
  if (!current) {
    throw new Error(`Conversation '${id}' not found.`);
  }

  assertValidConversationStatusTransition(current.status, targetStatus);

  const res = await client.query<ConversationRecord>(
    `UPDATE flowdesk.conversations
     SET status = $1, version = version + 1, updated_at = clock_timestamp()
     WHERE id = $2 AND organization_id = $3 AND version = $4
     RETURNING
       id, organization_id AS "organizationId", channel_id AS "channelId",
       customer_phone AS "customerPhone", customer_name AS "customerName",
       status, priority, assigned_to_user_id AS "assignedToUserId",
       queue_id AS "queueId", team_id AS "teamId", waiting_reason AS "waitingReason",
       bot_paused AS "botPaused", first_response_due_at AS "firstResponseDueAt",
       resolution_due_at AS "resolutionDueAt", resolved_at AS "resolvedAt",
       first_responded_at AS "firstRespondedAt", sla_paused_at AS "slaPausedAt",
       first_response_remaining_seconds AS "firstResponseRemainingSeconds",
       resolution_remaining_seconds AS "resolutionRemainingSeconds",
       version, last_message_at AS "lastMessageAt", last_inbound_at AS "lastInboundAt", metadata,
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    [targetStatus, id, organizationId, expectedVersion]
  );

  if (!res.rows[0]) {
    throw new OptimisticConcurrencyError();
  }

  return res.rows[0];
}

/**
 * Assigns a conversation to an operator with optimistic concurrency version check.
 */
export async function assignConversation(
  client: DbClient,
  organizationId: string,
  id: string,
  expectedVersion: number,
  userId: string | null
): Promise<ConversationRecord> {
  const res = await client.query<ConversationRecord>(
    `UPDATE flowdesk.conversations
     SET assigned_to_user_id = $1, version = version + 1, updated_at = clock_timestamp()
     WHERE id = $2 AND organization_id = $3 AND version = $4
     RETURNING
       id, organization_id AS "organizationId", channel_id AS "channelId",
       customer_phone AS "customerPhone", customer_name AS "customerName",
       status, priority, assigned_to_user_id AS "assignedToUserId",
       queue_id AS "queueId", team_id AS "teamId", waiting_reason AS "waitingReason",
       bot_paused AS "botPaused", first_response_due_at AS "firstResponseDueAt",
       resolution_due_at AS "resolutionDueAt", resolved_at AS "resolvedAt",
       first_responded_at AS "firstRespondedAt", sla_paused_at AS "slaPausedAt",
       first_response_remaining_seconds AS "firstResponseRemainingSeconds",
       resolution_remaining_seconds AS "resolutionRemainingSeconds",
       version, last_message_at AS "lastMessageAt", last_inbound_at AS "lastInboundAt", metadata,
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    [userId, id, organizationId, expectedVersion]
  );

  if (!res.rows[0]) {
    throw new OptimisticConcurrencyError();
  }

  return res.rows[0];
}

/**
 * Creates a message in a conversation.
 * Automatically updates conversation last_message_at and reopens resolved/closed conversations on inbound customer message.
 */
export async function createMessage(
  client: DbClient,
  input: CreateMessageInput
): Promise<MessageRecord> {
  const insertRes = await client.query<MessageRecord>(
    `INSERT INTO flowdesk.messages
       (organization_id, conversation_id, channel_id, direction, sender_type,
        sender_user_id, provider_message_id, content, status, metadata, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING
       id, organization_id AS "organizationId", conversation_id AS "conversationId",
       channel_id AS "channelId", direction, sender_type AS "senderType",
       sender_user_id AS "senderUserId", provider_message_id AS "providerMessageId",
       content, status, error_detail AS "errorDetail", metadata,
       sent_at AS "sentAt", delivered_at AS "deliveredAt", read_at AS "readAt",
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      input.organizationId,
      input.conversationId,
      input.channelId,
      input.direction,
      input.senderType,
      input.senderUserId ?? null,
      input.providerMessageId ?? null,
      input.content,
      input.status ?? (input.direction === "inbound" ? "delivered" : "queued"),
      JSON.stringify(input.metadata ?? {}),
      input.sentAt ?? new Date()
    ]
  );

  const message = insertRes.rows[0]!;

  // Update conversation last_message_at; reopen if inbound customer reply on closed/resolved;
  // record last_inbound_at when message is from customer
  if (input.direction === "inbound") {
    const isCustomerInbound = input.senderType === "customer";
    await client.query(
      `UPDATE flowdesk.conversations
       SET last_message_at = clock_timestamp(),
           last_inbound_at = CASE WHEN $3 = true THEN COALESCE($4, clock_timestamp()) ELSE last_inbound_at END,
           status = CASE WHEN status IN ('resolved', 'closed') THEN 'open' ELSE status END,
           updated_at = clock_timestamp()
       WHERE id = $1 AND organization_id = $2`,
      [input.conversationId, input.organizationId, isCustomerInbound, input.sentAt ?? null]
    );
  } else {
    await client.query(
      `UPDATE flowdesk.conversations
       SET last_message_at = clock_timestamp(), updated_at = clock_timestamp()
       WHERE id = $1 AND organization_id = $2`,
      [input.conversationId, input.organizationId]
    );
  }

  return message;
}

/**
 * Updates message delivery or read status with transition validation.
 */
export async function updateMessageStatus(
  client: DbClient,
  organizationId: string,
  messageId: string,
  targetStatus: MessageStatus,
  extra?: {
    providerMessageId?: string | undefined;
    sentAt?: Date | undefined;
    deliveredAt?: Date | undefined;
    readAt?: Date | undefined;
    errorDetail?: string | undefined;
  }
): Promise<MessageRecord> {
  const selectRes = await client.query<MessageRecord>(
    `SELECT
       id, organization_id AS "organizationId", conversation_id AS "conversationId",
       channel_id AS "channelId", direction, sender_type AS "senderType",
       sender_user_id AS "senderUserId", provider_message_id AS "providerMessageId",
       content, status, error_detail AS "errorDetail", metadata,
       sent_at AS "sentAt", delivered_at AS "deliveredAt", read_at AS "readAt",
       created_at AS "createdAt", updated_at AS "updatedAt"
     FROM flowdesk.messages
     WHERE id = $1 AND organization_id = $2`,
    [messageId, organizationId]
  );

  const current = selectRes.rows[0];
  if (!current) {
    throw new Error(`Message '${messageId}' not found.`);
  }

  assertValidMessageStatusTransition(current.status, targetStatus);

  const updateRes = await client.query<MessageRecord>(
    `UPDATE flowdesk.messages
     SET status = $1,
         provider_message_id = COALESCE($3, provider_message_id),
         sent_at = COALESCE($4, sent_at),
         delivered_at = COALESCE($5, delivered_at),
         read_at = COALESCE($6, read_at),
         error_detail = COALESCE($7, error_detail),
         updated_at = clock_timestamp()
     WHERE id = $2 AND organization_id = $8
     RETURNING
       id, organization_id AS "organizationId", conversation_id AS "conversationId",
       channel_id AS "channelId", direction, sender_type AS "senderType",
       sender_user_id AS "senderUserId", provider_message_id AS "providerMessageId",
       content, status, error_detail AS "errorDetail", metadata,
       sent_at AS "sentAt", delivered_at AS "deliveredAt", read_at AS "readAt",
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      targetStatus,
      messageId,
      extra?.providerMessageId ?? null,
      extra?.sentAt ?? null,
      extra?.deliveredAt ?? null,
      extra?.readAt ?? null,
      extra?.errorDetail ?? null,
      organizationId
    ]
  );

  return updateRes.rows[0]!;
}

export async function getMessageById(
  client: DbClient,
  organizationId: string,
  messageId: string
): Promise<MessageRecord | null> {
  const res = await client.query<MessageRecord>(
    `SELECT
       id, organization_id AS "organizationId", conversation_id AS "conversationId",
       channel_id AS "channelId", direction, sender_type AS "senderType",
       sender_user_id AS "senderUserId", provider_message_id AS "providerMessageId",
       content, status, error_detail AS "errorDetail", metadata,
       sent_at AS "sentAt", delivered_at AS "deliveredAt", read_at AS "readAt",
       created_at AS "createdAt", updated_at AS "updatedAt"
     FROM flowdesk.messages
     WHERE organization_id = $1 AND id = $2
     LIMIT 1`,
    [organizationId, messageId]
  );
  return res.rows[0] ?? null;
}

/**
 * Lists messages for a conversation ordered chronologically.
 */
export async function listMessagesByConversation(
  client: DbClient,
  organizationId: string,
  conversationId: string,
  limit = 50
): Promise<MessageRecord[]> {
  const res = await client.query<MessageRecord>(
    `SELECT
       id, organization_id AS "organizationId", conversation_id AS "conversationId",
       channel_id AS "channelId", direction, sender_type AS "senderType",
       sender_user_id AS "senderUserId", provider_message_id AS "providerMessageId",
       content, status, error_detail AS "errorDetail", metadata,
       sent_at AS "sentAt", delivered_at AS "deliveredAt", read_at AS "readAt",
       created_at AS "createdAt", updated_at AS "updatedAt"
     FROM flowdesk.messages
     WHERE organization_id = $1 AND conversation_id = $2
     ORDER BY created_at ASC
     LIMIT $3`,
    [organizationId, conversationId, limit]
  );
  return res.rows;
}

export interface ListConversationsOptions {
  organizationId: string;
  status?: ConversationStatus | undefined;
  assignedToUserId?: string | null | undefined;
  queueId?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface ListConversationsResult {
  items: ConversationRecord[];
  nextCursor: string | null;
}

/**
 * Lists conversations for a tenant with optional filtering by status and assignee,
 * using cursor-based pagination.
 */
export async function listConversations(
  client: DbClient,
  options: ListConversationsOptions
): Promise<ListConversationsResult> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const values: unknown[] = [options.organizationId];
  const conditions: string[] = ["organization_id = $1"];

  if (options.status) {
    values.push(options.status);
    conditions.push(`status = $${values.length}`);
  }

  if (options.assignedToUserId === null) {
    conditions.push(`assigned_to_user_id IS NULL`);
  } else if (options.assignedToUserId !== undefined) {
    values.push(options.assignedToUserId);
    conditions.push(`assigned_to_user_id = $${values.length}`);
  }

  if (options.queueId) {
    values.push(options.queueId);
    conditions.push(`queue_id = $${values.length}`);
  }

  if (options.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8")) as {
        lastMessageAt: string;
        id: string;
      };
      values.push(new Date(decoded.lastMessageAt), decoded.id);
      const timeIdx = values.length - 1;
      const idIdx = values.length;
      conditions.push(
        `(last_message_at < $${timeIdx} OR (last_message_at = $${timeIdx} AND id < $${idIdx}))`
      );
    } catch {
      // Ignore malformed cursor, start from beginning
    }
  }

  values.push(limit + 1);
  const limitIdx = values.length;

  const sql = `
    SELECT
      id, organization_id AS "organizationId", channel_id AS "channelId",
      customer_phone AS "customerPhone", customer_name AS "customerName",
      status, priority, assigned_to_user_id AS "assignedToUserId",
      queue_id AS "queueId", team_id AS "teamId", waiting_reason AS "waitingReason",
      bot_paused AS "botPaused", first_response_due_at AS "firstResponseDueAt",
      resolution_due_at AS "resolutionDueAt", resolved_at AS "resolvedAt",
      first_responded_at AS "firstRespondedAt", sla_paused_at AS "slaPausedAt",
      first_response_remaining_seconds AS "firstResponseRemainingSeconds",
      resolution_remaining_seconds AS "resolutionRemainingSeconds",
      version, last_message_at AS "lastMessageAt", last_inbound_at AS "lastInboundAt", metadata,
      created_at AS "createdAt", updated_at AS "updatedAt"
    FROM flowdesk.conversations
    WHERE ${conditions.join(" AND ")}
    ORDER BY last_message_at DESC, id DESC
    LIMIT $${limitIdx}`;

  const res = await client.query<ConversationRecord>(sql, values);
  const rows = res.rows;
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const lastItem = items[items.length - 1]!;
    nextCursor = Buffer.from(
      JSON.stringify({
        lastMessageAt: lastItem.lastMessageAt.toISOString(),
        id: lastItem.id
      }),
      "utf8"
    ).toString("base64url");
  }

  return { items, nextCursor };
}

export interface UpdateConversationOptions {
  organizationId: string;
  id: string;
  expectedVersion: number;
  status?: ConversationStatus | undefined;
  assignedToUserId?: string | null | undefined;
}

/**
 * Updates conversation status and/or assignee with optimistic concurrency version check.
 */
export async function updateConversation(
  client: DbClient,
  options: UpdateConversationOptions
): Promise<ConversationRecord> {
  const current = await getConversationById(client, options.organizationId, options.id);
  if (!current) {
    throw new Error(`Conversation '${options.id}' not found.`);
  }

  if (options.status && options.status !== current.status) {
    assertValidConversationStatusTransition(current.status, options.status);
  }

  const setClauses: string[] = ["version = version + 1", "updated_at = clock_timestamp()"];
  const values: unknown[] = [];

  if (options.status) {
    values.push(options.status);
    setClauses.push(`status = $${values.length}`);
  }

  if (options.assignedToUserId !== undefined) {
    values.push(options.assignedToUserId);
    setClauses.push(`assigned_to_user_id = $${values.length}`);
  }

  values.push(options.id, options.organizationId, options.expectedVersion);
  const idIdx = values.length - 2;
  const orgIdx = values.length - 1;
  const verIdx = values.length;

  const sql = `
    UPDATE flowdesk.conversations
    SET ${setClauses.join(", ")}
    WHERE id = $${idIdx} AND organization_id = $${orgIdx} AND version = $${verIdx}
    RETURNING
      id, organization_id AS "organizationId", channel_id AS "channelId",
      customer_phone AS "customerPhone", customer_name AS "customerName",
      status, priority, assigned_to_user_id AS "assignedToUserId",
      queue_id AS "queueId", team_id AS "teamId", waiting_reason AS "waitingReason",
      bot_paused AS "botPaused", first_response_due_at AS "firstResponseDueAt",
      resolution_due_at AS "resolutionDueAt", resolved_at AS "resolvedAt",
      first_responded_at AS "firstRespondedAt", sla_paused_at AS "slaPausedAt",
      first_response_remaining_seconds AS "firstResponseRemainingSeconds",
      resolution_remaining_seconds AS "resolutionRemainingSeconds",
      version, last_message_at AS "lastMessageAt", last_inbound_at AS "lastInboundAt", metadata,
      created_at AS "createdAt", updated_at AS "updatedAt"`;

  const res = await client.query<ConversationRecord>(sql, values);

  if (!res.rows[0]) {
    throw new OptimisticConcurrencyError();
  }

  return res.rows[0];
}

export interface OutboundTemplateMetadata {
  name: string;
  language: string;
  versionId: string;
  variables: Record<string, string>;
  renderedPayloadHash: string;
}

export interface OutboundMediaMetadata {
  attachmentId: string;
  fileName: string;
  contentType: string;
  caption?: string | undefined;
}

export interface CreateOutboundMessageWithOutboxInput {
  organizationId: string;
  conversationId: string;
  senderUserId: string | null;
  senderType?: "agent" | "bot" | undefined;
  content: string;
  correlationId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  template?: OutboundTemplateMetadata | undefined;
  media?: OutboundMediaMetadata | undefined;
}

/**
 * Creates an outbound message and inserts a transactional outbox event (message.outbound.created).
 */
export async function createOutboundMessageWithOutbox(
  client: DbClient,
  input: CreateOutboundMessageWithOutboxInput
): Promise<MessageRecord> {
  const conversation = await getConversationById(
    client,
    input.organizationId,
    input.conversationId
  );
  if (!conversation) {
    throw new Error(`Conversation '${input.conversationId}' not found.`);
  }
  if (conversation.status === "closed") throw new ClosedConversationError();

  const message = await createMessage(client, {
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    channelId: conversation.channelId,
    direction: "outbound",
    senderType: input.senderType ?? "agent",
    senderUserId: input.senderUserId,
    content: input.content,
    status: "queued",
    metadata: {
      ...(input.metadata ?? {}),
      ...(input.template ? { template: input.template } : {}),
      ...(input.media ? { media: input.media } : {})
    }
  });

  const outboxPayload = {
    messageId: message.id,
    conversationId: input.conversationId,
    channelId: conversation.channelId,
    customerPhone: conversation.customerPhone,
    content: input.content,
    senderUserId: input.senderUserId,
    ...(input.template ? { template: input.template } : {}),
    ...(input.media ? { media: input.media } : {})
  };

  await client.query(
    `INSERT INTO flowdesk.outbox_events
       (organization_id, aggregate_type, aggregate_id, event_type, payload, correlation_id)
     VALUES ($1, 'message', $2, 'message.outbound.created', $3, $4)`,
    [input.organizationId, message.id, JSON.stringify(outboxPayload), input.correlationId ?? null]
  );

  try {
    await fanoutDeveloperWebhookEvents(client, {
      organizationId: input.organizationId,
      eventType: "message.sent",
      eventId: `evt_msg_${message.id}`,
      payload: {
        event: "message.sent",
        timestamp: new Date().toISOString(),
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        message: {
          id: message.id,
          channelId: conversation.channelId,
          direction: "outbound",
          senderType: input.senderType,
          senderUserId: input.senderUserId ?? null,
          content: input.content,
          createdAt: message.createdAt
        }
      }
    });
  } catch (fanoutErr) {
    if (process.env["NODE_ENV"] === "test" || process.env["NODE_ENV"] === "development") {
      console.warn("[WebhookFanout] Failed to fanout message.sent:", fanoutErr);
    }
  }

  return message;
}

export async function getOutboundMessageByBotRun(
  client: DbClient,
  organizationId: string,
  botRunId: string
): Promise<MessageRecord | null> {
  const result = await client.query<MessageRecord>(
    `SELECT
       id, organization_id AS "organizationId", conversation_id AS "conversationId",
       channel_id AS "channelId", direction, sender_type AS "senderType",
       sender_user_id AS "senderUserId", provider_message_id AS "providerMessageId",
       content, status, error_detail AS "errorDetail", metadata,
       sent_at AS "sentAt", delivered_at AS "deliveredAt", read_at AS "readAt",
       created_at AS "createdAt", updated_at AS "updatedAt"
     FROM flowdesk.messages
     WHERE organization_id = $1 AND direction = 'outbound'
       AND metadata->>'aiBotRunId' = $2
     ORDER BY created_at DESC LIMIT 1`,
    [organizationId, botRunId]
  );
  return result.rows[0] ?? null;
}

export interface ClaimedOutboxEvent<TPayload = Record<string, unknown>> {
  id: string;
  organizationId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: TPayload;
  correlationId: string | null;
  causationId: string | null;
  occurredAt: Date;
  attempts: number;
}

/**
 * Claims unpublished outbox events for a given event type.
 */
export async function claimUnpublishedOutboxEvents<TPayload = Record<string, unknown>>(
  client: DbClient,
  eventType: string,
  limit = 10
): Promise<ClaimedOutboxEvent<TPayload>[]> {
  const res = await client.query<{
    id: string;
    organization_id: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    payload: TPayload;
    correlation_id: string | null;
    causation_id: string | null;
    occurred_at: Date;
    attempts: number;
  }>(`SELECT * FROM flowdesk.claim_outbox_events($1::text, $2::integer)`, [eventType, limit]);

  return res.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    payload: row.payload,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    occurredAt: row.occurred_at,
    attempts: row.attempts
  }));
}

/**
 * Marks an outbox event as successfully published.
 */
export async function markOutboxEventPublished(client: DbClient, eventId: string): Promise<void> {
  await client.query(
    `UPDATE flowdesk.outbox_events
     SET published_at = clock_timestamp()
         , claimed_until = NULL
         , claim_token = NULL
     WHERE id = $1`,
    [eventId]
  );
}

/**
 * Records an execution attempt and error message on an outbox event.
 * If terminal is true, marks published_at to dead-letter the event.
 */
export async function recordOutboxEventFailure(
  client: DbClient,
  eventId: string,
  errorMessage: string,
  terminal = false
): Promise<void> {
  await client.query(
    `UPDATE flowdesk.outbox_events
     SET attempts = attempts + 1,
         last_error = $2,
         published_at = CASE WHEN $3 = true THEN clock_timestamp() ELSE published_at END,
         dead_lettered_at = CASE WHEN $3 = true THEN clock_timestamp() ELSE dead_lettered_at END,
         available_at = CASE WHEN $3 = true THEN available_at
           ELSE clock_timestamp() + make_interval(secs => LEAST(300, (2 ^ LEAST(attempts, 8))::integer)) END,
         claimed_until = NULL,
         claim_token = NULL
     WHERE id = $1`,
    [eventId, errorMessage, terminal]
  );
}

export interface ConversationWithMessagesRecord {
  conversation: ConversationRecord;
  messages: MessageRecord[];
}

export async function getConversationWithMessages(
  db: DbClient,
  context: TenantContext,
  conversationId: string
): Promise<ConversationWithMessagesRecord | null> {
  return runInTenantTransaction(db, context, async (tx) => {
    const conversation = await getConversationById(tx, context.organizationId, conversationId);
    if (!conversation) return null;

    const messages = await listMessagesByConversation(tx, context.organizationId, conversationId);
    return { conversation, messages };
  });
}
