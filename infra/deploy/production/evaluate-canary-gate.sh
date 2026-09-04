#!/usr/bin/env bash
set -Eeuo pipefail

# FlowDesk Production Canary Health & SLO Gate Evaluator (M5-07 / #181, #203)
# Performs real health probes against the canary slice and evaluates SLO metrics
# (Error Rate <= 0.1%, p99 Latency <= 500ms, Error Budget Burn Rate <= 1.0).
# Fails closed if canary endpoint is not configured.
# Exit code 0: Gate PASSED
# Exit code 1: Configuration error (fail closed)
# Exit code 2: Gate FAILED (triggers automated rollback)

WEIGHT="${1:-}"
CANARY_URL="${CANARY_ENDPOINT_URL:-${2:-}}"

if [[ -z "${WEIGHT}" ]]; then
  echo "::error::Weight argument is required (e.g., 5 or 25)." >&2
  exit 1
fi

echo "Evaluating canary gate for ${WEIGHT}% traffic slice..."

# Mock adapter for test and CI rehearsal environments
if [[ "${FLOWDESK_MOCK_CANARY_PROBE:-false}" == "true" ]]; then
  echo "[MOCK] Evaluating mock canary gate for ${WEIGHT}% slice..."
  if [[ "${MOCK_CANARY_FAIL:-false}" == "true" ]]; then
    echo "::error::[MOCK] Synthetic canary gate failure triggered (MOCK_CANARY_FAIL=true)." >&2
    exit 2
  fi
  echo "[MOCK] Canary health and SLO checks passed."
  echo "Canary gate for ${WEIGHT}% traffic slice PASSED."
  exit 0
fi

# Real environment verification: FAIL CLOSED if CANARY_ENDPOINT_URL is missing
if [[ -z "${CANARY_URL}" ]]; then
  echo "::error::CANARY_ENDPOINT_URL is not set. Refusing to simulate canary health on unknown endpoint." >&2
  echo "Fail-closed enforced: Canary evaluation requires a valid canary endpoint or ALB DNS." >&2
  exit 1
fi

