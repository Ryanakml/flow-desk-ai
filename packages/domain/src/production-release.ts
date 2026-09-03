/**
 * Production Release, Canary Health Gates, and Rollback Domain Rules (M5-07 / #181)
 */

export interface CanaryHealthMetrics {
  totalRequests: number;
  errorRequests: number;
  p99LatencyMs: number;
  burnRate: number;
  livezHealthy: boolean;
}

export interface CanaryThresholds {
  maxErrorRate: number; // e.g. 0.001 (0.1%)
  maxP99LatencyMs: number; // e.g. 500ms
  maxBurnRate: number; // e.g. 1.0
}

export const DEFAULT_CANARY_THRESHOLDS: CanaryThresholds = Object.freeze({
  maxErrorRate: 0.001,
  maxP99LatencyMs: 500,
  maxBurnRate: 1.0
});

export interface CanaryGateEvaluation {
  passed: boolean;
  reason: string;
  shouldRollback: boolean;
}

export interface ProductionDeploymentInput {
  sourceSha: string;
  imageDigests: Record<string, string>;
  actor: string;
  environment: "production";
  canaryWeights: number[];
  migrationApplied: boolean;
  gates: Array<{ name: string; passed: boolean; timestamp: string }>;
  outcome: "promoted" | "rolled_back";
}

export interface ProductionDeploymentRecord {
  id: string;
  sourceSha: string;
  imageDigests: Record<string, string>;
  actor: string;
  environment: "production";
  canaryWeights: number[];
  migrationApplied: boolean;
  gates: Array<{ name: string; passed: boolean; timestamp: string }>;
  outcome: "promoted" | "rolled_back";
  deployedAt: string;
}

/**
 * Validates that an image tag is an immutable 40-character git commit SHA.
 * Rejects mutable tags like 'latest', 'staging', semver aliases, or branches.
 */
export function validatePromotionImageTag(tag: string): { valid: boolean; error?: string } {
  if (!tag || typeof tag !== "string") {
    return { valid: false, error: "Image tag must be a non-empty string." };
  }

  const trimmed = tag.trim();

  // Reject known mutable tag patterns
  if (
    ["latest", "staging", "production", "dev", "main", "master"].includes(trimmed.toLowerCase())
  ) {
    return {
      valid: false,
      error: `Mutable tag '${trimmed}' rejected. Production releases require an immutable 40-character commit SHA.`
    };
  }

  // Enforce 40-character lowercase hex git commit SHA
  const is40CharHex = /^[0-9a-f]{40}$/i.test(trimmed);
  if (!is40CharHex) {
    return {
      valid: false,
      error: `Tag '${trimmed}' is not a valid 40-character commit SHA. Mutable tags and short SHAs are prohibited.`
    };
  }

  return { valid: true };
}

/**
 * Validates canary weight transition steps.
 * Valid forward transitions: 0 -> 5 -> 25 -> 100.
 * Any step may roll back to 0.
 */
export function validateCanaryWeightTransition(
  currentWeight: number,
  nextWeight: number
): { valid: boolean; error?: string } {
  const allowedSteps = [0, 5, 25, 100];
  if (!allowedSteps.includes(nextWeight)) {
    return {
      valid: false,
      error: `Invalid canary weight ${nextWeight}%. Allowed weights are 0%, 5%, 25%, 100%.`
    };
  }

  // Rollback to 0 is always permitted from any weight
  if (nextWeight === 0) {
    return { valid: true };
  }

  const currentIndex = allowedSteps.indexOf(currentWeight);
  const nextIndex = allowedSteps.indexOf(nextWeight);

  if (currentIndex === -1) {
    return { valid: false, error: `Current weight ${currentWeight}% is invalid.` };
  }

  // Must advance strictly one step forward (e.g. 0 -> 5, 5 -> 25, 25 -> 100)
  if (nextIndex !== currentIndex + 1) {
    return {
      valid: false,
      error: `Illegal weight transition from ${currentWeight}% to ${nextWeight}%. Must advance sequentially: 0% -> 5% -> 25% -> 100%.`
    };
  }

  return { valid: true };
}

/**
 * Evaluates canary health and SLO indicators during a canary evaluation window.
 * Returns whether the gate passed or an immediate rollback must be initiated.
 */
