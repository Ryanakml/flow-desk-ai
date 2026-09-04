#!/usr/bin/env bash
set -Eeuo pipefail

# FlowDesk Real Production Canary Traffic Controller (M5-07 / #181, #203)
# Manages weighted target group traffic distribution via AWS ALB API and verifies applied weights.
# Fails closed if production infrastructure configuration or credentials are missing.

WEIGHT="${1:-}"

if [[ -z "${WEIGHT}" ]]; then
  echo "::error::Canary weight argument is required (allowed: 0, 5, 25, 100)." >&2
  exit 1
fi

case "${WEIGHT}" in
  0|5|25|100)
    ;;
  *)
    echo "::error::Invalid canary weight: ${WEIGHT}. Must be 0, 5, 25, or 100." >&2
    exit 1
    ;;
esac

STABLE_WEIGHT=$(( 100 - WEIGHT ))
CANARY_WEIGHT="${WEIGHT}"

echo "Configuring production traffic split: Stable=${STABLE_WEIGHT}%, Canary=${CANARY_WEIGHT}%..."

# Mock adapter for offline testing and rehearsal verification
if [[ "${FLOWDESK_MOCK_TRAFFIC_CONTROLLER:-false}" == "true" ]]; then
  echo "[MOCK] Executing mock traffic controller for test environment..."
  MOCK_STATE_FILE="${MOCK_TRAFFIC_STATE_FILE:-/tmp/flowdesk-canary-mock-state.json}"
  node -e "
    const fs = require('fs');
    const state = {
      updatedAt: new Date().toISOString(),
      stableWeight: ${STABLE_WEIGHT},
      canaryWeight: ${CANARY_WEIGHT},
      listenerArn: process.env.PROD_LISTENER_ARN || 'mock-listener-arn',
      stableTgArn: process.env.PROD_STABLE_TG_ARN || 'mock-stable-tg-arn',
      canaryTgArn: process.env.PROD_CANARY_TG_ARN || 'mock-canary-tg-arn'
    };
    fs.writeFileSync('${MOCK_STATE_FILE}', JSON.stringify(state, null, 2));
  "
  echo "[MOCK] Successfully updated mock routing state in ${MOCK_STATE_FILE}."
  exit 0
fi

# Real AWS ALB provider implementation: FAIL CLOSED if configuration is missing
MISSING_VARS=()
if [[ -z "${PROD_LISTENER_ARN:-}" && -z "${PROD_RULE_ARN:-}" ]]; then
  MISSING_VARS+=("PROD_LISTENER_ARN (or PROD_RULE_ARN)")
fi
if [[ -z "${PROD_STABLE_TG_ARN:-}" ]]; then
  MISSING_VARS+=("PROD_STABLE_TG_ARN")
fi
if [[ -z "${PROD_CANARY_TG_ARN:-}" ]]; then
  MISSING_VARS+=("PROD_CANARY_TG_ARN")
fi

if (( ${#MISSING_VARS[@]} > 0 )); then
  echo "::error::Missing required production infrastructure configuration:" >&2
  for v in "${MISSING_VARS[@]}"; do
    echo "  - ${v}" >&2
  done
  echo "Refusing to simulate success on missing configuration. Fail-closed enforced." >&2
  exit 1
fi

AWS_REGION="${AWS_REGION:-ap-southeast-1}"

# Construct AWS ELBv2 forward action payload with target group weights
FORWARD_ACTIONS_JSON=$(cat << JSON
[
  {
    "Type": "forward",
    "ForwardConfig": {
      "TargetGroups": [
        {
          "TargetGroupArn": "${PROD_STABLE_TG_ARN}",
          "Weight": ${STABLE_WEIGHT}
        },
        {
          "TargetGroupArn": "${PROD_CANARY_TG_ARN}",
          "Weight": ${CANARY_WEIGHT}
        }
      ],
      "TargetGroupStickinessConfig": {
        "Enabled": false
      }
    }
  }
]
JSON
)

echo "Invoking AWS ELBv2 API to adjust target group weights..."

if [[ -n "${PROD_RULE_ARN:-}" ]]; then
  aws elbv2 modify-rule \
    --region "${AWS_REGION}" \
    --rule-arn "${PROD_RULE_ARN}" \
    --actions "${FORWARD_ACTIONS_JSON}" > /dev/null
  
  echo "Verifying rule state via describe-rules..."
  DESCRIBE_OUTPUT=$(aws elbv2 describe-rules \
    --region "${AWS_REGION}" \
    --rule-arns "${PROD_RULE_ARN}" \
    --output json)
else
  aws elbv2 modify-listener \
    --region "${AWS_REGION}" \
    --listener-arn "${PROD_LISTENER_ARN}" \
    --default-actions "${FORWARD_ACTIONS_JSON}" > /dev/null

  echo "Verifying listener state via describe-listeners..."
  DESCRIBE_OUTPUT=$(aws elbv2 describe-listeners \
    --region "${AWS_REGION}" \
    --listener-arns "${PROD_LISTENER_ARN}" \
    --output json)
fi

export DESCRIBE_OUTPUT
export PROD_STABLE_TG_ARN
export PROD_CANARY_TG_ARN

# Verify the live state returned from AWS matches the intended weights
node -e "
  const output = JSON.parse(process.env.DESCRIBE_OUTPUT || '{}');
  const items = output.Listeners || output.Rules || [];
  if (items.length === 0) {
    console.error('::error::No listener/rule returned by describe call');
    process.exit(1);
  }
  const actions = items[0].DefaultActions || items[0].Actions || [];
  const forwardAction = actions.find(a => a.Type === 'forward' && a.ForwardConfig && a.ForwardConfig.TargetGroups);
  if (!forwardAction) {
    console.error('::error::Forward action not found on listener/rule');
    process.exit(1);
  }
  const tgs = forwardAction.ForwardConfig.TargetGroups;
  const stable = tgs.find(tg => tg.TargetGroupArn === process.env.PROD_STABLE_TG_ARN);
  const canary = tgs.find(tg => tg.TargetGroupArn === process.env.PROD_CANARY_TG_ARN);

  if (!stable || stable.Weight !== ${STABLE_WEIGHT}) {
    console.error('::error::Stable target group weight mismatch: expected ${STABLE_WEIGHT}, got ' + (stable ? stable.Weight : 'missing'));
    process.exit(1);
  }
  if (!canary || canary.Weight !== ${CANARY_WEIGHT}) {
    console.error('::error::Canary target group weight mismatch: expected ${CANARY_WEIGHT}, got ' + (canary ? canary.Weight : 'missing'));
    process.exit(1);
  }
  console.log('Verified active AWS ALB weights: Stable=' + stable.Weight + '%, Canary=' + canary.Weight + '%');
"

echo "Canary weight ${WEIGHT}% successfully established and verified on AWS ALB."
