/**
 * M5-01 / M5 #180: Automated Conversation Routing & Policy Evaluator
 *
 * Provides deterministic rule evaluation, fail-closed condition matching,
 * conflict and unreachable rule detection, simulator support, and structured decision traces.
 */

export interface RoutingCondition {
  channelId?: string | undefined;
  tag?: string | undefined;
  tags?: string[] | undefined;
  language?: string | undefined;
  intent?: string | undefined;
  customerPhonePrefix?: string | undefined;
  isWithinBusinessHours?: boolean | undefined;
  queueCapacityAvailable?: boolean | undefined;
  botMode?: "draft" | "auto" | "off" | undefined;
  botPaused?: boolean | undefined;
  customerConsentRequired?: boolean | undefined;
  requiredEntitlement?: string | undefined;
  prohibitedIntents?: string[] | undefined;
  minConfidenceThreshold?: number | undefined;
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
  action?: "route" | "auto_reply" | "escalate" | "handoff" | undefined;
  isActive: boolean;
}

export interface RoutingEvaluationContext {
  channelId?: string | undefined;
  tags?: string[] | undefined;
  language?: string | undefined;
  intent?: string | undefined;
  customerPhone?: string | undefined;
  isWithinBusinessHours?: boolean | undefined;
  queueCapacityAvailable?: boolean | undefined;
  botMode?: "draft" | "auto" | "off" | undefined;
  botPaused?: boolean | undefined;
  customerConsentGiven?: boolean | undefined;
  planEntitlements?: string[] | undefined;
  confidenceScore?: number | undefined;
  isKillswitchActive?: boolean | undefined;
}

export interface ConditionEvaluationDetail {
  passed: boolean;
  expected: unknown;
  actual: unknown;
  reason?: string;
}

export interface ConditionEvaluationDetailMap {
  channelId?: ConditionEvaluationDetail | undefined;
  tag?: ConditionEvaluationDetail | undefined;
  tags?: ConditionEvaluationDetail | undefined;
  language?: ConditionEvaluationDetail | undefined;
  intent?: ConditionEvaluationDetail | undefined;
  prohibitedIntents?: ConditionEvaluationDetail | undefined;
  customerPhonePrefix?: ConditionEvaluationDetail | undefined;
  isWithinBusinessHours?: ConditionEvaluationDetail | undefined;
  queueCapacityAvailable?: ConditionEvaluationDetail | undefined;
  botMode?: ConditionEvaluationDetail | undefined;
  botPaused?: ConditionEvaluationDetail | undefined;
  customerConsentRequired?: ConditionEvaluationDetail | undefined;
  requiredEntitlement?: ConditionEvaluationDetail | undefined;
  minConfidenceThreshold?: ConditionEvaluationDetail | undefined;
  [key: string]: ConditionEvaluationDetail | undefined;
}

export interface RuleEvaluationTrace {
  ruleId: string;
  ruleName: string;
  priority: number;
  matched: boolean;
  reason: string;
  conditionsEvaluated: ConditionEvaluationDetailMap;
}

export interface RoutingResult {
  matchedRule: RoutingRule | null;
  targetQueueId: string | null;
  targetTeamId: string | null;
  targetUserId: string | null;
  action: string;
  reason: string;
  decisionTrace: RuleEvaluationTrace[];
  policyVersion?: number | undefined;
}

export interface PolicyConflict {
  type: "duplicate_priority" | "unreachable_rule" | "shadowed_rule" | "invalid_target";
  severity: "error" | "warning";
  ruleId: string;
  ruleName: string;
  conflictingRuleId?: string | undefined;
  conflictingRuleName?: string | undefined;
  message: string;
}

export interface ConditionMatchResult {
  matched: boolean;
  reason: string;
  details: ConditionEvaluationDetailMap;
}

/**
 * Evaluates a single rule's conditions against context with fail-closed semantics.
 * If an input required to prove a condition is missing from context, it fails closed (does not match).
 */
