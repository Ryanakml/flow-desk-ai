#!/usr/bin/env bash
set -Eeuo pipefail

# FlowDesk Production Compute Workload Deployment Controller (M5-07 / #181, #205)
# Deploys exact verified immutable sha256 image digests to AWS ECS Fargate workloads.
# Verifies that running tasks match the expected digests and pass target health checks
# BEFORE any traffic shifting occurs.
# Fails closed if configuration, digests, or running task digests do not match.

SLICE="${1:-}"
DIGESTS_FILE="${2:-artifacts/provenance/image-digests.json}"
TIMEOUT_SECS="${3:-300}"

if [[ -z "${SLICE}" ]]; then
  echo "::error::Workload slice argument is required (allowed: 'canary', 'stable')." >&2
  exit 1
fi

case "${SLICE}" in
  canary|stable)
    ;;
  *)
    echo "::error::Invalid workload slice: '${SLICE}'. Must be 'canary' or 'stable'." >&2
    exit 1
    ;;
esac

echo "Deploying verified image digests to FlowDesk production ${SLICE} workload..."

if [[ ! -f "${DIGESTS_FILE}" ]]; then
  echo "::error::Digests file '${DIGESTS_FILE}' not found. Cannot deploy unverified workload." >&2
  exit 1
fi

# Extract and validate digests from file
node -e "
  const fs = require('fs');
  const path = process.argv[1];
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  const digests = data.digests || data.imageDigests;
  if (!digests) {
    console.error('::error::No digests mapping found in ' + path);
    process.exit(1);
  }
  const required = ['api', 'web'];
  for (const svc of required) {
    if (!digests[svc] || !digests[svc].includes('@sha256:')) {
      console.error('::error::Service ' + svc + ' lacks immutable @sha256: digest in ' + path);
      process.exit(1);
    }
  }
" "${DIGESTS_FILE}"

# Mock compute adapter for offline unit/integration test execution
if [[ "${FLOWDESK_MOCK_COMPUTE_CONTROLLER:-false}" == "true" ]]; then
  echo "[MOCK] Executing mock compute controller for ${SLICE} workload..."
  
  if [[ "${MOCK_WORKLOAD_FAIL:-false}" == "true" ]]; then
    echo "::error::[MOCK] Synthetic workload deployment failure triggered (MOCK_WORKLOAD_FAIL=true)." >&2
    exit 1
  fi

  MOCK_STATE_FILE="${MOCK_WORKLOAD_STATE_FILE:-/tmp/flowdesk-workload-mock-state.json}"
  
  node -e "
    const fs = require('fs');
    const digestsPath = process.argv[1];
    const slice = process.argv[2];
    const stateFile = process.argv[3];
    const digestsData = JSON.parse(fs.readFileSync(digestsPath, 'utf8'));
    const digests = digestsData.digests || digestsData.imageDigests;
    
    // Simulate digest mismatch if requested by test
    let runningDigests = { ...digests };
    if (process.env.MOCK_DIGEST_MISMATCH === 'true') {
      runningDigests['api'] = 'ghcr.io/ryanakml/flowdesk-api@sha256:0000000000000000000000000000000000000000000000000000000000000000';
    }

    // Verify running digest matches expected
    for (const [svc, ref] of Object.entries(digests)) {
      if (runningDigests[svc] !== ref) {
        console.error('::error::[MOCK] Running digest mismatch for ' + svc + ': expected ' + ref + ', got ' + runningDigests[svc]);
        process.exit(1);
      }
    }

    const state = {
      slice: slice,
      updatedAt: new Date().toISOString(),
      cluster: process.env.ECS_CLUSTER_NAME || 'mock-cluster',
      service: process.env.ECS_SERVICE_NAME || ('mock-service-' + slice),
      targetGroupArn: process.env.PROD_TARGET_GROUP_ARN || ('mock-tg-' + slice),
      status: 'HEALTHY',
      runningDigests: runningDigests
    };

    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  " "${DIGESTS_FILE}" "${SLICE}" "${MOCK_STATE_FILE}"

  echo "[MOCK] Workload for ${SLICE} successfully deployed and verified running expected digests."
  exit 0
