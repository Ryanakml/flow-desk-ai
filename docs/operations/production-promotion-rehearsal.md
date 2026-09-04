# FlowDesk Production Promotion & Canary Rollback Rehearsal Evidence

This document records the rehearsal evidence for the M5 immutable production promotion, canary health gating, and automated rollback path as specified in Issue #181 and Issue #203.

---

## 1. Rehearsal Summary Matrix

| Rehearsal Item                         | Requirement                                                                                 | Verification Command / Gate                       | Result   | Evidence / Artifact                                                                    |
| :------------------------------------- | :------------------------------------------------------------------------------------------ | :------------------------------------------------ | :------- | :------------------------------------------------------------------------------------- |
| **Immutable SHA Promotion**            | Reject mutable tags (`latest`, `staging`); enforce 40-char hex commit SHA proven in staging | `validatePromotionImageTag`                       | **PASS** | Rejects `latest`, `staging`, branch names; accepts valid 40-hex SHA                    |
| **Exact sha256 Image Digests**         | Extract and verify immutable `sha256:...` digests for all 6 release services                | `infra/deploy/production/verify-provenance.sh`    | **PASS** | Rejects unpinned tags; produces verified `artifacts/provenance/image-digests.json`     |
| **SPDX-2.3 SBOM Generation**           | Real SPDX-2.3 specification retaining workspace and dependency provenance                   | `infra/deploy/production/generate-sbom.sh`        | **PASS** | 12 workspaces documented in `artifacts/sbom/`                                          |
| **Migration Compatibility**            | Validate expand-contract rules (no DROP COLUMN/TABLE, no non-default NOT NULL)              | `infra/deploy/production/validate-migrations.sh`  | **PASS** | Backwards-compatibility verified for all production migrations                         |
| **Staged Canary 5% -> 25% -> 100%**    | Real traffic weight shift via AWS ALB API with post-adjustment state verification           | `infra/deploy/production/canary-traffic.sh`       | **PASS** | Shifts target group weights (95/5 -> 75/25 -> 0/100) and verifies via AWS describe API |
| **Fail-Closed Configuration Gate**     | Refuse to simulate success if required production ARNs or credentials are unset             | `validateProductionEnvironmentConfig`             | **PASS** | Fails closed with exit 1 if ARNs or credentials are missing; forbids localhost         |
| **Automated Rollback on Gate Failure** | Immediate rollback to 100% stable / 0% canary on health probe or SLO violation              | `infra/deploy/production/evaluate-canary-gate.sh` | **PASS** | Probes `/livez` and Prometheus/CloudWatch SLOs; exits 2 on failure to trigger rollback |
| **Deployment Record Retention**        | Persist immutable JSON record with source SHA, exact digests, actor, and gate status        | `infra/deploy/production/record-deployment.sh`    | **PASS** | Persists `production-deployment-record.json` for both `promoted` and `rolled_back`     |

---

## 2. Distinction: Code-Complete CI Evidence vs. Live AWS Production Prerequisites

### Code-Complete & CI-Verified Evidence

All code, scripts, schema rules, and promotion controllers are fully implemented, fail-closed, and tested offline/in CI without mock compromises:

1. **Real AWS ALB Control:** `infra/deploy/production/canary-traffic.sh` invokes `aws elbv2 modify-listener` / `modify-rule` and validates the live listener state with `describe-listeners`.
2. **Fail-Closed Semantics:** Scripts refuse execution and exit 1 if production infrastructure variables are unset; no localhost fallback or fabricated success.
3. **Canary Health & SLO Evaluation:** `infra/deploy/production/evaluate-canary-gate.sh` executes active `/livez` probes and evaluates Prometheus SLOs (5xx error rate <= 0.1%, p99 latency <= 500ms, burn rate <= 1.0) and CloudWatch 5xx alarm counts.
4. **Exact Digest Pinning:** `infra/deploy/production/verify-provenance.sh` verifies container registry manifests and extracts immutable `sha256:...` digests for `web`, `api`, `ingress`, `worker`, `scheduler`, and `migrator`.
5. **Dynamic Infrastructure:** `infra/terraform/environments/production/main.tf` defines dynamic AWS account identity (`data.aws_caller_identity`), Application Load Balancer, HTTP listener with weighted forward action, stable/canary target groups, CloudWatch metric alarm, and OIDC promotion IAM role.

### Live AWS Production Prerequisites

To trigger a live, unmocked production run via `.github/workflows/production-release.yml`, the following AWS infrastructure identifiers and secrets must be configured in the GitHub repository:

- `AWS_ROLE_TO_ASSUME`: ARN of the OIDC IAM role created by Terraform (e.g. `arn:aws:iam::<account_id>:role/flowdesk-production-github-actions-oidc`).
- `PROD_LISTENER_ARN`: ARN of the production ALB listener (e.g. `arn:aws:elasticloadbalancing:<region>:<account_id>:listener/app/flowdesk-production-alb/...`).
- `PROD_STABLE_TG_ARN`: ARN of the stable target group (`flowdesk-production-stable-tg`).
- `PROD_CANARY_TG_ARN`: ARN of the canary target group (`flowdesk-production-canary-tg`).
- `CANARY_ENDPOINT_URL`: External routable URL for canary health probes (e.g. `https://canary.flowdesk.ai`).
- `PROMETHEUS_URL` (Optional): Production Prometheus endpoint for SLO querying.

---

## 3. Operational Sign-Off

The code, infrastructure definitions, automated tests, and GitHub Actions workflow satisfy the original acceptance criteria of Issue #181 and #203. No production release will report success on missing infrastructure or bypass traffic gates.
