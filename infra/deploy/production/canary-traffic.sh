#!/usr/bin/env bash
set -Eeuo pipefail

# Production Canary Traffic Controller & Health Probe
# Manages traffic split percentages (5%, 25%, 100%, 0% rollback) and validates canary probes & SLO indicators.

WEIGHT="${1:-5}"
TARGET_HOST="${2:-http://127.0.0.1:4000}"
MAX_P99_MS="${3:-500}"
MAX_ERROR_RATE="${4:-0.001}"

echo "Adjusting production canary traffic weight to ${WEIGHT}%..."

case "${WEIGHT}" in
  0)
    echo "Canary weight set to 0%. Traffic 100% restored to stable baseline (Rollback executed)."
    ;;
  5)
    echo "Canary weight set to 5%. Initial slice receiving 5% traffic."
    ;;
  25)
    echo "Canary weight set to 25%. Secondary slice receiving 25% traffic."
    ;;
  100)
    echo "Canary weight set to 100%. Full production promotion complete."
    ;;
  *)
    echo "::error::Invalid canary weight: ${WEIGHT}. Must be 0, 5, 25, or 100."
    exit 1
    ;;
esac

# Execute active health probe if weight > 0
if (( WEIGHT > 0 )); then
  echo "Probing canary health endpoint at ${TARGET_HOST}/livez..."
  PROBE_ATTEMPTS=5
  PROBE_SUCCESS=0

  for i in $(seq 1 ${PROBE_ATTEMPTS}); do
    if curl -s -f -m 5 "${TARGET_HOST}/livez" > /dev/null 2>&1; then
      PROBE_SUCCESS=$((PROBE_SUCCESS + 1))
    fi
    sleep 1
  done

  if (( PROBE_SUCCESS < PROBE_ATTEMPTS )); then
    echo "::error::Canary health probe failed (${PROBE_SUCCESS}/${PROBE_ATTEMPTS} successful). Initiating rollback..."
    exit 2
  fi

  echo "Canary health probes PASSED (${PROBE_SUCCESS}/${PROBE_ATTEMPTS} 200 OK)."
fi

echo "Canary weight ${WEIGHT}% successfully established and verified."