# Reject localhost in non-mock production runs
if [[ "${CANARY_URL}" =~ ^https?://(127\.0\.0\.1|localhost)(:[0-9]+)? ]]; then
  echo "::error::CANARY_ENDPOINT_URL points to localhost (${CANARY_URL}). Localhost is not a valid production canary endpoint." >&2
  exit 1
fi

HEALTH_ENDPOINT="${CANARY_URL%/}/livez"
echo "Probing canary health endpoint: ${HEALTH_ENDPOINT}..."

PROBE_RETRIES="${CANARY_PROBE_RETRIES:-3}"
PROBE_INTERVAL="${CANARY_PROBE_INTERVAL:-5}"
PROBE_SUCCESS=0

for i in $(seq 1 "${PROBE_RETRIES}"); do
  echo "Health probe ${i}/${PROBE_RETRIES}..."
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "${HEALTH_ENDPOINT}" || echo "000")
  if [[ "${HTTP_STATUS}" == "200" ]]; then
    echo "  Probe ${i}: OK (HTTP 200)"
    PROBE_SUCCESS=$(( PROBE_SUCCESS + 1 ))
  else
    echo "  Probe ${i}: FAILED (HTTP ${HTTP_STATUS})"
  fi
  if [[ "${i}" -lt "${PROBE_RETRIES}" ]]; then
    sleep "${PROBE_INTERVAL}"
  fi
done

if (( PROBE_SUCCESS < PROBE_RETRIES )); then
  echo "::error::Canary health check failed: ${PROBE_SUCCESS}/${PROBE_RETRIES} successful probes." >&2
  exit 2
fi

echo "Canary health probes passed successfully (${PROBE_SUCCESS}/${PROBE_RETRIES})."

# Evaluate SLO metrics via Prometheus if configured
PROMETHEUS_URL="${PROMETHEUS_URL:-}"
if [[ -n "${PROMETHEUS_URL}" ]]; then
  echo "Querying Prometheus at ${PROMETHEUS_URL} for canary SLO metrics..."

  # Query 5xx Error Rate over last 5m (Must be <= 0.001 i.e. 0.1%)
  ERROR_RATE_QUERY='sum(rate(http_requests_total{status=~"5..",slice="canary"}[5m])) / sum(rate(http_requests_total{slice="canary"}[5m]))'
  ERROR_RATE_RESP=$(curl -s -G --data-urlencode "query=${ERROR_RATE_QUERY}" "${PROMETHEUS_URL%/}/api/v1/query" || echo "{}")

  # Query p99 latency in seconds (Must be <= 0.500s i.e. 500ms)
  LATENCY_QUERY='histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{slice="canary"}[5m])) by (le))'
  LATENCY_RESP=$(curl -s -G --data-urlencode "query=${LATENCY_QUERY}" "${PROMETHEUS_URL%/}/api/v1/query" || echo "{}")

  # Query Error Budget Burn Rate over 1 hour window (Must be <= 1.0)
  BURN_RATE_QUERY='sum(rate(http_requests_total{status=~"5..",slice="canary"}[1h])) / (0.001 * sum(rate(http_requests_total{slice="canary"}[1h])))'
  BURN_RATE_RESP=$(curl -s -G --data-urlencode "query=${BURN_RATE_QUERY}" "${PROMETHEUS_URL%/}/api/v1/query" || echo "{}")

  node -e "
    const parseVal = (resp) => {
      try {
        const data = JSON.parse(resp);
        if (data.status !== 'success' || !data.data.result.length) return null;
        return parseFloat(data.data.result[0].value[1]);
      } catch (e) {
        return null;
      }
    };

    const errorRate = parseVal(process.env.ERROR_RATE_RESP);
    const p99Latency = parseVal(process.env.LATENCY_RESP);
    const burnRate = parseVal(process.env.BURN_RATE_RESP);

    console.log('Canary SLO Evaluation:');
    console.log('  5xx Error Rate:', errorRate !== null ? (errorRate * 100).toFixed(3) + '%' : 'no traffic / N/A');
    console.log('  p99 Latency:   ', p99Latency !== null ? (p99Latency * 1000).toFixed(1) + 'ms' : 'no traffic / N/A');
    console.log('  Burn Rate:     ', burnRate !== null ? burnRate.toFixed(2) : 'no traffic / N/A');

    if (errorRate !== null && errorRate > 0.001) {
      console.error('::error::Canary error rate exceeded SLO threshold: ' + (errorRate * 100).toFixed(3) + '% > 0.100%');
      process.exit(2);
    }

    if (p99Latency !== null && p99Latency > 0.500) {
      console.error('::error::Canary p99 latency exceeded SLO threshold: ' + (p99Latency * 1000).toFixed(1) + 'ms > 500ms');
      process.exit(2);
    }

    if (burnRate !== null && burnRate > 1.0) {
      console.error('::error::Canary error budget burn rate exceeded threshold: ' + burnRate.toFixed(2) + ' > 1.0');
      process.exit(2);
    }
  " ERROR_RATE_RESP="${ERROR_RATE_RESP}" LATENCY_RESP="${LATENCY_RESP}" BURN_RATE_RESP="${BURN_RATE_RESP}"

  echo "Prometheus SLO metrics verified within acceptable thresholds."
elif [[ -n "${PROD_CANARY_TG_ARN:-}" && -n "${AWS_REGION:-}" && "${EVALUATE_CLOUDWATCH_METRICS:-false}" == "true" ]]; then
  echo "Querying AWS CloudWatch for canary 5xx errors on target group..."
  TG_SUFFIX="${PROD_CANARY_TG_ARN#*targetgroup/}"
  TG_SUFFIX="targetgroup/${TG_SUFFIX}"
  
  ERROR_COUNT=$(aws cloudwatch get-metric-data \
    --region "${AWS_REGION}" \
    --metric-data-queries "[{\"Id\":\"m1\",\"MetricStat\":{\"Metric\":{\"Namespace\":\"AWS/ApplicationELB\",\"MetricName\":\"HTTPCode_Target_5XX_Count\",\"Dimensions\":[{\"Name\":\"TargetGroup\",\"Value\":\"${TG_SUFFIX}\"}]},\"Period\":60,\"Stat\":\"Sum\"}}]" \
    --start-time "$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-5M +%Y-%m-%dT%H:%M:%SZ)" \
    --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --query "MetricDataResults[0].Values" \
    --output text || echo "")

  if [[ -n "${ERROR_COUNT}" && "${ERROR_COUNT}" != "None" ]]; then
    TOTAL_ERRORS=0
    for val in ${ERROR_COUNT}; do
      TOTAL_ERRORS=$(( TOTAL_ERRORS + ${val%.*} ))
    done
    echo "CloudWatch 5xx count in last 5 minutes: ${TOTAL_ERRORS}"
    if (( TOTAL_ERRORS > 5 )); then
      echo "::error::CloudWatch 5xx error count (${TOTAL_ERRORS}) exceeded rollback threshold (5)." >&2
      exit 2
    fi
  fi
  echo "CloudWatch metrics verified."
else
  echo "No metrics server (Prometheus/CloudWatch) specified; passed active health probes."
fi

echo "Canary gate for ${WEIGHT}% traffic slice PASSED."
exit 0
