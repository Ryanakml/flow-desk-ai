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
export {
  calculateBusinessDeadline,
  type BusinessHoursInterval,
  type BusinessHoursSchedule,
  type BusinessHoursPolicy
} from "./sla.js";
export {
  calculateServiceWindow,
  isWithinServiceWindow,
  SERVICE_WINDOW_DURATION_MS,
  type ServiceWindowEvaluation
} from "./service-window.js";
export {
  extractTemplateVariables,
  validateTemplateComponents,
  validateTemplateVariables,
  renderTemplateText,
  renderTemplate,
  computeTemplatePayloadHash,
  isTemplateApprovedForSending,
  type ComponentValidationResult,
  type TemplateVariableValidationResult,
  type RenderTemplateResult
} from "./templates.js";
export {
  detectMimeType,
  getMediaSizeLimit,
  validateMediaAttachment,
  ALLOWED_MIME_TYPES,
  MEDIA_SIZE_LIMITS,
  type MediaValidationResult
} from "./media.js";
export {
  buildCitations,
  formatKnowledgeContext,
  assemblePromptContext,
  type Citation,
  type RagRetrievalResult,
  type ConversationMessageContext,
  type AssembledPromptContext,
  type FormatPromptParams
} from "./rag.js";
export {
  matchesRoutingCondition,
  evaluateConditionDetailed,
  evaluateRoutingRules,
  detectPolicyConflicts,
  simulatePolicyEvaluation,
  type RoutingCondition,
  type RoutingRule,
  type RoutingEvaluationContext,
  type RoutingResult,
  type RuleEvaluationTrace,
  type ConditionEvaluationDetail,
  type PolicyConflict,
  type ConditionMatchResult
} from "./routing.js";
export * from "./auto-send.js";
export * from "./production-release.js";
