export type ConversationStatus = "new" | "open" | "pending" | "resolved" | "closed";
export type ConversationPriority = "low" | "medium" | "high" | "urgent";
export type MessageStatus = "queued" | "sent" | "delivered" | "read" | "failed";
export type MessageDirection = "inbound" | "outbound";
export type MessageSenderType = "customer" | "agent" | "system" | "bot";

const VALID_CONVERSATION_TRANSITIONS: Record<ConversationStatus, readonly ConversationStatus[]> = {
  new: ["open", "closed"],
  open: ["pending", "resolved", "closed"],
  pending: ["open", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: ["open"]
};

const VALID_MESSAGE_STATUS_TRANSITIONS: Record<MessageStatus, readonly MessageStatus[]> = {
  queued: ["sent", "failed"],
  sent: ["delivered", "read", "failed"],
  delivered: ["read", "failed"],
  read: [],
  failed: ["queued"]
};

export function canTransitionConversationStatus(
  current: ConversationStatus,
  target: ConversationStatus
): boolean {
  if (current === target) return true;
  return VALID_CONVERSATION_TRANSITIONS[current]?.includes(target) ?? false;
}

export function assertValidConversationStatusTransition(
  current: ConversationStatus,
  target: ConversationStatus
): void {
  if (!canTransitionConversationStatus(current, target)) {
    throw new Error(`Invalid conversation status transition from '${current}' to '${target}'.`);
  }
}

export function canTransitionMessageStatus(current: MessageStatus, target: MessageStatus): boolean {
  if (current === target) return true;
  return VALID_MESSAGE_STATUS_TRANSITIONS[current]?.includes(target) ?? false;
}

export function assertValidMessageStatusTransition(
  current: MessageStatus,
  target: MessageStatus
): void {
  if (!canTransitionMessageStatus(current, target)) {
    throw new Error(`Invalid message status transition from '${current}' to '${target}'.`);
  }
}
