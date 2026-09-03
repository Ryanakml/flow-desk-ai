# FlowDesk M5 SLO & Error-Budget Policy

This document defines the Service Level Objectives (SLOs), Service Level Indicators (SLIs), error budgets, and budget burn-rate escalation policies for FlowDesk M5 production operations.

---

## 1. Objectives & Indicators (SLO / SLI Matrix)

| Path / Component        | SLI Definition                                                | SLO Target (30-day rolling) | Latency / Lag Target      |
| :---------------------- | :------------------------------------------------------------ | :-------------------------- | :------------------------ |
| **API Availability**    | Successful non-5xx requests / total requests                  | **99.9%**                   | p95 < 200ms               |
| **Inbound Webhook**     | Successful (2xx) webhook processing / total received webhooks | **99.9%**                   | **p99 < 500ms**           |
| **Outbox Queue Lag**    | Messages dispatched within 5s of creation / total dispatched  | **99.9%**                   | **Oldest event age < 5s** |
| **Outbound Dispatch**   | Successful provider handoff / total outbound messages         | **99.9%**                   | Provider dispatch < 2s    |
| **AI Draft Generation** | Grounded draft runs completed / total draft runs enqueued     | **95.0%**                   | p95 < 10.0s               |
| **AUTO-Send Safety**    | Flawless auto-send decisions / total auto-send evaluations    | **99.9%**                   | Zero unauthorized sends   |

---

## 2. Error Budget Calculation

For a 30-day window ($30 \times 24 \times 60 = 43,200\text{ minutes}$):

- **99.9% SLO** yields an error budget of **0.1%** (43.2 minutes of equivalent full downtime, or 1 failed event per 1,000 events).
- **95.0% AI SLO** yields an error budget of **5.0%** (2,160 minutes equivalent downtime, or 1 failed draft per 20 requests).

---

## 3. Burn Rate Alerting Policy

We alert on multi-window multi-burn-rate consumption to distinguish rapid catastrophic outages from slow erosions.

| Severity | Time Window  | Burn Rate Multiplier | % Budget Consumed | Action / Escalation                                           |
| :------- | :----------- | :------------------- | :---------------- | :------------------------------------------------------------ |
| **P1**   | **1 hour**   | **14.4x**            | 2.0% in 1h        | Page on-call immediately; engage Incident Commander.          |
| **P1**   | **6 hours**  | **6.0x**             | 5.0% in 6h        | Page on-call; evaluate emergency stop if AUTO affected.       |
| **P2**   | **24 hours** | **3.0x**             | 10.0% in 24h      | Ticket assigned to component owner; investigate next morning. |
| **P3**   | **3 days**   | **1.0x**             | 10.0% in 3d       | Review during weekly reliability triage meeting.              |

---

## 4. Error Budget Policy & Deployment Gates

1. **Green Budget (> 50% remaining)**: Normal release cadence, automated promotions, and canary releases proceed without restriction.
2. **Yellow Budget (20% - 50% remaining)**: Non-critical feature launches require VP Engineering approval. All production changes must include dedicated reliability verification.
3. **Red Budget (< 20% remaining)**: **Deployment Freeze** on new features. Engineering capacity shifts 100% to reliability fixes, bug remediation, and infrastructure hardening.
4. **Exhausted Budget (0% remaining)**: Strict freeze. Only P1 emergency hotfixes and security patches permitted until the rolling 30-day budget recovers above 20%.

---

## 5. Metrics & Dashboard References

- **Prometheus Metrics**:
  - Webhook Latency: `http_request_duration_seconds_bucket{route="/api/v1/webhooks/whatsapp"}`
  - Webhook Error Rate: `whatsapp_webhook_processed_total{result="failed"}`
  - Outbox Lag: `outbox_oldest_event_age_seconds` and `outbox_pending_events`
  - AUTO-Send Outcome: `auto_send_total` and `auto_send_failures_total`
  - Emergency Killswitch: `emergency_killswitch_active`
- **Grafana Dashboard**: UID `flowdesk-m5-slo` ([m5_slo_dashboard.json](file:///infra/monitoring/grafana/provisioning/dashboards/m5_slo_dashboard.json)).
