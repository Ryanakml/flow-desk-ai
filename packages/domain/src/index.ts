export interface TenantContext {
  organizationId: string;
  actorId: string;
  correlationId: string;
}

export function requireTenantContext(context: Partial<TenantContext>): TenantContext {
  if (!context.organizationId || !context.actorId || !context.correlationId) {
    throw new Error("Complete tenant context is required");
  }
  return context as TenantContext;
}

export {
  type Permission,
  type RoleKey,
  STANDARD_ROLES,
  getPermissionsForRole,
  hasPermission,
  isStandardRole
} from "./permissions.js";
export {
  type ChannelStatus,
  type ChannelType,
  type ChannelCredentials,
  canTransitionChannelStatus,
  assertValidChannelStatusTransition
} from "./channels.js";
export {
  type ConversationStatus,
  type ConversationPriority,
  type MessageStatus,
  type MessageDirection,
  type MessageSenderType,
  canTransitionConversationStatus,
  assertValidConversationStatusTransition,
  canTransitionMessageStatus,
  assertValidMessageStatusTransition
} from "./conversations.js";