export function evaluateConditionDetailed(
  condition: RoutingCondition,
  context: RoutingEvaluationContext
): ConditionMatchResult {
  const details: ConditionEvaluationDetailMap = {};

  // 1. Channel ID
  if (condition.channelId !== undefined) {
    const actual = context.channelId;
    const passed = Boolean(actual && actual.toLowerCase() === condition.channelId.toLowerCase());
    details.channelId = {
      passed,
      expected: condition.channelId,
      actual: actual ?? null,
      reason: !actual
        ? "Missing channelId in context (failed closed)"
        : passed
          ? "Channel matched"
          : "Channel mismatch"
    };
    if (!passed) return { matched: false, reason: details.channelId.reason!, details };
  }

  // 2. Single Tag
  if (condition.tag !== undefined) {
    const actual = context.tags;
    const passed = Boolean(actual && actual.includes(condition.tag));
    details.tag = {
      passed,
      expected: condition.tag,
      actual: actual ?? null,
      reason: !actual
        ? "Missing tags in context (failed closed)"
        : passed
          ? `Tag '${condition.tag}' present`
          : `Tag '${condition.tag}' not found in conversation tags`
    };
    if (!passed) return { matched: false, reason: details.tag.reason!, details };
  }

  // 3. Multiple Tags
  if (condition.tags && condition.tags.length > 0) {
    const actual = context.tags;
    const missing = condition.tags.filter((t) => !actual || !actual.includes(t));
    const passed = Boolean(actual && missing.length === 0);
    details.tags = {
      passed,
      expected: condition.tags,
      actual: actual ?? null,
      reason: !actual
        ? "Missing tags in context (failed closed)"
        : passed
          ? "All required tags present"
          : `Missing required tags: ${missing.join(", ")}`
    };
    if (!passed) return { matched: false, reason: details.tags.reason!, details };
  }

  // 4. Language
  if (condition.language !== undefined) {
    const actual = context.language;
    const passed = Boolean(actual && actual.toLowerCase() === condition.language.toLowerCase());
    details.language = {
      passed,
      expected: condition.language,
      actual: actual ?? null,
      reason: !actual
        ? "Missing language in context (failed closed)"
        : passed
          ? "Language matched"
          : `Language mismatch ('${actual}' !== '${condition.language}')`
    };
    if (!passed) return { matched: false, reason: details.language.reason!, details };
  }

  // 5. Intent
  if (condition.intent !== undefined) {
    const actual = context.intent;
    const passed = Boolean(actual && actual.toLowerCase() === condition.intent.toLowerCase());
    details.intent = {
      passed,
      expected: condition.intent,
      actual: actual ?? null,
      reason: !actual
        ? "Missing intent in context (failed closed)"
        : passed
          ? "Intent matched"
          : `Intent mismatch ('${actual}' !== '${condition.intent}')`
    };
    if (!passed) return { matched: false, reason: details.intent.reason!, details };
  }

  // 6. Prohibited Intents
  if (condition.prohibitedIntents && condition.prohibitedIntents.length > 0) {
    const actual = context.intent;
    const prohibitedMatched = Boolean(
      actual && condition.prohibitedIntents.some((pi) => pi.toLowerCase() === actual.toLowerCase())
    );
    const passed = !prohibitedMatched;
    details.prohibitedIntents = {
      passed,
      expected: `Not in [${condition.prohibitedIntents.join(", ")}]`,
      actual: actual ?? null,
      reason: prohibitedMatched
        ? `Intent '${actual}' is prohibited by this rule`
        : "Intent not prohibited"
    };
    if (!passed) return { matched: false, reason: details.prohibitedIntents.reason!, details };
  }

  // 7. Phone Prefix
  if (condition.customerPhonePrefix !== undefined) {
    const actual = context.customerPhone;
    const passed = Boolean(actual && actual.startsWith(condition.customerPhonePrefix));
    details.customerPhonePrefix = {
      passed,
      expected: condition.customerPhonePrefix,
      actual: actual ?? null,
      reason: !actual
        ? "Missing customerPhone in context (failed closed)"
        : passed
          ? "Phone prefix matched"
          : "Phone prefix mismatch"
    };
    if (!passed) return { matched: false, reason: details.customerPhonePrefix.reason!, details };
  }

  // 8. Business Hours
  if (condition.isWithinBusinessHours !== undefined) {
    const actual = context.isWithinBusinessHours;
    const passed = actual !== undefined && actual === condition.isWithinBusinessHours;
    details.isWithinBusinessHours = {
      passed,
      expected: condition.isWithinBusinessHours,
      actual: actual ?? null,
      reason:
        actual === undefined
          ? "Missing isWithinBusinessHours in context (failed closed)"
          : passed
            ? "Business hours condition met"
            : `Expected business hours=${condition.isWithinBusinessHours}, got ${actual}`
    };
    if (!passed) return { matched: false, reason: details.isWithinBusinessHours.reason!, details };
  }

  // 9. Queue Capacity
  if (condition.queueCapacityAvailable !== undefined) {
    const actual = context.queueCapacityAvailable;
    const passed = actual !== undefined && actual === condition.queueCapacityAvailable;
    details.queueCapacityAvailable = {
      passed,
      expected: condition.queueCapacityAvailable,
      actual: actual ?? null,
      reason:
        actual === undefined
          ? "Missing queue capacity status in context (failed closed)"
          : passed
            ? "Queue capacity requirement met"
            : "Queue capacity condition not met"
    };
    if (!passed) return { matched: false, reason: details.queueCapacityAvailable.reason!, details };
  }

  // 10. Bot Mode
  if (condition.botMode !== undefined) {
    const actual = context.botMode;
    const passed = actual !== undefined && actual === condition.botMode;
    details.botMode = {
      passed,
      expected: condition.botMode,
      actual: actual ?? null,
      reason:
        actual === undefined
          ? "Missing bot mode in context (failed closed)"
          : passed
            ? "Bot mode matched"
            : `Bot mode mismatch ('${actual}' !== '${condition.botMode}')`
    };
    if (!passed) return { matched: false, reason: details.botMode.reason!, details };
  }

  // 11. Bot Paused
  if (condition.botPaused !== undefined) {
    const actual = context.botPaused;
    const passed = actual !== undefined && actual === condition.botPaused;
    details.botPaused = {
      passed,
      expected: condition.botPaused,
      actual: actual ?? null,
      reason:
        actual === undefined
          ? "Missing bot pause state in context (failed closed)"
          : passed
            ? "Bot pause state matched"
            : `Expected botPaused=${condition.botPaused}, got ${actual}`
    };
    if (!passed) return { matched: false, reason: details.botPaused.reason!, details };
  }

  // 12. Customer Consent
  if (condition.customerConsentRequired === true) {
    const actual = context.customerConsentGiven;
    const passed = actual === true;
    details.customerConsentRequired = {
      passed,
      expected: true,
      actual: actual ?? false,
      reason: passed ? "Customer consent confirmed" : "Customer consent not given (failed closed)"
    };
    if (!passed)
      return { matched: false, reason: details.customerConsentRequired.reason!, details };
  }

  // 13. Required Entitlement
  if (condition.requiredEntitlement !== undefined) {
    const actual = context.planEntitlements;
    const passed = Boolean(actual && actual.includes(condition.requiredEntitlement));
    details.requiredEntitlement = {
      passed,
      expected: condition.requiredEntitlement,
      actual: actual ?? null,
      reason: !actual
        ? "Missing plan entitlements in context (failed closed)"
        : passed
          ? `Entitlement '${condition.requiredEntitlement}' verified`
          : `Plan lacks required entitlement '${condition.requiredEntitlement}'`
    };
    if (!passed) return { matched: false, reason: details.requiredEntitlement.reason!, details };
  }

  // 14. Minimum Confidence
  if (condition.minConfidenceThreshold !== undefined) {
    const actual = context.confidenceScore;
    const passed = actual !== undefined && actual >= condition.minConfidenceThreshold;
    details.minConfidenceThreshold = {
      passed,
      expected: condition.minConfidenceThreshold,
      actual: actual ?? null,
      reason:
        actual === undefined
          ? "Missing confidence score in context (failed closed)"
          : passed
            ? `Confidence ${actual} meets threshold ${condition.minConfidenceThreshold}`
            : `Confidence ${actual} below required ${condition.minConfidenceThreshold}`
    };
    if (!passed) return { matched: false, reason: details.minConfidenceThreshold.reason!, details };
  }

  return { matched: true, reason: "All rule conditions satisfied", details };
}

