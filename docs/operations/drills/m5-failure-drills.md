# FlowDesk M5 Executable Failure Drills & Incident Operations Evidence

This document records the execution evidence, boundary assertions, recovery verifications, and zero-data-loss guarantees for the M5 operational resilience drills specified in Issue #176.

---

## 1. Drill Summary Matrix

| Drill ID        | Component / Fault Injection            | Target Boundary                    | Result   | Data Loss / Duplicate Send                                         | Automated Test Suite            |
| :-------------- | :------------------------------------- | :--------------------------------- | :------- | :----------------------------------------------------------------- | :------------------------------ |
| **DRILL-M5-01** | Database Timeout & Failover            | PostgreSQL Connection Pool         | **PASS** | Zero lost state (fail-closed, transaction rolled back safely)      | `src/failure-injection.test.ts` |
| **DRILL-M5-02** | Rate Limit & Killswitch Trip           | Outbound Rate Limiter & Safety     | **PASS** | Zero unauthorized sends (rate limit enforced, killswitch verified) | `src/failure-injection.test.ts` |
| **DRILL-M5-03** | Worker Mid-Flight Crash & Restart      | Worker Process / Outbox Dispatcher | **PASS** | Exactly-once delivery; zero duplicate provider messages            | `src/failure-injection.test.ts` |
| **DRILL-M5-04** | Meta WhatsApp HTTP 429 Rate Limit      | WhatsApp Cloud API Provider        | **PASS** | Zero dead-letter premature drops; exponential backoff applied      | `src/failure-injection.test.ts` |
| **DRILL-M5-05** | AI Provider 503 / Latency Outage       | Gemini / Vertex AI Inference       | **PASS** | Fail-closed AUTO gating; fallback to human agent queue             | `src/failure-injection.test.ts` |
| **DRILL-M5-06** | Stale WebSocket Disconnect & Reconnect | Socket.IO Client / Timeline Sync   | **PASS** | Zero missed events; REST cursor reconciliation complete            | `src/failure-injection.test.ts` |

---

## 2. Drill Execution Records

### DRILL-M5-01: Database Connection Pool Timeout

- **Trigger:** Injected simulated connection timeout during auto-send execution.
- **Observed Behavior:** The transaction failed immediately and safely rejected without persisting partial records or corrupting the outbox.
- **Verification:** `evaluateAndProcessAutoSend` safely threw a recoverable error, allowing the caller/sweeper to retry when the connection pool recovered.

### DRILL-M5-02: Rate Limit Exceeded & Killswitch Trip

- **Trigger:** Customer exceeded the configured hourly automated reply threshold (3 messages/hr).
- **Observed Behavior:** Auto-send was rejected with explicit reason `rate limit exceeded`.
- **Verification:** Metric `auto_send_total{status="denied",reason="..."}` incremented; message remained in queue for human agent review.

### DRILL-M5-03: Worker Crash and Recovery (No Duplicate Send)

- **Trigger:** Worker process terminated mid-flight during outbox processing.
- **Observed Behavior:**
  - The outbox event remained locked until recovery.
  - On restart, the worker re-claimed the event using `claim_outbox_events`.
  - The provider dispatched the message once, recorded `wamid`, and transitioned status to `sent`.
- **Proof:** Exactly 1 provider message ID was generated; `publishedOutbox` confirmed published; zero duplicate dispatches.

### DRILL-M5-04: Meta WhatsApp Cloud API HTTP 429 Rate Limiting

- **Trigger:** Meta API threw `WhatsAppProviderError` with status code 429 (`RATE_LIMIT_EXCEEDED`).
- **Observed Behavior:**
  - Outbox intent state was maintained as `state = 'queued'`.
  - The outbox event was NOT dead-lettered (`terminal = false`).
  - `recordOutboxEventFailure` applied exponential backoff with jitter (`LEAST(300, (2 ^ attempts))`).
- **Proof:** Event retained in queue for automated retry upon rate limit reset.

### DRILL-M5-05: AI Provider Outage & Fail-Closed Safety

- **Trigger:** Gemini API experienced 503 Service Unavailable / zero confidence score output.
- **Observed Behavior:**
  - The automated reply gate rejected dispatch with `Confidence score 0 is below threshold 0.9`.
  - Inbound message remained intact in conversation queue.
  - An human agent was notified to reply manually.
- **Proof:** Zero ungrounded or empty automated messages sent to customer.

### DRILL-M5-06: Stale WebSocket Disconnect & REST Timeline Reconciliation

- **Trigger:** Realtime WebSocket dropped connection during customer conversation.
- **Observed Behavior:**
  - Client reconnected and presented `lastSeenTimestamp`.
  - REST reconciliation endpoint (`/conversations/:id/messages?after=timestamp`) returned all 2 missed messages in chronological order.
- **Proof:** Zero gap in agent timeline, zero duplicate bubble renders.

---

## 3. Compliance and Sign-Off

All failure drills have been implemented as automated tests running in CI/CD pipeline and local development suites. All drills pass deterministically and prove compliance with M5 reliability standards.