fi

# Real AWS ECS Fargate deployment: FAIL CLOSED if configuration is missing
MISSING_VARS=()
if [[ -z "${ECS_CLUSTER_NAME:-}" ]]; then
  MISSING_VARS+=("ECS_CLUSTER_NAME")
fi

ECS_SERVICE_NAME="${ECS_SERVICE_NAME:-flowdesk-production-${SLICE}-api}"
PROD_TG_ARN=""
if [[ "${SLICE}" == "canary" ]]; then
  PROD_TG_ARN="${PROD_CANARY_TG_ARN:-}"
else
  PROD_TG_ARN="${PROD_STABLE_TG_ARN:-}"
fi

if [[ -z "${PROD_TG_ARN}" ]]; then
  MISSING_VARS+=("PROD_${SLICE}_TG_ARN")
fi

if (( ${#MISSING_VARS[@]} > 0 )); then
  echo "::error::Missing required production compute configuration:" >&2
  for v in "${MISSING_VARS[@]}"; do
    echo "  - ${v}" >&2
  done
  echo "Refusing to simulate workload deployment. Fail-closed enforced." >&2
  exit 1
fi

AWS_REGION="${AWS_REGION:-ap-southeast-1}"

echo "Fetching current task definition for ECS service '${ECS_SERVICE_NAME}'..."
TASK_DEF_ARN=$(aws ecs describe-services \
  --region "${AWS_REGION}" \
  --cluster "${ECS_CLUSTER_NAME}" \
  --services "${ECS_SERVICE_NAME}" \
  --query "services[0].taskDefinition" \
  --output text)

if [[ -z "${TASK_DEF_ARN}" || "${TASK_DEF_ARN}" == "None" ]]; then
  echo "::error::Could not describe ECS service '${ECS_SERVICE_NAME}' in cluster '${ECS_CLUSTER_NAME}'." >&2
  exit 1
fi

echo "Current task definition: ${TASK_DEF_ARN}"
TASK_DEF_JSON=$(aws ecs describe-task-definition \
  --region "${AWS_REGION}" \
  --task-definition "${TASK_DEF_ARN}" \
  --query "taskDefinition" \
  --output json)
export TASK_DEF_JSON

# Create new task definition JSON injecting verified immutable sha256 digests
NEW_TASK_DEF_PAYLOAD=$(node -e "
  const fs = require('fs');
  const raw = JSON.parse(process.env.TASK_DEF_JSON);
  const taskDef = raw.taskDefinition || raw;
  const digestsPath = process.argv[1];
  const digestsData = JSON.parse(fs.readFileSync(digestsPath, 'utf8'));
  const digests = digestsData.digests || digestsData.imageDigests;

  // Clean task definition output for re-registration
  delete taskDef.taskDefinitionArn;
  delete taskDef.revision;
  delete taskDef.status;
  delete taskDef.requiresAttributes;
  delete taskDef.compatibilities;
  delete taskDef.registeredAt;
  delete taskDef.registeredBy;

  // Update container images
  for (const container of taskDef.containerDefinitions) {
    const name = container.name; // e.g. api, web, etc.
    if (digests[name]) {
      console.warn('Updating container ' + name + ' image to ' + digests[name]);
      container.image = digests[name];
    }
  }

  process.stdout.write(JSON.stringify(taskDef));
" "${DIGESTS_FILE}")

echo "Registering new task definition revision with verified immutable digests..."
REGISTER_RESP=$(aws ecs register-task-definition \
  --region "${AWS_REGION}" \
  --cli-input-json "${NEW_TASK_DEF_PAYLOAD}")

NEW_TASK_DEF_ARN=$(echo "${REGISTER_RESP}" | node -e "
  const fs = require('fs');
  const resp = JSON.parse(fs.readFileSync(0, 'utf8'));
  console.log(resp.taskDefinition.taskDefinitionArn);
")
echo "Registered new task definition: ${NEW_TASK_DEF_ARN}"

echo "Updating ECS service '${ECS_SERVICE_NAME}' to revision ${NEW_TASK_DEF_ARN}..."
aws ecs update-service \
  --region "${AWS_REGION}" \
  --cluster "${ECS_CLUSTER_NAME}" \
  --service "${ECS_SERVICE_NAME}" \
  --task-definition "${NEW_TASK_DEF_ARN}" \
  --force-new-deployment > /dev/null

echo "Waiting for ECS service '${ECS_SERVICE_NAME}' to reach steady state..."
aws ecs wait services-stable \
  --region "${AWS_REGION}" \
  --cluster "${ECS_CLUSTER_NAME}" \
  --services "${ECS_SERVICE_NAME}"

echo "Verifying running task container digests against expected digests..."
RUNNING_TASK_ARNS=$(aws ecs list-tasks \
  --region "${AWS_REGION}" \
  --cluster "${ECS_CLUSTER_NAME}" \
  --service-name "${ECS_SERVICE_NAME}" \
  --desired-status RUNNING \
  --query "taskArns" \
  --output json)
export RUNNING_TASK_ARNS

node -e "
  const taskArns = JSON.parse(process.env.RUNNING_TASK_ARNS || '[]');
  if (!taskArns || taskArns.length === 0) {
    console.error('::error::No running tasks found for service ${ECS_SERVICE_NAME}');
    process.exit(1);
  }
"

DESCRIBE_TASKS_JSON=$(aws ecs describe-tasks \
  --region "${AWS_REGION}" \
  --cluster "${ECS_CLUSTER_NAME}" \
  --tasks $(echo "${RUNNING_TASK_ARNS}" | node -e "const fs = require('fs'); console.log(JSON.parse(fs.readFileSync(0, 'utf8')).join(' '))") \
  --output json)
export DESCRIBE_TASKS_JSON

# Validate that running tasks are using the expected image digests
node -e "
  const fs = require('fs');
  const tasksOutput = JSON.parse(process.env.DESCRIBE_TASKS_JSON || '{}');
  const digestsPath = process.argv[1];
  const digestsData = JSON.parse(fs.readFileSync(digestsPath, 'utf8'));
  const expectedDigests = digestsData.digests || digestsData.imageDigests;

  const tasks = tasksOutput.tasks || [];
  if (tasks.length === 0) {
    console.error('::error::No tasks returned by describe-tasks');
    process.exit(1);
  }

  for (const task of tasks) {
    for (const container of task.containers || []) {
      const name = container.name;
      if (expectedDigests[name]) {
        const expected = expectedDigests[name];
        const actualImage = container.image;
        const actualDigest = container.imageDigest;
        
        // Container image or imageDigest must match expected
        const matches = actualImage === expected || (actualDigest && expected.includes(actualDigest));
        if (!matches) {
          console.error('::error::Task ' + task.taskArn + ' container ' + name + ' running digest mismatch: expected ' + expected + ', got ' + (actualDigest || actualImage));
          process.exit(1);
        }
      }
    }
  }
  console.log('All running tasks verified executing expected immutable digests.');
" "${DIGESTS_FILE}"

echo "Checking target group health on ${PROD_TG_ARN}..."
TG_HEALTH=$(aws elbv2 describe-target-health \
  --region "${AWS_REGION}" \
  --target-group-arn "${PROD_TG_ARN}" \
  --query "TargetHealthDescriptions[].TargetHealth.State" \
  --output json)
export TG_HEALTH

node -e "
  const states = JSON.parse(process.env.TG_HEALTH || '[]');
  if (states.length === 0) {
    console.error('::error::No registered targets found in target group ${PROD_TG_ARN}');
    process.exit(1);
  }
  const allHealthy = states.every(s => s === 'healthy');
  if (!allHealthy) {
    console.error('::error::Target group ${PROD_TG_ARN} has unhealthy targets: ' + JSON.stringify(states));
    process.exit(1);
  }
  console.log('All ' + states.length + ' targets in ${PROD_TG_ARN} are healthy.');
"

echo "Workload deployment for ${SLICE} completed successfully and verified."
exit 0
