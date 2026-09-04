#!/usr/bin/env bash
set -Eeuo pipefail

# FlowDesk Production Provenance & Immutable Digest Verifier (M5-07 / #181, #203)
# Validates 40-character hex SHA, rejects mutable tags, verifies published manifests in GHCR,
# extracts exact immutable sha256 digests for all 6 release services, and writes image-digests.json.
# Fails closed if any image digest cannot be resolved or verified.

SOURCE_SHA="${1:-}"
OUTPUT_FILE="${2:-artifacts/provenance/image-digests.json}"

if [[ -z "${SOURCE_SHA}" ]]; then
  echo "::error::Source SHA argument is required." >&2
  exit 1
fi

# Validate immutable 40-char commit SHA
if [[ ! "${SOURCE_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::Release SHA '${SOURCE_SHA}' is invalid. Production promotion strictly requires an immutable 40-character commit SHA." >&2
  exit 1
fi

if [[ "${SOURCE_SHA}" =~ ^(latest|staging|production|main|master)$ ]]; then
  echo "::error::Mutable tag '${SOURCE_SHA}' is rejected for production releases." >&2
  exit 1
fi

mkdir -p "$(dirname "${OUTPUT_FILE}")"

APPS=("web" "api" "ingress" "worker" "scheduler" "migrator")

# Mock adapter for test and offline environments
if [[ "${FLOWDESK_MOCK_PROVENANCE:-false}" == "true" ]]; then
  echo "[MOCK] Generating verified mock sha256 digests for SHA ${SOURCE_SHA}..."
  node -e "
    const fs = require('fs');
    const crypto = require('crypto');
    const sha = '${SOURCE_SHA}';
    const apps = ['web', 'api', 'ingress', 'worker', 'scheduler', 'migrator'];
    const digests = {};
    for (const app of apps) {
      const hash = crypto.createHash('sha256').update(app + ':' + sha).digest('hex');
      digests[app] = 'ghcr.io/ryanakml/flowdesk-' + app + '@sha256:' + hash;
    }
    const record = {
      sourceSha: sha,
      verifiedAt: new Date().toISOString(),
      digests
    };
    fs.writeFileSync('${OUTPUT_FILE}', JSON.stringify(record, null, 2));
  "
  echo "[MOCK] Image digests successfully written to ${OUTPUT_FILE}."
  exit 0
fi

echo "Verifying published image manifests and resolving immutable digests for SHA ${SOURCE_SHA}..."

REGISTRY="ghcr.io/ryanakml"
RESOLVED_DIGESTS=()

for app in "${APPS[@]}"; do
  IMAGE_TAG="${REGISTRY}/flowdesk-${app}:${SOURCE_SHA}"
  echo "Resolving manifest digest for ${IMAGE_TAG}..."

  # Attempt resolution via docker manifest inspect or docker buildx imagetools
  DIGEST=""
  if command -v docker >/dev/null 2>&1; then
    MANIFEST_OUTPUT=$(docker manifest inspect "${IMAGE_TAG}" 2>/dev/null || echo "")
    if [[ -n "${MANIFEST_OUTPUT}" ]]; then
      # Extract config digest or manifest digest
      DIGEST=$(echo "${MANIFEST_OUTPUT}" | node -e "
        const fs = require('fs');
        try {
          const m = JSON.parse(fs.readFileSync(0, 'utf8'));
          // If manifest list / multi-arch index, or single manifest
          if (m.manifests && m.manifests.length > 0) {
            console.log(m.manifests[0].digest);
          } else if (m.config && m.config.digest) {
            console.log(m.config.digest);
          }
        } catch (e) {
          process.exit(0);
        }
      " || echo "")
    fi
  fi

  # Fallback to crane if available
  if [[ -z "${DIGEST}" ]] && command -v crane >/dev/null 2>&1; then
    DIGEST=$(crane digest "${IMAGE_TAG}" 2>/dev/null || echo "")
  fi

  if [[ -z "${DIGEST}" ]]; then
    echo "::error::Could not resolve immutable digest for ${IMAGE_TAG}. Image may not exist in registry or credentials may be missing." >&2
    echo "Fail-closed enforced: Production release requires verified sha256 digest for all 6 release services." >&2
    exit 1
  fi

  if [[ ! "${DIGEST}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "::error::Invalid digest format returned for ${IMAGE_TAG}: '${DIGEST}'. Expected sha256:<64-hex>." >&2
    exit 1
  fi

  IMMUTABLE_REF="${REGISTRY}/flowdesk-${app}@${DIGEST}"
  echo "  -> ${app}: ${IMMUTABLE_REF}"
  RESOLVED_DIGESTS+=("${app}=${IMMUTABLE_REF}")
done

# Write verified digests JSON
node -e "
  const fs = require('fs');
  const entries = process.argv.slice(1);
  const digests = {};
  for (const entry of entries) {
    const [app, ref] = entry.split('=');
    digests[app] = ref;
  }
  const record = {
    sourceSha: '${SOURCE_SHA}',
    verifiedAt: new Date().toISOString(),
    digests
  };
  fs.writeFileSync('${OUTPUT_FILE}', JSON.stringify(record, null, 2));
" "${RESOLVED_DIGESTS[@]}"

echo "All 6 release images successfully verified with immutable digests in ${OUTPUT_FILE}."
exit 0
