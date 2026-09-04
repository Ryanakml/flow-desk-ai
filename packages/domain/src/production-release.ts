/**
 * Production Release, Canary Health Gates, and Rollback Domain Rules (M5-07 / #181, #203, #205)
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
  expectedDigests?: Record<string, string>;
  deployedDigests?: Record<string, string>;
  workloadVerified?: boolean;
  actor: string;
  environment: "production";
  canaryWeights: number[];
  migrationApplied: boolean;
  gates: Array<{
    name: string;
    passed: boolean;
    timestamp: string;
    skipped?: boolean;
    error?: string;
  }>;
  outcome: "promoted" | "rolled_back";
}

export interface ProductionDeploymentRecord {
  id: string;
  sourceSha: string;
  imageDigests: Record<string, string>;
  expectedDigests?: Record<string, string>;
  deployedDigests?: Record<string, string>;
  workloadVerified?: boolean;
  actor: string;
  environment: "production";
  canaryWeights: number[];
  migrationApplied: boolean;
  gates: Array<{
    name: string;
    passed: boolean;
    timestamp: string;
    skipped?: boolean;
    error?: string;
  }>;
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
 * Validates that a container image reference is pinned by an immutable sha256 digest.
 * Format must end with @sha256:<64-hex-characters>.
 */
export function validateImageDigest(imageRef: string): { valid: boolean; error?: string } {
  if (!imageRef || typeof imageRef !== "string") {
    return { valid: false, error: "Image reference must be a non-empty string." };
  }

  const trimmed = imageRef.trim();
  const digestMatch = trimmed.match(/@sha256:([0-9a-f]{64})$/i);
  if (!digestMatch) {
    return {
      valid: false,
      error: `Image reference '${trimmed}' is not pinned by an immutable sha256 digest (expected format: <image>@sha256:<64-hex-chars>).`
    };
  }

  return { valid: true };
}

/**
 * Validates that a running container workload is executing the expected immutable sha256 digest.
 */
export function validateRunningWorkloadDigest(
  expectedDigest: string,
  actualDigest: string
): { valid: boolean; error?: string } {
  if (!expectedDigest || !actualDigest) {
    return { valid: false, error: "Expected and actual digests must be non-empty strings." };
  }

  const trimmedExpected = expectedDigest.trim();
  const trimmedActual = actualDigest.trim();

  const actualDigestHash = trimmedActual.includes("@sha256:")
    ? trimmedActual.split("@sha256:")[1]
    : trimmedActual.startsWith("sha256:")
      ? trimmedActual.slice(7)
      : trimmedActual;

  const expectedDigestHash = trimmedExpected.includes("@sha256:")
    ? trimmedExpected.split("@sha256:")[1]
    : trimmedExpected.startsWith("sha256:")
      ? trimmedExpected.slice(7)
      : trimmedExpected;

  if (!actualDigestHash || !expectedDigestHash || actualDigestHash.length !== 64) {
    return { valid: false, error: "Invalid sha256 digest format (expected 64-hex characters)." };
  }

  if (actualDigestHash.toLowerCase() !== expectedDigestHash.toLowerCase()) {
    return {
      valid: false,
      error: `Running workload digest mismatch: expected ${trimmedExpected}, but task is running ${trimmedActual}.`
    };
  }

  return { valid: true };
}

export interface WorkloadLifecycleParams {
  canaryWorkloadDeployed: boolean;
  canaryWorkloadHealthy: boolean;
  canaryWeights: number[];
  stableWorkloadPromoted: boolean;
  outcome: "promoted" | "rolled_back";
}

/**
 * Validates the complete workload deployment and promotion lifecycle.
 * Ensures canary workload is deployed and verified healthy before traffic shifts,
 * and ensures stable workload is updated upon 100% promotion.
 */
export function validateWorkloadLifecycle(params: WorkloadLifecycleParams): {
  valid: boolean;
  error?: string;
} {
  const maxWeight = Math.max(...params.canaryWeights, 0);
  if (maxWeight > 0) {
    if (!params.canaryWorkloadDeployed) {
      return {
        valid: false,
        error: "Cannot shift traffic to canary: canary workload has not been deployed."
      };
    }
    if (!params.canaryWorkloadHealthy) {
      return {
        valid: false,
        error: "Cannot shift traffic to canary: canary workload is not healthy."
      };
    }
  }

  if (params.outcome === "promoted") {
    if (!params.stableWorkloadPromoted) {
      return {
        valid: false,
        error: "Promotion invalid: stable workload was not updated with the verified release."
      };
    }
    if (!params.canaryWeights.includes(100)) {
      return {
        valid: false,
        error: "Promotion invalid: canary traffic did not successfully advance to 100%."
      };
    }
  }

  return { valid: true };
}

export interface ProductionEnvironmentConfig {
  listenerArn?: string;
  ruleArn?: string;
  stableTgArn?: string;
  canaryTgArn?: string;
  canaryEndpointUrl?: string;
  isMock?: boolean;
}

/**
 * Enforces fail-closed validation for production environment configuration.
 * Rejects missing infrastructure ARNs, placeholder values, or localhost endpoints in real production.
 */
export function validateProductionEnvironmentConfig(config: ProductionEnvironmentConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (config.isMock) {
    return { valid: true, errors: [] };
  }

  if (!config.listenerArn && !config.ruleArn) {
    errors.push(
      "Missing required production listener or rule ARN (PROD_LISTENER_ARN or PROD_RULE_ARN)."
    );
  }

  if (!config.stableTgArn) {
    errors.push("Missing required production stable target group ARN (PROD_STABLE_TG_ARN).");
  }

  if (!config.canaryTgArn) {
    errors.push("Missing required production canary target group ARN (PROD_CANARY_TG_ARN).");
  }

  if (config.canaryEndpointUrl !== undefined) {
    if (!config.canaryEndpointUrl) {
      errors.push("CANARY_ENDPOINT_URL is empty.");
    } else if (/^https?:\/\/(127\.0\.0\.1|localhost)(:[0-9]+)?/i.test(config.canaryEndpointUrl)) {
      errors.push(
        `CANARY_ENDPOINT_URL cannot point to localhost in production: ${config.canaryEndpointUrl}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
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

  // Validate that image digests are pinned if outcome is promoted
  if (input.outcome === "promoted") {
    for (const [service, ref] of Object.entries(input.imageDigests)) {
      const digestVal = validateImageDigest(ref);
      if (!digestVal.valid) {
        throw new Error(`Invalid immutable image digest for ${service}: ${digestVal.error}`);
      }
    }
  }

  return {
    id: `prod-deploy-${input.sourceSha.substring(0, 12)}-${Date.now()}`,
    sourceSha: input.sourceSha.toLowerCase(),
    imageDigests: { ...input.imageDigests },
    expectedDigests: input.expectedDigests
      ? { ...input.expectedDigests }
      : { ...input.imageDigests },
    deployedDigests: input.deployedDigests
      ? { ...input.deployedDigests }
      : { ...input.imageDigests },
    workloadVerified: input.workloadVerified ?? input.outcome === "promoted",
    actor: input.actor,
    environment: "production",
    canaryWeights: [...input.canaryWeights],
    migrationApplied: input.migrationApplied,
    gates: input.gates.map((g) => ({ ...g })),
    outcome: input.outcome,
    deployedAt: new Date().toISOString()
  };
}
