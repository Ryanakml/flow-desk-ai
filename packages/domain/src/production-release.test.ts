import { describe, expect, it } from "vitest";
import {
  validatePromotionImageTag,
  validateCanaryWeightTransition,
  evaluateCanaryHealthGate,
  validateMigrationExpandCompatibility,
  createProductionDeploymentRecord,
  DEFAULT_CANARY_THRESHOLDS
} from "./production-release.js";

describe("Production Release, Canary Gates, and Rollback Domain (M5-07 / #181)", () => {
  describe("validatePromotionImageTag", () => {
    it("accepts valid 40-character git commit SHA", () => {
      const validSha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
      const result = validatePromotionImageTag(validSha);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("rejects mutable tags like 'latest', 'staging', 'production'", () => {
      expect(validatePromotionImageTag("latest").valid).toBe(false);
      expect(validatePromotionImageTag("staging").valid).toBe(false);
      expect(validatePromotionImageTag("production").valid).toBe(false);
      expect(validatePromotionImageTag("main").valid).toBe(false);
    });

    it("rejects short SHAs or non-hex characters", () => {
      expect(validatePromotionImageTag("a1b2c3d").valid).toBe(false);
      expect(validatePromotionImageTag("g1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2").valid).toBe(
        false
      );
      expect(validatePromotionImageTag("").valid).toBe(false);
    });
  });

  describe("validateCanaryWeightTransition", () => {
    it("allows valid forward canary progression: 0 -> 5 -> 25 -> 100", () => {
      expect(validateCanaryWeightTransition(0, 5).valid).toBe(true);
      expect(validateCanaryWeightTransition(5, 25).valid).toBe(true);
      expect(validateCanaryWeightTransition(25, 100).valid).toBe(true);
    });

    it("prohibits skipping canary steps (e.g. 0 -> 100 or 0 -> 25)", () => {
      expect(validateCanaryWeightTransition(0, 100).valid).toBe(false);
      expect(validateCanaryWeightTransition(0, 25).valid).toBe(false);
      expect(validateCanaryWeightTransition(5, 100).valid).toBe(false);
    });

    it("always permits rollback to 0 from any stage", () => {
      expect(validateCanaryWeightTransition(5, 0).valid).toBe(true);
      expect(validateCanaryWeightTransition(25, 0).valid).toBe(true);
      expect(validateCanaryWeightTransition(100, 0).valid).toBe(true);
    });

    it("rejects arbitrary unconfigured weights", () => {
      expect(validateCanaryWeightTransition(5, 15).valid).toBe(false);
      expect(validateCanaryWeightTransition(25, 50).valid).toBe(false);
    });
  });

  describe("evaluateCanaryHealthGate", () => {
    it("passes when all indicators are healthy and within SLO budget", () => {
      const metrics = {
        totalRequests: 10000,
        errorRequests: 2, // 0.02% error rate (well below 0.1% SLO)
        p99LatencyMs: 180, // well below 500ms
        burnRate: 0.2, // well below 1.0x
        livezHealthy: true
      };

      const result = evaluateCanaryHealthGate(metrics, DEFAULT_CANARY_THRESHOLDS);
      expect(result.passed).toBe(true);
      expect(result.shouldRollback).toBe(false);
    });

    it("triggers rollback when /livez probe fails", () => {
      const metrics = {
        totalRequests: 500,
        errorRequests: 0,
        p99LatencyMs: 50,
        burnRate: 0,
        livezHealthy: false // dead
      };

      const result = evaluateCanaryHealthGate(metrics, DEFAULT_CANARY_THRESHOLDS);
      expect(result.passed).toBe(false);
      expect(result.shouldRollback).toBe(true);
      expect(result.reason).toContain("/livez");
    });

    it("triggers rollback when error rate exceeds SLO threshold", () => {
      const metrics = {
        totalRequests: 1000,
        errorRequests: 5, // 0.5% (exceeds 0.1% threshold)
        p99LatencyMs: 120,
        burnRate: 0.5,
        livezHealthy: true
      };

      const result = evaluateCanaryHealthGate(metrics, DEFAULT_CANARY_THRESHOLDS);
      expect(result.passed).toBe(false);
      expect(result.shouldRollback).toBe(true);
      expect(result.reason).toContain("error rate");
    });

    it("triggers rollback when p99 latency exceeds threshold", () => {
      const metrics = {
        totalRequests: 1000,
        errorRequests: 0,
        p99LatencyMs: 650, // exceeds 500ms
        burnRate: 0.1,
        livezHealthy: true
      };

      const result = evaluateCanaryHealthGate(metrics, DEFAULT_CANARY_THRESHOLDS);
      expect(result.passed).toBe(false);
      expect(result.shouldRollback).toBe(true);
      expect(result.reason).toContain("p99 latency");
    });

    it("triggers rollback when error budget burn rate exceeds 1.0x", () => {
      const metrics = {
        totalRequests: 1000,
        errorRequests: 1,
        p99LatencyMs: 100,
        burnRate: 2.5, // 2.5x burn rate
        livezHealthy: true
      };

      const result = evaluateCanaryHealthGate(metrics, DEFAULT_CANARY_THRESHOLDS);
      expect(result.passed).toBe(false);
      expect(result.shouldRollback).toBe(true);
      expect(result.reason).toContain("burn rate");
    });
  });

  describe("validateMigrationExpandCompatibility", () => {
    it("approves expand-compatible SQL (CREATE TABLE, ADD COLUMN nullable or with DEFAULT)", () => {
      const safeMigrations = [
        "CREATE TABLE flowdesk.new_feature (id text primary key);",
        "ALTER TABLE flowdesk.users ADD COLUMN nickname text;",
        "ALTER TABLE flowdesk.orders ADD COLUMN status text NOT NULL DEFAULT 'draft';"
      ];

      const result = validateMigrationExpandCompatibility(safeMigrations);
      expect(result.compatible).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("rejects DROP COLUMN or DROP TABLE in expand phase", () => {
      const dangerousMigrations = [
        "ALTER TABLE flowdesk.users DROP COLUMN legacy_field;",
        "DROP TABLE flowdesk.old_analytics;"
      ];

      const result = validateMigrationExpandCompatibility(dangerousMigrations);
      expect(result.compatible).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(result.violations[0]).toContain("DROP COLUMN");
      expect(result.violations[1]).toContain("DROP TABLE");
    });

    it("rejects ADD COLUMN NOT NULL without DEFAULT", () => {
      const breakingMigration = [
        "ALTER TABLE flowdesk.conversations ADD COLUMN priority integer NOT NULL;"
      ];

      const result = validateMigrationExpandCompatibility(breakingMigration);
      expect(result.compatible).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toContain("ADD COLUMN NOT NULL without DEFAULT");
    });
  });

  describe("createProductionDeploymentRecord", () => {
    it("generates immutable deployment record with required audit metadata", () => {
      const sha = "1234567890abcdef1234567890abcdef12345678";
      const record = createProductionDeploymentRecord({
        sourceSha: sha,
        imageDigests: {
          web: "sha256:111",
          api: "sha256:222",
          ingress: "sha256:333",
          worker: "sha256:444",
          scheduler: "sha256:555",
          migrator: "sha256:666"
        },
        actor: "release-engineer",
        environment: "production",
        canaryWeights: [5, 25, 100],
        migrationApplied: true,
        gates: [
          { name: "provenance_sbom", passed: true, timestamp: "2026-09-03T10:00:00Z" },
          { name: "canary_5pct", passed: true, timestamp: "2026-09-03T10:15:00Z" },
          { name: "canary_25pct", passed: true, timestamp: "2026-09-03T10:45:00Z" }
        ],
        outcome: "promoted"
      });

      expect(record.sourceSha).toBe(sha);
      expect(record.environment).toBe("production");
      expect(record.actor).toBe("release-engineer");
      expect(record.canaryWeights).toEqual([5, 25, 100]);
      expect(record.outcome).toBe("promoted");
      expect(record.deployedAt).toBeDefined();
    });

    it("throws when sourceSha is not valid immutable commit SHA", () => {
      expect(() =>
        createProductionDeploymentRecord({
          sourceSha: "latest",
          imageDigests: {},
          actor: "dev",
          environment: "production",
          canaryWeights: [],
          migrationApplied: false,
          gates: [],
          outcome: "promoted"
        })
      ).toThrow("Mutable tag 'latest' rejected");
    });
  });
});
