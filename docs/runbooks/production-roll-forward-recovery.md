# FlowDesk Production Roll-Forward Recovery Runbook

This runbook documents the operational procedure for automated traffic rollback and roll-forward database recovery when a canary health gate or production release fails.

---

## 1. Automated Application Rollback Principle

FlowDesk uses an **expand-contract** deployment model:

1. Application traffic is split using weighted canary routing (5% -> 25% -> 100%).
2. If any health probe fails (/livez 5xx or timeout) or Prometheus SLO error rate exceeds 0.1%, traffic is **automatically and immediately returned to 0%** on the canary.
3. 100% of production traffic remains served by the verified stable baseline containers.
4. The canary containers are cleanly de-provisioned.

---

## 2. Roll-Forward Database Recovery Strategy

Because production databases are shared across concurrent instances during rolling upgrades, FlowDesk **strictly prohibits destructive rollbacks** (`DROP TABLE`, `DROP COLUMN`, or rolling back schema migrations).

### Why Roll-Forward?

- Rolling back database migrations can result in catastrophic data loss for records created during the canary window.
- Destructive schema alterations break running baseline application instances.

### Roll-Forward Procedure

1. **Maintain Additive Schema:** Every migration is expand-compatible (all new columns are nullable or have safe defaults).
2. **Diagnose Migration Failure:**
   ```bash
   # Connect to read-only replica or staging clone to inspect schema state
   psql "$DATABASE_URL" -c "SELECT version, name, applied_at FROM flowdesk.schema_migrations ORDER BY version DESC LIMIT 5;"
   ```
3. **Apply Remediation Patch:**
   - Author a forward-fixing migration (e.g. `0030_fix_*.sql`) that adjusts constraints without deleting data.
   - Run the remediation through the standard CI pipeline to staging first.
4. **Resubmit Promotion:**
   - Once the forward-fix migration passes CI and staging, trigger a new production release with the updated SHA.

---

## 3. Emergency Manual Traffic Override

If automated rollback encounters an orchestration error, the on-call engineer can immediately force 100% traffic to stable via CLI:

```bash
# AWS CLI Weighted Target Group Override
aws elbv2 modify-listener \
  --listener-arn "$PROD_LISTENER_ARN" \
  --default-actions Type=forward,ForwardConfig='{TargetGroups=[{TargetGroupArn="'$STABLE_TG_ARN'",Weight=100},{TargetGroupArn="'$CANARY_TG_ARN'",Weight=0}]}'

# Or Single-Host Caddy/Nginx Override
ssh "$PROD_HOST" "/opt/flowdesk/releases/production/canary-traffic.sh 0"
```

---

## 4. Verification Checklist

- [ ] Canary target group traffic weight confirmed at 0%.
- [ ] Stable baseline error rate < 0.01% on Grafana dashboard `flowdesk-m5-slo`.
- [ ] Post-mortem issue created with label `incident:canary-rollback`.
