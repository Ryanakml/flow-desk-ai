# FlowDesk Production Roll-Forward Recovery Runbook

This runbook documents the operational procedure for automated traffic rollback and roll-forward database recovery when a canary health gate or production release fails (Issue #181, #203).

---

## 1. Automated Application Rollback Principle

FlowDesk uses an **expand-contract** deployment model combined with weighted canary traffic shifting:

1. Application traffic is split across stable and canary target groups via AWS ALB weighted routing:
   - Initial Canary: 5% (Stable: 95%)
   - Advanced Canary: 25% (Stable: 75%)
   - Full Promotion: 100% (Stable: 0%)
2. During each canary evaluation window:
   - Active health probes (`/livez`) are executed against `CANARY_ENDPOINT_URL`.
   - Prometheus / CloudWatch SLO indicators are queried:
     - 5xx Error Rate <= 0.1% (0.001)
     - p99 Latency <= 500ms
     - Error Budget Burn Rate <= 1.0
3. If ANY health probe fails or ANY SLO threshold is exceeded:
   - The workflow invokes `infra/deploy/production/canary-traffic.sh 0` to **immediately restore 100% traffic to stable**.
   - The workflow invokes `infra/deploy/production/record-deployment.sh` with `rolled_back` outcome and logs the failed canary stage.
   - 100% of production traffic remains served by the verified stable baseline containers without customer impact.

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

## 3. Emergency Manual Traffic Override

If automated rollback encounters an unexpected orchestration error, the on-call engineer can immediately force 100% traffic to stable via the AWS CLI:

```bash
# AWS CLI Weighted Target Group Override (Restore 100% Stable, 0% Canary)
aws elbv2 modify-listener \
  --region "${AWS_REGION:-ap-southeast-1}" \
  --listener-arn "$PROD_LISTENER_ARN" \
  --default-actions "[{\"Type\":\"forward\",\"ForwardConfig\":{\"TargetGroups\":[{\"TargetGroupArn\":\"$PROD_STABLE_TG_ARN\",\"Weight\":100},{\"TargetGroupArn\":\"$PROD_CANARY_TG_ARN\",\"Weight\":0}]}}]"
```

---

## 4. Verification Checklist

- [ ] Canary target group traffic weight confirmed at 0% via `aws elbv2 describe-listeners`.
- [ ] Stable baseline error rate < 0.01% on Grafana dashboard `flowdesk-m5-slo`.
- [ ] Production deployment record uploaded with outcome `rolled_back`.
- [ ] Post-mortem issue filed with label `incident:canary-rollback`.