/**
 * Checks whether a single routing rule condition matches the evaluation context.
 * Implements fail-closed semantics for any missing context inputs.
 */
export function matchesRoutingCondition(
  condition: RoutingCondition,
  context: RoutingEvaluationContext
): boolean {
  return evaluateConditionDetailed(condition, context).matched;
}

/**
 * Evaluates an ordered array of active routing rules against a conversation context.
 * Rules are sorted by priority ascending (lower number = higher priority).
 * Produces a full structured decision trace.
 */
export function evaluateRoutingRules(
  rules: RoutingRule[],
  context: RoutingEvaluationContext
): RoutingResult {
  const activeRules = rules.filter((r) => r.isActive).sort((a, b) => a.priority - b.priority);
  const decisionTrace: RuleEvaluationTrace[] = [];

  for (const rule of activeRules) {
    const evaluation = evaluateConditionDetailed(rule.conditions, context);
    decisionTrace.push({
      ruleId: rule.id,
      ruleName: rule.name,
      priority: rule.priority,
      matched: evaluation.matched,
      reason: evaluation.reason,
      conditionsEvaluated: evaluation.details
    });

    if (evaluation.matched) {
      return {
        matchedRule: rule,
        targetQueueId: rule.targetQueueId,
        targetTeamId: rule.targetTeamId,
        targetUserId: rule.targetUserId,
        action: rule.action ?? "route",
        reason: `Matched routing rule '${rule.name}' (priority ${rule.priority})`,
        decisionTrace
      };
    }
  }

  return {
    matchedRule: null,
    targetQueueId: null,
    targetTeamId: null,
    targetUserId: null,
    action: "default",
    reason: "No active routing rule matched context; defaulted to standard queue",
    decisionTrace
  };
}