export function evaluateCanaryHealthGate(
  metrics: CanaryHealthMetrics,
  thresholds: CanaryThresholds = DEFAULT_CANARY_THRESHOLDS
): CanaryGateEvaluation {
  if (!metrics.livezHealthy) {
    return {
      passed: false,
      reason: "Canary health probe (/livez) failed or timed out.",
      shouldRollback: true
    };
  }

  if (metrics.totalRequests > 0) {
    const errorRate = metrics.errorRequests / metrics.totalRequests;
    if (errorRate > thresholds.maxErrorRate) {
      return {
        passed: false,
        reason: `Canary error rate ${(errorRate * 100).toFixed(3)}% exceeds SLO limit of ${(thresholds.maxErrorRate * 100).toFixed(2)}%.`,
        shouldRollback: true
      };
    }
  }

  if (metrics.p99LatencyMs > thresholds.maxP99LatencyMs) {
    return {
      passed: false,
      reason: `Canary p99 latency ${metrics.p99LatencyMs}ms exceeds target ${thresholds.maxP99LatencyMs}ms.`,
      shouldRollback: true
    };
  }

  if (metrics.burnRate > thresholds.maxBurnRate) {
    return {
      passed: false,
      reason: `Canary error budget burn rate ${metrics.burnRate.toFixed(2)}x exceeds allowable threshold ${thresholds.maxBurnRate}x.`,
      shouldRollback: true
    };
  }

  return {
    passed: true,
    reason:
      "Canary health gate passed: zero probe failures, error rate and latency within SLO budget.",
    shouldRollback: false
  };
}

/**
 * Validates that database migrations follow expand-contract rules:
 * - Prohibits DROP COLUMN, DROP TABLE in active schema
 * - Prohibits ADD COLUMN ... NOT NULL without a DEFAULT
 * - Prohibits ALTER COLUMN ... RENAME
 */
export function validateMigrationExpandCompatibility(sqlStatements: string[]): {
  compatible: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  for (const sql of sqlStatements) {
    const normalized = sql.replace(/\s+/g, " ").trim();

    // Check for DROP TABLE / DROP COLUMN
    if (/\bDROP\s+COLUMN\b/i.test(normalized)) {
      violations.push(
        `Breaking change detected: DROP COLUMN is prohibited in production expansion phase: '${normalized}'`
      );
    }
    if (/\bDROP\s+TABLE\b/i.test(normalized)) {
      violations.push(
        `Breaking change detected: DROP TABLE is prohibited in production expansion phase: '${normalized}'`
      );
    }

    // Check for ADD COLUMN NOT NULL without DEFAULT
    if (
      /\bADD\s+COLUMN\b/i.test(normalized) &&
      /\bNOT\s+NULL\b/i.test(normalized) &&
      !/\bDEFAULT\b/i.test(normalized)
    ) {
      violations.push(
        `Breaking change detected: ADD COLUMN NOT NULL without DEFAULT will break active production writes: '${normalized}'`
      );
    }

    // Check for column rename
    if (/\bRENAME\s+COLUMN\b/i.test(normalized)) {
      violations.push(
        `Breaking change detected: RENAME COLUMN is prohibited in production expansion phase: '${normalized}'`
      );
    }
  }

  return {
    compatible: violations.length === 0,
    violations
  };
}

/**
 * Creates an immutable production deployment record.
 */
export function createProductionDeploymentRecord(
  input: ProductionDeploymentInput
): ProductionDeploymentRecord {
  const validation = validatePromotionImageTag(input.sourceSha);
  if (!validation.valid) {
    throw new Error(`Cannot record production deployment: ${validation.error}`);
  }

  return {
    id: `prod-deploy-${input.sourceSha.substring(0, 12)}-${Date.now()}`,
    sourceSha: input.sourceSha.toLowerCase(),
    imageDigests: { ...input.imageDigests },
    actor: input.actor,
    environment: "production",
    canaryWeights: [...input.canaryWeights],
    migrationApplied: input.migrationApplied,
    gates: input.gates.map((g) => ({ ...g })),
    outcome: input.outcome,
    deployedAt: new Date().toISOString()
  };
}
