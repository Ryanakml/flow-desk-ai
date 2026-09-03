# FlowDesk Provider Outage & Degraded Mode Playbook

This playbook outlines recovery procedures, safe-mode transitions, and mitigation tactics when external providers (Meta WhatsApp Cloud API, Google Gemini AI, PostgreSQL, Redis) experience degradation, rate limiting, or total outages.

---

## 1. Meta WhatsApp Cloud API Outages

### Scenario A: HTTP 429 (Rate Limit Exceeded)

- **Symptom:** Worker logs `whatsapp.dispatch_failed: HTTP 429 Too Many Requests`.
- **System Behavior:**
  - The outbox dispatcher detects 429 and applies exponential backoff with randomized jitter.
  - The outbound event remains in `flowdesk.outbox_events` with status `pending` and incremented `retry_count`.
  - Messages are NOT dead-lettered prematurely.
- **Operator Action:**
  1. Inspect `whatsapp_outbound_dispatch_total{result="failed"}`.
  2. Verify tier limit in Meta WhatsApp Business Manager (e.g. 1k -> 10k -> 100k daily messages limit).
  3. If tenant exceeded quota, reduce batch concurrency or pause bulk template campaigns.

### Scenario B: HTTP 500 / 503 (Meta Cloud API Outage)

- **Symptom:** Elevated error rates, `FlowDeskOutboxBacklogCritical` alert fires.
- **Safe Mode Transition:**
  1. Inbound messages continue to be accepted by ingress and safely stored in PostgreSQL.
  2. Outbox dispatch throttles poll interval from 500ms to 5,000ms to prevent connection thrashing.
  3. No messages are discarded; the outbox backlog will drain automatically upon Meta service restoration.
- **Recovery Verification:**
  - Watch `outbox_pending_events` drop to zero.
  - Verify idempotency keys prevent duplicate deliveries when retrying.

---

## 2. AI Provider (Gemini / LLM) Outage

### Scenario A: Gemini API 429 / 5xx / Timeout

- **Symptom:** `FlowDeskAiDraftFailureRateHigh` fires; `ai_draft_runs_total{status="failed"}` increases.
- **Safe Mode Behavior:**
  - The system fails closed for AUTO send: If an AI draft run fails or times out, AUTO cannot proceed.
  - Inbound messages are still routed to queues and agent teams with zero loss.
  - Conversations remain fully accessible for manual human agent responses in the web dashboard.
- **Operator Action:**
  1. If outage persists > 10 minutes, set tenant bot mode to `draft` or `off` to prevent unnecessary API call storms.
  2. Once Gemini status returns to green, re-enable `auto` mode.

---

## 3. Database Primary Failover / Saturation

### Scenario: DB Connection Saturation or Transient Failover

- **Symptom:** `DB Connection Pool Timeout` or `connection terminated unexpectedly`.
- **System Behavior:**
  - API and Worker pool automatically retries transient connection errors using exponential backoff.
  - Inbound webhook endpoint buffers requests if brief; if persistent, returns 503 so Meta retries the webhook.
  - No partial transactions are committed; RLS and tenant boundaries remain intact.
- **Recovery:**
  - Check AWS RDS / Aurora replica promotion.
  - Validate connection pool metrics (`pg_stat_activity`).

---

## 4. Redis Adapter Failure

### Scenario: Redis Service Crashes or Disconnects

- **Symptom:** `realtime.redis_adapter_failed` logged in API.
- **Safe Mode Behavior:**
  - Socket.IO server automatically falls back to single-node in-memory adapter (`redisRequired: false`).
  - Realtime room broadcasts continue locally on each API node.
  - Web UI clients reconnecting after connection drops automatically trigger REST reconciliation to catch up on any missed timeline events.
- **Zero Data Loss Guarantee:**
  - All durable state (messages, events, drafts, routing logs) is persisted in PostgreSQL. Redis is strictly an ephemeral pub/sub layer.
