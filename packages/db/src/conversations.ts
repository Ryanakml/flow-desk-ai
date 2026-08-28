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

export class OptimisticConcurrencyError extends Error {
  constructor(message = "Resource version conflict; please reload and retry.") {
    super(message);
    this.name = "OptimisticConcurrencyError";
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
  version: number;
  lastMessageAt: Date;
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
       version, last_message_at AS "lastMessageAt", metadata,
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
       version, last_message_at AS "lastMessageAt", metadata,
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      input.organizationId,
      input.channelId,
      input.customerPhone,
      input.customerName ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );

  return insertRes.rows[0]!;
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
       version, last_message_at AS "lastMessageAt", metadata,
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
       version, last_message_at AS "lastMessageAt", metadata,
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
       version, last_message_at AS "lastMessageAt", metadata,
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

  // Update conversation last_message_at; reopen if inbound customer reply on closed/resolved
  if (input.direction === "inbound") {
    await client.query(
      `UPDATE flowdesk.conversations
       SET last_message_at = clock_timestamp(),
           status = CASE WHEN status IN ('resolved', 'closed') THEN 'open' ELSE status END,
           updated_at = clock_timestamp()
       WHERE id = $1 AND organization_id = $2`,
      [input.conversationId, input.organizationId]
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
  extra?: { deliveredAt?: Date; readAt?: Date; errorDetail?: string }
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
         delivered_at = COALESCE($3, delivered_at),
         read_at = COALESCE($4, read_at),
         error_detail = COALESCE($5, error_detail),
         updated_at = clock_timestamp()
     WHERE id = $2 AND organization_id = $6
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
      extra?.deliveredAt ?? null,
      extra?.readAt ?? null,
      extra?.errorDetail ?? null,
      organizationId
    ]
  );

  return updateRes.rows[0]!;
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