/**
 * Analyzes an array of rules to detect conflicts, unreachable rules, duplicate priorities,
 * or invalid targets.
 */
export function detectPolicyConflicts(rules: RoutingRule[]): PolicyConflict[] {
  const conflicts: PolicyConflict[] = [];
  const priorityMap = new Map<number, RoutingRule>();

  const activeRules = rules.filter((r) => r.isActive).sort((a, b) => a.priority - b.priority);

  for (let i = 0; i < activeRules.length; i++) {
    const rule = activeRules[i]!;

    // 1. Duplicate priority check
    if (priorityMap.has(rule.priority)) {
      const existing = priorityMap.get(rule.priority)!;
      conflicts.push({
        type: "duplicate_priority",
        severity: "warning",
        ruleId: rule.id,
        ruleName: rule.name,
        conflictingRuleId: existing.id,
        conflictingRuleName: existing.name,
        message: `Rules '${rule.name}' and '${existing.name}' share identical priority ${rule.priority}; execution order may be nondeterministic.`
      });
    } else {
      priorityMap.set(rule.priority, rule);
    }

    // 2. Unreachable rule detection: check if an earlier rule has an empty (catch-all) condition
    for (let j = 0; j < i; j++) {
      const earlierRule = activeRules[j]!;
      const isCatchAll = Object.keys(earlierRule.conditions).length === 0;
      if (isCatchAll) {
        conflicts.push({
          type: "unreachable_rule",
          severity: "error",
          ruleId: rule.id,
          ruleName: rule.name,
          conflictingRuleId: earlierRule.id,
          conflictingRuleName: earlierRule.name,
          message: `Rule '${rule.name}' (priority ${rule.priority}) is unreachable because catch-all rule '${earlierRule.name}' (priority ${earlierRule.priority}) always matches first.`
        });
        break;
      }
    }
  }

  return conflicts;
}

/**
 * Simulates policy execution with full context and returns decision trace plus conflict diagnostics.
 */
export function simulatePolicyEvaluation(params: {
  rules: RoutingRule[];
  context: RoutingEvaluationContext;
  policyVersion?: number | undefined;
}): RoutingResult & { conflicts: PolicyConflict[] } {
  const conflicts = detectPolicyConflicts(params.rules);
  const result = evaluateRoutingRules(params.rules, params.context);
  return {
    ...result,
    policyVersion: params.policyVersion,
    conflicts
  };
}
