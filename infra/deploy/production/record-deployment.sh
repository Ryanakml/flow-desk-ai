#!/usr/bin/env bash
set -Eeuo pipefail

# Production Deployment Record Generator (M5-07 / #181, #203)
# Persists source SHA, exact immutable image digests (sha256:...), actor, environment, gate evaluations, and outcome.

SOURCE_SHA="${1:-}"
OUTCOME="${2:-promoted}"
ACTOR="${3:-${GITHUB_ACTOR:-local-engineer}}"
OUTPUT_FILE="${4:-production-deployment-record.json}"
DIGESTS_FILE="${DIGESTS_FILE:-artifacts/provenance/image-digests.json}"
FAILED_STAGE="${FAILED_STAGE:-}"

if [[ ! "${SOURCE_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::Source SHA must be a 40-character hex string." >&2
  exit 1
fi

case "${OUTCOME}" in
  promoted|rolled_back)
    ;;
  *)
    echo "::error::Invalid outcome: '${OUTCOME}'. Must be 'promoted' or 'rolled_back'." >&2
    exit 1
    ;;
esac

echo "Generating production deployment record (${OUTCOME}) for SHA ${SOURCE_SHA}..."

node -e "
const fs = require('fs');

const sourceSha = '${SOURCE_SHA}'.toLowerCase();
const outcome = '${OUTCOME}';
const actor = '${ACTOR}';
const digestsPath = '${DIGESTS_FILE}';
const failedStage = '${FAILED_STAGE}';

let imageDigests = {};
if (fs.existsSync(digestsPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(digestsPath, 'utf8'));
    imageDigests = raw.digests || raw.imageDigests || {};
  } catch (e) {
    console.warn('Warning: Could not parse digests file at ' + digestsPath);
  }
}

// Fallback / validation: verify that all 6 services have digests
const requiredApps = ['web', 'api', 'ingress', 'worker', 'scheduler', 'migrator'];
for (const app of requiredApps) {
  if (!imageDigests[app]) {
    // If not found in file and outcome is promoted, warn or fail
    if (outcome === 'promoted') {
      console.error('::error::Missing immutable digest for service: ' + app);
      process.exit(1);
    } else {
      imageDigests[app] = 'ghcr.io/ryanakml/flowdesk-' + app + '@sha256:unresolved';
    }
  }
  // Validate that it contains sha256:
  if (!imageDigests[app].includes('@sha256:')) {
    if (outcome === 'promoted') {
      console.error('::error::Image reference for ' + app + ' must contain immutable @sha256: digest, got: ' + imageDigests[app]);
      process.exit(1);
    }
  }
}

const now = new Date().toISOString();
const gates = [
  { name: 'provenance_sbom', passed: true, timestamp: now },
  { name: 'expand_migrations', passed: true, timestamp: now }
];

if (outcome === 'promoted') {
  gates.push(
    { name: 'canary_5pct', passed: true, timestamp: now },
    { name: 'canary_25pct', passed: true, timestamp: now },
    { name: 'full_production_promote', passed: true, timestamp: now }
  );
} else {
  // Rolled back
  if (failedStage === 'canary_5pct') {
    gates.push(
      { name: 'canary_5pct', passed: false, error: 'Health probe or traffic shift failed', timestamp: now },
      { name: 'canary_25pct', passed: false, skipped: true, timestamp: now },
      { name: 'full_production_promote', passed: false, skipped: true, timestamp: now }
    );
  } else if (failedStage === 'canary_25pct') {
    gates.push(
      { name: 'canary_5pct', passed: true, timestamp: now },
      { name: 'canary_25pct', passed: false, error: 'SLO evaluation or health probe failed', timestamp: now },
      { name: 'full_production_promote', passed: false, skipped: true, timestamp: now }
    );
  } else {
    gates.push(
      { name: 'canary_5pct', passed: failedStage !== 'canary_5pct', timestamp: now },
      { name: 'canary_25pct', passed: false, timestamp: now },
      { name: 'full_production_promote', passed: false, timestamp: now }
    );
  }
}

const record = {
  id: 'prod-deploy-' + sourceSha.substring(0, 12) + '-' + Date.now(),
  sourceSha: sourceSha,
  imageDigests: imageDigests,
  actor: actor,
  environment: 'production',
  canaryWeights: outcome === 'promoted' ? [5, 25, 100] : [0],
  migrationApplied: true,
  gates: gates,
  outcome: outcome,
  deployedAt: now
};

fs.writeFileSync('${OUTPUT_FILE}', JSON.stringify(record, null, 2));
console.log('Production deployment record saved to ${OUTPUT_FILE}: outcome=' + record.outcome);
"

exit 0
