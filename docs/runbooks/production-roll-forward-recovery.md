# FlowDesk Production Roll-Forward Recovery Runbook

This runbook documents the operational procedure for automated traffic rollback and roll-forward database recovery when a canary health gate or production release fails (Issue #181, #203).

---

## 1. Automated Application & Compute Rollback Principle

FlowDesk uses an **expand-contract** deployment model combined with weighted canary traffic shifting and immutable container image digest pinning on AWS ECS Fargate:

1. **Immutable Workload Deployment & Verification Before Traffic Shift:**
   - The exact immutable image digests verified in staging (`artifacts/provenance/image-digests.json`) are deployed to the canary ECS service via `infra/deploy/production/deploy-workload.sh canary`.
   - The canary service task definition pins container images strictly by `sha256:` digest (mutable tags prohibited).
   - Before any ALB traffic shift occurs, `infra/deploy/production/verify-workload.sh canary` verifies that running ECS tasks are executing the exact expected image digest and that target group health probes pass.
   - If workload deployment or digest verification fails, the release halts and **fails closed** before any customer traffic reaches the canary.

2. **Canary Traffic Progression:**
   - Application traffic is split across stable and canary target groups via AWS ALB weighted routing:
     - Initial Canary: 5% (Stable: 95%)
     - Advanced Canary: 25% (Stable: 75%)
     - Full Promotion: 100% (Stable: 0%)

3. **Canary Evaluation & Automatic Rollback:**
   - During each canary evaluation window:
     - Active health probes (`/livez`) are executed against `CANARY_ENDPOINT_URL`.
     - Prometheus / CloudWatch SLO indicators are queried:
       - 5xx Error Rate <= 0.1% (0.001)
       - p99 Latency <= 500ms
       - Error Budget Burn Rate <= 1.0
   - If ANY health probe fails or ANY SLO threshold is exceeded:
     - The workflow invokes `infra/deploy/production/canary-traffic.sh 0` to **immediately restore 100% traffic to stable**.
     - The canary ECS service is scaled down or drained, leaving stable untouched.
     - The workflow invokes `infra/deploy/production/record-deployment.sh` with `rolled_back` outcome, recording the expected vs running digests and failure stage.
     - 100% of production traffic remains served by the verified stable baseline containers without customer impact.

4. **Stable Catchup Promotion:**
   - Upon successful 100% canary evaluation, the release promotes the verified digest to the stable ECS service (`deploy-workload.sh stable`).
   - Once stable tasks are verified running the new digest and passing health checks, ALB traffic is reset to 100% stable / 0% canary (`canary-traffic.sh 0`).
   - This ensures production never permanently depends on a canary slice.

---

## 2. Roll-Forward Database Recovery Strategy

Because production databases are shared across concurrent instances during rolling upgrades, FlowDesk **strictly prohibits destructive rollbacks** (`DROP TABLE`, `DROP COLUMN`, or rolling back schema migrations).

### Why Roll-Forward?

- Rolling back database migrations can result in catastrophic data loss for records created during the canary window.
- Destructive schema alterations break running baseline application instances.

### Roll-Forward Procedure

1. **Maintain Additive Schema:** Every migration is expand-compatible (all new columns are nullable or have safe defaults). Verified by `validate-migrations.sh`.
2. **Diagnose Migration Failure:**
   ```bash
   psql "$DATABASE_URL" -c "SELECT version, name, applied_at FROM flowdesk.schema_migrations ORDER BY version DESC LIMIT 5;"
   ```
3. **Apply Remediation Patch:**
   - Author a forward-fixing migration (e.g. `0032_fix_*.sql`) that adjusts constraints or defaults without deleting data.
   - Run the remediation through the standard CI pipeline to staging first.
4. **Resubmit Promotion:**
   - Once the forward-fix migration passes CI and staging, trigger a new production release with the updated immutable SHA.

---

## 3. Emergency Manual Overrides

### 3.1 Force 100% Traffic to Stable (ALB)

If automated rollback encounters an unexpected orchestration error, the on-call engineer can immediately force 100% traffic to stable via the AWS CLI:

```bash
# AWS CLI Weighted Target Group Override (Restore 100% Stable, 0% Canary)
aws elbv2 modify-listener \
  --region "${AWS_REGION:-ap-southeast-1}" \
  --listener-arn "$PROD_LISTENER_ARN" \
  --default-actions "[{\"Type\":\"forward\",\"ForwardConfig\":{\"TargetGroups\":[{\"TargetGroupArn\":\"$PROD_STABLE_TG_ARN\",\"Weight\":100},{\"TargetGroupArn\":\"$PROD_CANARY_TG_ARN\",\"Weight\":0}]}}]"
```

### 3.2 Drain / Roll Back Canary ECS Service

If canary tasks are misbehaving or failing health checks, force the canary service desired count to 0 or roll back to the prior task definition:

```bash
# Scale canary tasks to 0
aws ecs update-service \
  --region "${AWS_REGION:-ap-southeast-1}" \
  --cluster "$PROD_ECS_CLUSTER_NAME" \
  --service "$PROD_CANARY_SERVICE_NAME" \
  --desired-count 0

# Check running task definitions and container images
aws ecs list-tasks \
  --region "${AWS_REGION:-ap-southeast-1}" \
  --cluster "$PROD_ECS_CLUSTER_NAME" \
  --service-name "$PROD_STABLE_SERVICE_NAME"
```

---

## 4. Verification Checklist

- [ ] Canary target group traffic weight confirmed at 0% via `aws elbv2 describe-listeners`.
- [ ] Stable ECS service tasks confirmed healthy via `aws ecs describe-services`.
- [ ] Stable baseline error rate < 0.01% on Grafana dashboard `flowdesk-m5-slo`.
- [ ] Production deployment record uploaded with outcome `rolled_back` (including `expectedDigests` and `deployedDigests`).
- [ ] Post-mortem issue filed with label `incident:canary-rollback`.
