import { describe, it, expect } from "vitest";
import {
  matchesRoutingCondition,
  evaluateRoutingRules,
  type RoutingRule,
  type RoutingEvaluationContext
} from "./routing.js";

describe("Domain Routing Engine (M5-01)", () => {
  describe("matchesRoutingCondition", () => {
    it("returns true for empty condition", () => {
      const matched = matchesRoutingCondition({}, { channelId: "ch-1" });
      expect(matched).toBe(true);
    });

    it("matches channelId condition", () => {
      expect(matchesRoutingCondition({ channelId: "ch-1" }, { channelId: "ch-1" })).toBe(true);
      expect(matchesRoutingCondition({ channelId: "ch-1" }, { channelId: "ch-2" })).toBe(false);
    });

    it("matches tag condition in conversation tags", () => {
      expect(matchesRoutingCondition({ tag: "vip" }, { tags: ["vip", "billing"] })).toBe(true);
      expect(matchesRoutingCondition({ tag: "urgent" }, { tags: ["vip", "billing"] })).toBe(false);
    });

    it("matches language condition case-insensitively", () => {
      expect(matchesRoutingCondition({ language: "id" }, { language: "ID" })).toBe(true);
      expect(matchesRoutingCondition({ language: "id" }, { language: "en" })).toBe(false);
    });

    it("matches customer phone prefix condition", () => {
      expect(
        matchesRoutingCondition({ customerPhonePrefix: "+62" }, { customerPhone: "+6281234567890" })
      ).toBe(true);
      expect(
        matchesRoutingCondition({ customerPhonePrefix: "+1" }, { customerPhone: "+6281234567890" })
      ).toBe(false);
    });

    it("matches business hours condition", () => {
      expect(
        matchesRoutingCondition({ isWithinBusinessHours: true }, { isWithinBusinessHours: true })
      ).toBe(true);
      expect(
        matchesRoutingCondition({ isWithinBusinessHours: true }, { isWithinBusinessHours: false })
      ).toBe(false);
    });
  });

  describe("evaluateRoutingRules", () => {
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

    it("evaluates rules by priority order and ignores inactive rules", () => {
      const context: RoutingEvaluationContext = {
        channelId: "ch-wa",
        tags: ["vip"],
        language: "id"
      };

      const result = evaluateRoutingRules(rules, context);
      expect(result.matchedRule?.id).toBe("rule-1");
      expect(result.targetQueueId).toBe("queue-vip");
      expect(result.targetTeamId).toBe("team-vip");
    });

    it("falls through to lower priority rule when higher priority does not match", () => {
      const context: RoutingEvaluationContext = {
        channelId: "ch-wa",
        tags: ["regular"],
        language: "en"
      };

      const result = evaluateRoutingRules(rules, context);
      expect(result.matchedRule?.id).toBe("rule-2");
      expect(result.targetQueueId).toBe("queue-wa");
    });

    it("returns null matchedRule when no rules match", () => {
      const context: RoutingEvaluationContext = {
        channelId: "ch-other",
        tags: ["regular"]
      };

      const result = evaluateRoutingRules(rules, context);
      expect(result.matchedRule).toBeNull();
      expect(result.targetQueueId).toBeNull();
      expect(result.reason).toContain("defaulted to default queue");
    });
  });
});
