# FlowDesk Production Promotion & Canary Rollback Rehearsal Evidence

This document records the rehearsal evidence for the M5 immutable production promotion, canary health gating, workload deployment, and automated rollback path as specified in Issue #181, Issue #203, and Issue #205.

---

## 1. Rehearsal Summary Matrix

| Rehearsal Item                          | Requirement                                                                                 | Verification Command / Gate                         | Result   | Evidence / Artifact                                                                                 |
| :-------------------------------------- | :------------------------------------------------------------------------------------------ | :-------------------------------------------------- | :------- | :-------------------------------------------------------------------------------------------------- |
| **Immutable SHA Promotion**             | Reject mutable tags (`latest`, `staging`); enforce 40-char hex commit SHA proven in staging | `validatePromotionImageTag`                         | **PASS** | Rejects `latest`, `staging`, branch names; accepts valid 40-hex SHA                                 |
| **Exact sha256 Image Digests**          | Extract and verify immutable `sha256:...` digests for all 6 release services                | `infra/deploy/production/verify-provenance.sh`      | **PASS** | Rejects unpinned tags; produces verified `artifacts/provenance/image-digests.json`                  |
| **SPDX-2.3 SBOM Generation**            | Real SPDX-2.3 specification retaining workspace and dependency provenance                   | `infra/deploy/production/generate-sbom.sh`          | **PASS** | 12 workspaces documented in `artifacts/sbom/`                                                       |
| **Migration Compatibility**             | Validate expand-contract rules (no DROP COLUMN/TABLE, no non-default NOT NULL)              | `infra/deploy/production/validate-migrations.sh`    | **PASS** | Backwards-compatibility verified for all production migrations                                      |
| **Canary Workload Deployment**          | Deploy exact verified sha256 digests to ECS Fargate canary service before traffic shift     | `infra/deploy/production/deploy-workload.sh canary` | **PASS** | Registers task definition revision, waits for stability, verifies running digests and target health |
| **Running Digest Verification**         | Verify running ECS task containers execute the expected sha256 digests                      | `infra/deploy/production/verify-workload.sh canary` | **PASS** | Confirms active container image digests match expected immutable sha256 digests                     |
| **Staged Canary 5% -> 25% -> 100%**     | Real traffic weight shift via AWS ALB API with post-adjustment state verification           | `infra/deploy/production/canary-traffic.sh`         | **PASS** | Shifts target group weights (95/5 -> 75/25 -> 0/100) and verifies via AWS describe API              |
| **Canary Health & SLO Gates**           | Active `/livez` probing and Prometheus/CloudWatch SLO checks                                | `infra/deploy/production/evaluate-canary-gate.sh`   | **PASS** | Verifies 5xx error rate <= 0.1%, p99 latency <= 500ms, burn rate <= 1.0; exits 2 on failure         |
| **Stable Workload Promotion (Catchup)** | Upon 100% promotion, deploy verified release to stable ECS service and reset traffic        | `infra/deploy/production/deploy-workload.sh stable` | **PASS** | Updates stable ECS workload and resets ALB traffic to 100% stable / 0% canary                       |
| **Fail-Closed Configuration Gate**      | Refuse to simulate success if required production ARNs or credentials are unset             | `validateProductionEnvironmentConfig`               | **PASS** | Fails closed with exit 1 if ARNs or credentials are missing; forbids localhost                      |
| **Automated Rollback on Gate Failure**  | Immediate rollback to 100% stable / 0% canary on health probe or SLO violation              | `infra/deploy/production/canary-traffic.sh 0`       | **PASS** | Restores 100% traffic to stable, preserves stable workload, records failed stage                    |
| **Deployment Record Retention**         | Persist immutable JSON record with source SHA, expected/deployed digests, and gates         | `infra/deploy/production/record-deployment.sh`      | **PASS** | Persists `production-deployment-record.json` for both `promoted` and `rolled_back`                  |

---

## 2. Compute Runtime & Promotion Architecture

### Architecture Reference

In accordance with **ADR-003** (`docs/adr/003-aws-ecs-reference-deployment.md`) and **Engineering Specification §21.1**, the production compute runtime is **AWS ECS Fargate** behind an Application Load Balancer (`flowdesk-production-alb`).

### Stable Catchup Promotion Lifecycle

1. **Provenance & Verification:** The 40-character commit SHA is validated, GHCR manifests are inspected, and exact `sha256:...` digests are extracted into `image-digests.json`.
2. **Canary Workload Deployment (Pre-Traffic Shift):**
   - New task definition revision is registered with exact `sha256:...` digests.
   - `flowdesk-production-canary-api` service is updated.
   - Task stability and target group health are verified.
   - Running container digests are queried to confirm they match the expected digests.
   - **Only after canary workload verification is traffic shifted to 5%.**
3. **Canary Slices (5% -> 25% -> 100%):**
   - Traffic is shifted in staged increments on the ALB listener.
   - Active `/livez` probes and Prometheus SLO metrics (5xx error rate <= 0.1%, p99 latency <= 500ms, burn rate <= 1.0) are evaluated at each step.
4. **Stable Catchup Promotion:**
   - Once 100% canary traffic satisfies all health and SLO gates, the **stable workload** (`flowdesk-production-stable-api`) is deployed with the exact same verified task definition.
   - Stable tasks are verified healthy and running the new digest.
   - ALB listener traffic is reset to **100% stable / 0% canary**.
   - Production is never left permanently dependent on a canary slice.
5. **Automated Rollback:**
   - On any canary deployment failure, health probe failure, or SLO breach, ALB traffic is immediately reset to 100% stable / 0% canary.
   - Stable workload is verified healthy.
   - A rollback deployment record is uploaded documenting the failed stage, expected digests, and deployed digests.

---

## 3. Distinction: Code-Complete CI Evidence vs. Live AWS Production Prerequisites

### Code-Complete & CI-Verified Evidence

All compute controllers, traffic adjusters, health evaluators, and rollback triggers are fully implemented and verified via automated domain and script tests:

- `deploy-workload.sh`: Registers task definitions with immutable digests, waits for ECS stability, verifies running container digests and target health.
- `verify-workload.sh`: Validates running task container digests against expected digests.
- `canary-traffic.sh`: Controls ALB listener weighted forwarding with state verification.
- `evaluate-canary-gate.sh`: Probes `/livez` and evaluates Prometheus/CloudWatch SLOs.
- `record-deployment.sh`: Records source SHA, expected/deployed digests, workload verification, and gate outcomes.
- `main.tf`: Defines ECS cluster, execution/task roles, task definitions, services, ALB, listener, target groups, CloudWatch alarm, and OIDC IAM policy.

### Live AWS Production Prerequisites

Before running `.github/workflows/production-release.yml` in live production:

- `AWS_ROLE_TO_ASSUME`: OIDC IAM role ARN (`flowdesk-production-github-actions-oidc`).
- `ECS_CLUSTER_NAME`: ECS cluster name (`flowdesk-production-cluster`).
- `ECS_CANARY_SERVICE_NAME` / `ECS_STABLE_SERVICE_NAME`: ECS service names.
- `PROD_LISTENER_ARN`: Production ALB listener ARN.
- `PROD_STABLE_TG_ARN` / `PROD_CANARY_TG_ARN`: Target group ARNs.
- `CANARY_ENDPOINT_URL`: Canary health endpoint URL (e.g. `https://canary.flowdesk.ai`).
- `PROMETHEUS_URL`: (Optional) Production Prometheus URL.
