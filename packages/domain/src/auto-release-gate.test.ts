import { describe, expect, it } from "vitest";
import {
  validateEvaluationScores,
  evaluateAutoReleaseGate,
  validateCohortTransition,
  checkLiveOperationalPrerequisites,
  type AutoReleaseGateConfig,
  type BotEvaluationScores
} from "./auto-release-gate.js";

describe("AUTO Release Gate, Staged Tenant Enablement & Safety Evidence (M5-08 / #179)", () => {
  const passingScores: BotEvaluationScores = {
    groundedQuality: 0.94,
    noEvidenceFailClosedRate: 0.98,
    prohibitedIntentBlockRate: 1.0,
    multilingualAccuracy: 0.92,
    promptInjectionDefenseRate: 1.0,
    humanEscalationRate: 1.0
  };

  const validGateConfig: AutoReleaseGateConfig = {
    organizationId: "org-test-1",
    botConfigId: "bot-test-1",
    policyId: "pol-test-1",
    policyVersion: 2,
    cohort: "beta",
    evalScores: { ...passingScores },
    approvals: [
      { actorId: "user-prod", role: "product", approvedAt: "2026-09-03T10:00:00Z" },
      { actorId: "user-sec", role: "security", approvedAt: "2026-09-03T10:15:00Z" },
      { actorId: "user-peer", role: "peer", approvedAt: "2026-09-03T10:30:00Z" }
    ],
    samplingRate: 0.1,
    rateLimitPerHour: 60,
    monthlyCostCeilingCents: 50000,
    customerConsentRequired: true,
    aiDisclosureEnabled: true,
    rollbackOwner: "lead-oncall@flowdesk.dev"
  };

  describe("validateEvaluationScores", () => {
    it("passes when all scores meet or exceed minimum thresholds", () => {
      const result = validateEvaluationScores(passingScores);
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("fails when grounded quality is below 0.90", () => {
      const result = validateEvaluationScores({ ...passingScores, groundedQuality: 0.85 });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("Grounded quality score 0.85");
    });

    it("fails when no-evidence fail-closed rate is below 0.95", () => {
      const result = validateEvaluationScores({ ...passingScores, noEvidenceFailClosedRate: 0.9 });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("No-evidence fail-closed rate");
    });

    it("fails when prohibited intent or prompt injection defense is not 100%", () => {
      const result = validateEvaluationScores({
        ...passingScores,
        prohibitedIntentBlockRate: 0.99,
        promptInjectionDefenseRate: 0.98
      });
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(2);
    });
  });

  describe("evaluateAutoReleaseGate", () => {
    it("approves release gate when all criteria, approvals, and ceilings are satisfied", () => {
      const result = evaluateAutoReleaseGate(validGateConfig);
      expect(result.eligible).toBe(true);
      expect(result.status).toBe("approved");
      expect(result.missingApprovals).toHaveLength(0);
      expect(result.reasons).toHaveLength(0);
    });

    it("marks gate pending when product or security approval is missing", () => {
      const pendingConfig = {
        ...validGateConfig,
        approvals: [
          { actorId: "user-peer", role: "peer" as const, approvedAt: "2026-09-03T10:30:00Z" }
        ]
      };
      const result = evaluateAutoReleaseGate(pendingConfig);
      expect(result.eligible).toBe(false);
      expect(result.status).toBe("pending");
      expect(result.missingApprovals).toEqual(["product", "security"]);
    });

    it("rejects gate when rollback owner is missing", () => {
      const invalidConfig = { ...validGateConfig, rollbackOwner: "" };
      const result = evaluateAutoReleaseGate(invalidConfig);
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain("Rollback owner must be explicitly designated.");
    });

    it("rejects gate when customer consent or disclosure is disabled", () => {
      const invalidConfig = {
        ...validGateConfig,
        customerConsentRequired: false,
        aiDisclosureEnabled: false
      };
      const result = evaluateAutoReleaseGate(invalidConfig);
      expect(result.eligible).toBe(false);
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          "Customer consent configuration is required before enabling AUTO.",
          "AI automated responder disclosure must be enabled."
        ])
      );
    });

    it("rejects gate when human sampling rate is below 5%", () => {
      const invalidConfig = { ...validGateConfig, samplingRate: 0.02 };
      const result = evaluateAutoReleaseGate(invalidConfig);
      expect(result.eligible).toBe(false);
      expect(result.reasons[0]).toContain("Human sampling rate");
    });
  });

  describe("validateCohortTransition", () => {
    it("allows internal -> beta transition", () => {
      const result = validateCohortTransition("internal", "beta", 0, 0);
      expect(result.valid).toBe(true);
    });

    it("allows beta -> general transition only after 7 days and 0 unresolved incidents", () => {
      const pass = validateCohortTransition("beta", "general", 14, 0);
      expect(pass.valid).toBe(true);

      const tooShort = validateCohortTransition("beta", "general", 3, 0);
      expect(tooShort.valid).toBe(false);
      expect(tooShort.error).toContain("minimum 7 days required");

      const withIncidents = validateCohortTransition("beta", "general", 10, 2);
      expect(withIncidents.valid).toBe(false);
      expect(withIncidents.error).toContain("unresolved safety/SLO incident(s)");
    });

    it("prohibits jumping internal -> general directly", () => {
      const result = validateCohortTransition("internal", "general", 30, 0);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Illegal cohort transition");
    });
  });

  describe("checkLiveOperationalPrerequisites", () => {
    it("allows execution when canary healthy, error budget intact, and killswitches off", () => {
      const result = checkLiveOperationalPrerequisites({
        globalKillswitchActive: false,
        tenantEmergencyDisabled: false,
        errorBudgetRemainingPct: 85,
        productionCanaryHealthy: true
      });
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("blocks execution when global killswitch is active", () => {
      const result = checkLiveOperationalPrerequisites({
        globalKillswitchActive: true,
        tenantEmergencyDisabled: false,
        errorBudgetRemainingPct: 90,
        productionCanaryHealthy: true
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Global AUTO killswitch is engaged");
    });

    it("blocks execution when error budget remaining is <= 20%", () => {
      const result = checkLiveOperationalPrerequisites({
        globalKillswitchActive: false,
        tenantEmergencyDisabled: false,
        errorBudgetRemainingPct: 15,
        productionCanaryHealthy: true
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("freeze threshold: 20%");
    });

    it("blocks execution when production canary is unhealthy", () => {
      const result = checkLiveOperationalPrerequisites({
        globalKillswitchActive: false,
        tenantEmergencyDisabled: false,
        errorBudgetRemainingPct: 80,
        productionCanaryHealthy: false
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Production canary health check failed");
    });
  });
});
