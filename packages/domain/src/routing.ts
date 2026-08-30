/**
 * M5-01: Automated Conversation Routing Evaluator
 *
 * Provides condition matching and deterministic rule evaluation for incoming conversations.
 */

export interface RoutingCondition {
  channelId?: string | undefined;
  tag?: string | undefined;
  language?: string | undefined;
  intent?: string | undefined;
  customerPhonePrefix?: string | undefined;
  isWithinBusinessHours?: boolean | undefined;
}

export interface RoutingRule {
  id: string;
  organizationId: string;
  name: string;
  priority: number;
  conditions: RoutingCondition;
  targetQueueId: string | null;
  targetTeamId: string | null;
  targetUserId: string | null;
  isActive: boolean;
}

export interface RoutingEvaluationContext {
  channelId?: string;
  tags?: string[];
  language?: string;
  intent?: string;
  customerPhone?: string;
  isWithinBusinessHours?: boolean;
}

export interface RoutingResult {
  matchedRule: RoutingRule | null;
  targetQueueId: string | null;
  targetTeamId: string | null;
  targetUserId: string | null;
  reason: string;
}

/**
 * Checks whether a single routing rule condition matches the evaluation context.
 * An empty condition matches all contexts.
 */
export function matchesRoutingCondition(
  condition: RoutingCondition,
  context: RoutingEvaluationContext
): boolean {
  if (condition.channelId && context.channelId && condition.channelId !== context.channelId) {
    return false;
  }

  if (condition.tag && context.tags && !context.tags.includes(condition.tag)) {
    return false;
  }

  if (
    condition.language &&
    context.language &&
    condition.language.toLowerCase() !== context.language.toLowerCase()
  ) {
    return false;
  }

  if (
    condition.intent &&
    context.intent &&
    condition.intent.toLowerCase() !== context.intent.toLowerCase()
  ) {
    return false;
  }

  if (
    condition.customerPhonePrefix &&
    context.customerPhone &&
    !context.customerPhone.startsWith(condition.customerPhonePrefix)
  ) {
    return false;
  }

  if (
    condition.isWithinBusinessHours !== undefined &&
    context.isWithinBusinessHours !== undefined &&
    condition.isWithinBusinessHours !== context.isWithinBusinessHours
  ) {
    return false;
  }

  return true;
}

/**
 * Evaluates an ordered array of active routing rules against a conversation context.
 * Rules should be sorted by priority ascending (lower number = higher priority).
 */
export function evaluateRoutingRules(
  rules: RoutingRule[],
  context: RoutingEvaluationContext
): RoutingResult {
  const activeRules = rules.filter((r) => r.isActive).sort((a, b) => a.priority - b.priority);

  for (const rule of activeRules) {
    if (matchesRoutingCondition(rule.conditions, context)) {
      return {
        matchedRule: rule,
        targetQueueId: rule.targetQueueId,
        targetTeamId: rule.targetTeamId,
        targetUserId: rule.targetUserId,
        reason: `Matched routing rule '${rule.name}' (priority ${rule.priority})`
      };
    }
  }

  return {
    matchedRule: null,
    targetQueueId: null,
    targetTeamId: null,
    targetUserId: null,
    reason: "No active routing rule matched context; defaulted to default queue"
  };
}
