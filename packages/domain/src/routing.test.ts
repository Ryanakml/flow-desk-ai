import { describe, it, expect } from "vitest";
import {
  matchesRoutingCondition,
  evaluateRoutingRules,
  detectPolicyConflicts,
  simulatePolicyEvaluation,
  type RoutingRule,
  type RoutingEvaluationContext
} from "./routing.js";

describe("Domain Routing & Policy Engine (M5-01 / #180)", () => {
  describe("matchesRoutingCondition - Fail-Closed Semantics", () => {
    it("returns true for empty condition (catch-all)", () => {
      const matched = matchesRoutingCondition({}, { channelId: "ch-1" });
      expect(matched).toBe(true);
    });

    it("matches channelId condition and fails closed when missing", () => {
      expect(matchesRoutingCondition({ channelId: "ch-1" }, { channelId: "ch-1" })).toBe(true);
      expect(matchesRoutingCondition({ channelId: "ch-1" }, { channelId: "ch-2" })).toBe(false);
      // Fail closed when context.channelId is missing
      expect(matchesRoutingCondition({ channelId: "ch-1" }, {})).toBe(false);
    });

    it("matches tag condition and fails closed when tags missing", () => {
      expect(matchesRoutingCondition({ tag: "vip" }, { tags: ["vip", "billing"] })).toBe(true);
      expect(matchesRoutingCondition({ tag: "urgent" }, { tags: ["vip", "billing"] })).toBe(false);
      expect(matchesRoutingCondition({ tag: "vip" }, {})).toBe(false);
    });

    it("matches tags array condition and fails closed when missing any", () => {
      expect(
        matchesRoutingCondition({ tags: ["vip", "urgent"] }, { tags: ["vip", "urgent", "extra"] })
      ).toBe(true);
      expect(matchesRoutingCondition({ tags: ["vip", "urgent"] }, { tags: ["vip"] })).toBe(false);
      expect(matchesRoutingCondition({ tags: ["vip"] }, {})).toBe(false);
    });

    it("matches language condition case-insensitively and fails closed when missing", () => {
      expect(matchesRoutingCondition({ language: "id" }, { language: "ID" })).toBe(true);
      expect(matchesRoutingCondition({ language: "id" }, { language: "en" })).toBe(false);
      expect(matchesRoutingCondition({ language: "id" }, {})).toBe(false);
    });

    it("matches intent condition case-insensitively and fails closed when missing", () => {
      expect(matchesRoutingCondition({ intent: "billing" }, { intent: "Billing" })).toBe(true);
      expect(matchesRoutingCondition({ intent: "billing" }, { intent: "support" })).toBe(false);
      expect(matchesRoutingCondition({ intent: "billing" }, {})).toBe(false);
    });

    it("fails match when intent is in prohibitedIntents", () => {
      expect(
        matchesRoutingCondition(
          { prohibitedIntents: ["emergency", "legal"] },
          { intent: "general" }
        )
      ).toBe(true);
      expect(
        matchesRoutingCondition(
          { prohibitedIntents: ["emergency", "legal"] },
          { intent: "emergency" }
        )
      ).toBe(false);
    });

    it("matches customer phone prefix condition and fails closed when missing", () => {
      expect(
        matchesRoutingCondition({ customerPhonePrefix: "+62" }, { customerPhone: "+6281234567890" })
      ).toBe(true);
      expect(
        matchesRoutingCondition({ customerPhonePrefix: "+1" }, { customerPhone: "+6281234567890" })
      ).toBe(false);
      expect(matchesRoutingCondition({ customerPhonePrefix: "+62" }, {})).toBe(false);
    });

    it("matches business hours condition and fails closed when missing", () => {
      expect(
        matchesRoutingCondition({ isWithinBusinessHours: true }, { isWithinBusinessHours: true })
      ).toBe(true);
      expect(
        matchesRoutingCondition({ isWithinBusinessHours: true }, { isWithinBusinessHours: false })
      ).toBe(false);
      expect(matchesRoutingCondition({ isWithinBusinessHours: true }, {})).toBe(false);
    });

    it("matches queueCapacityAvailable and fails closed when missing", () => {
      expect(
        matchesRoutingCondition({ queueCapacityAvailable: true }, { queueCapacityAvailable: true })
      ).toBe(true);
      expect(
        matchesRoutingCondition({ queueCapacityAvailable: true }, { queueCapacityAvailable: false })
      ).toBe(false);
      expect(matchesRoutingCondition({ queueCapacityAvailable: true }, {})).toBe(false);
    });

    it("matches customerConsentRequired and fails closed when consent is missing or false", () => {
      expect(
        matchesRoutingCondition({ customerConsentRequired: true }, { customerConsentGiven: true })
      ).toBe(true);
      expect(
        matchesRoutingCondition({ customerConsentRequired: true }, { customerConsentGiven: false })
      ).toBe(false);
      expect(matchesRoutingCondition({ customerConsentRequired: true }, {})).toBe(false);
    });

    it("matches requiredEntitlement and fails closed when missing", () => {
      expect(
        matchesRoutingCondition(
          { requiredEntitlement: "auto_send" },
          { planEntitlements: ["auto_send", "custom_bots"] }
        )
      ).toBe(true);
      expect(
        matchesRoutingCondition(
          { requiredEntitlement: "auto_send" },
          { planEntitlements: ["basic"] }
        )
      ).toBe(false);
      expect(matchesRoutingCondition({ requiredEntitlement: "auto_send" }, {})).toBe(false);
    });

    it("matches minConfidenceThreshold and fails closed when score is below or missing", () => {
      expect(
        matchesRoutingCondition({ minConfidenceThreshold: 0.85 }, { confidenceScore: 0.9 })
      ).toBe(true);
      expect(
        matchesRoutingCondition({ minConfidenceThreshold: 0.85 }, { confidenceScore: 0.8 })
      ).toBe(false);
      expect(matchesRoutingCondition({ minConfidenceThreshold: 0.85 }, {})).toBe(false);
    });
  });

  describe("evaluateRoutingRules & Decision Traces", () => {
    const rules: RoutingRule[] = [
      {
        id: "rule-1",
        organizationId: "org-1",
        name: "VIP Indonesian Routing",
        priority: 10,
        conditions: { tag: "vip", language: "id" },
        targetQueueId: "queue-vip",
        targetTeamId: "team-vip",
        targetUserId: null,
        isActive: true
      },
      {
        id: "rule-2",
        organizationId: "org-1",
        name: "Default WhatsApp Channel Routing",
        priority: 50,
        conditions: { channelId: "ch-wa" },
        targetQueueId: "queue-wa",
        targetTeamId: null,
        targetUserId: null,
        isActive: true
      },
      {
        id: "rule-inactive",
        organizationId: "org-1",
        name: "High Priority Inactive Rule",
        priority: 1,
        conditions: {},
        targetQueueId: "queue-inactive",
        targetTeamId: null,
        targetUserId: null,
        isActive: false
      }
    ];

    it("evaluates rules by priority order, ignores inactive rules, and provides structured trace", () => {
      const context: RoutingEvaluationContext = {
        channelId: "ch-wa",
        tags: ["vip"],
        language: "id"
      };

      const result = evaluateRoutingRules(rules, context);
      expect(result.matchedRule?.id).toBe("rule-1");
      expect(result.targetQueueId).toBe("queue-vip");
      expect(result.targetTeamId).toBe("team-vip");
      expect(result.decisionTrace).toHaveLength(1);
      expect(result.decisionTrace[0]?.matched).toBe(true);
      expect(result.decisionTrace[0]?.conditionsEvaluated.tag?.passed).toBe(true);
      expect(result.decisionTrace[0]?.conditionsEvaluated.language?.passed).toBe(true);
    });

    it("falls through to lower priority rule when higher priority condition fails", () => {
      const context: RoutingEvaluationContext = {
        channelId: "ch-wa",
        tags: ["regular"],
        language: "en"
      };

      const result = evaluateRoutingRules(rules, context);
      expect(result.matchedRule?.id).toBe("rule-2");
      expect(result.targetQueueId).toBe("queue-wa");
      expect(result.decisionTrace).toHaveLength(2);
      expect(result.decisionTrace[0]?.matched).toBe(false);
      expect(result.decisionTrace[1]?.matched).toBe(true);
    });

    it("returns default queue when no rules match with complete decision trace", () => {
      const context: RoutingEvaluationContext = {
        channelId: "ch-other",
        language: "de"
      };

      const result = evaluateRoutingRules(rules, context);
      expect(result.matchedRule).toBeNull();
      expect(result.targetQueueId).toBeNull();
      expect(result.action).toBe("default");
      expect(result.decisionTrace).toHaveLength(2);
      expect(result.decisionTrace.every((t) => !t.matched)).toBe(true);
    });
  });

  describe("detectPolicyConflicts", () => {
    it("detects duplicate priorities between active rules", () => {
      const rules: RoutingRule[] = [
        {
          id: "r1",
          organizationId: "org-1",
          name: "Rule Alpha",
          priority: 10,
          conditions: { tag: "alpha" },
          targetQueueId: "q1",
          targetTeamId: null,
          targetUserId: null,
          isActive: true
        },
        {
          id: "r2",
          organizationId: "org-1",
          name: "Rule Beta",
          priority: 10,
          conditions: { tag: "beta" },
          targetQueueId: "q2",
          targetTeamId: null,
          targetUserId: null,
          isActive: true
        }
      ];

      const conflicts = detectPolicyConflicts(rules);
      expect(conflicts.some((c) => c.type === "duplicate_priority")).toBe(true);
    });

    it("detects unreachable rules shadowed by earlier catch-all rule", () => {
      const rules: RoutingRule[] = [
        {
          id: "r-catch-all",
          organizationId: "org-1",
          name: "Catch-All Rule",
          priority: 10,
          conditions: {},
          targetQueueId: "q-all",
          targetTeamId: null,
          targetUserId: null,
          isActive: true
        },
        {
          id: "r-shadowed",
          organizationId: "org-1",
          name: "Shadowed Rule",
          priority: 20,
          conditions: { tag: "specific" },
          targetQueueId: "q-spec",
          targetTeamId: null,
          targetUserId: null,
          isActive: true
        }
      ];

      const conflicts = detectPolicyConflicts(rules);
      expect(conflicts.some((c) => c.type === "unreachable_rule")).toBe(true);
    });
  });

  describe("simulatePolicyEvaluation", () => {
    it("produces identical evaluation result to runtime with attached conflict analysis", () => {
      const rules: RoutingRule[] = [
        {
          id: "r1",
          organizationId: "org-1",
          name: "Support VIP",
          priority: 10,
          conditions: { tag: "vip", intent: "support" },
          targetQueueId: "q-vip-support",
          targetTeamId: null,
          targetUserId: null,
          action: "route",
          isActive: true
        }
      ];

      const context = { tags: ["vip"], intent: "support" };
      const simulated = simulatePolicyEvaluation({ rules, context, policyVersion: 2 });
      const evaluated = evaluateRoutingRules(rules, context);

      expect(simulated.matchedRule?.id).toBe(evaluated.matchedRule?.id);
      expect(simulated.targetQueueId).toBe(evaluated.targetQueueId);
      expect(simulated.action).toBe(evaluated.action);
      expect(simulated.decisionTrace).toEqual(evaluated.decisionTrace);
      expect(simulated.policyVersion).toBe(2);
      expect(simulated.conflicts).toEqual([]);
    });
  });
});
