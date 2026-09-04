#!/usr/bin/env bash
set -Eeuo pipefail

# FlowDesk Production Running Workload Verifier (M5-07 / #181, #205)
# Inspects running ECS tasks / target group targets and asserts they execute the expected sha256 digests.
# Fails closed if running digests differ from expected immutable digests.

SLICE="${1:-}"
DIGESTS_FILE="${2:-artifacts/provenance/image-digests.json}"

if [[ -z "${SLICE}" ]]; then
  echo "::error::Slice argument is required (canary or stable)." >&2
  exit 1
fi

if [[ ! -f "${DIGESTS_FILE}" ]]; then
  echo "::error::Digests file '${DIGESTS_FILE}' not found." >&2
  exit 1
fi

echo "Verifying running container image digests for ${SLICE} workload..."

if [[ "${FLOWDESK_MOCK_COMPUTE_CONTROLLER:-false}" == "true" ]]; then
  MOCK_STATE_FILE="${MOCK_WORKLOAD_STATE_FILE:-/tmp/flowdesk-workload-mock-state.json}"
  if [[ ! -f "${MOCK_STATE_FILE}" ]]; then
    echo "::error::[MOCK] Mock workload state file '${MOCK_STATE_FILE}' not found. Workload not deployed." >&2
    exit 1
  fi

  node -e "
    const fs = require('fs');
    const digestsPath = process.argv[1];
    const slice = process.argv[2];
    const stateFile = process.argv[3];
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const digestsData = JSON.parse(fs.readFileSync(digestsPath, 'utf8'));
    const expected = digestsData.digests || digestsData.imageDigests;
    
    if (state.slice !== slice) {
      console.error('::error::[MOCK] Expected slice ' + slice + ', got ' + state.slice);
      process.exit(1);
    }
    if (state.status !== 'HEALTHY') {
      console.error('::error::[MOCK] Workload status is ' + state.status + ', expected HEALTHY');
      process.exit(1);
    }
    for (const [svc, ref] of Object.entries(expected)) {
      if (state.runningDigests[svc] !== ref) {
        console.error('::error::[MOCK] Running digest mismatch for ' + svc);
        process.exit(1);
      }
    }
    console.log('[MOCK] Verified running digests match expected immutable references for ' + slice);
  " "${DIGESTS_FILE}" "${SLICE}" "${MOCK_STATE_FILE}"
  exit 0
fi

# Real AWS verification
AWS_REGION="${AWS_REGION:-ap-southeast-1}"
ECS_CLUSTER_NAME="${ECS_CLUSTER_NAME:-}"
ECS_SERVICE_NAME="${ECS_SERVICE_NAME:-flowdesk-production-${SLICE}-api}"

if [[ -z "${ECS_CLUSTER_NAME}" ]]; then
  echo "::error::ECS_CLUSTER_NAME is required for real workload verification." >&2
  exit 1
fi

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

node -e "
  const fs = require('fs');
  const tasksOutput = JSON.parse(process.env.DESCRIBE_TASKS_JSON || '{}');
  const digestsData = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
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
        const matches = actualImage === expected || (actualDigest && expected.includes(actualDigest));
        if (!matches) {
          console.error('::error::Running digest mismatch for ' + name + ': expected ' + expected + ', got ' + (actualDigest || actualImage));
          process.exit(1);
        }
      }
    }
  }
  console.log('Running tasks confirmed executing expected immutable digests.');
" "${DIGESTS_FILE}"

exit 0
