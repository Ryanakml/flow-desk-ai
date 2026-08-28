# Operational Runbook: WhatsApp Outbox & Dead-Letter Queue (DLQ)

- **Service:** `@flowdesk/worker`, `@flowdesk/api`, `@flowdesk/db`
- **Ownership:** Engineering & SRE (`@Ryanakml`)
- **Severity Tier:** Tier 1 (Critical Customer Messaging Pipeline)
- **Last Updated:** 2026-08-28

---

## 1. Overview & Architecture

FlowDesk uses the **Transactional Outbox Pattern** to decouple operator API message creation from external WhatsApp Meta Cloud API HTTP calls. This architecture guarantees:

- **Durable, duplicate-safe dispatch**: A committed `dispatching` intent surrounds the external provider call. Safe classified failures can retry; an interruption or ambiguous response becomes `reconcile_required` and is never blindly resent.
- **Strict Isolation**: Outbox claims execute under tenant Row-Level Security (`SET LOCAL app.organization_id = ...`).
- **Zero Poison-Pill Blocking**: Exhausted or terminal failures transition to a Dead-Letter Queue (DLQ) state, preventing one tenant's failing messages from stalling the global dispatch pipeline.

```mermaid
sequenceDiagram
    autonumber
    actor Operator as Agent / Operator
    participant API as @flowdesk/api
    participant DB as PostgreSQL (flowdesk)
    participant Worker as @flowdesk/worker
    participant Meta as Meta WhatsApp Cloud API

    Operator->>API: POST /api/v1/organizations/:orgId/conversations/:id/messages
    Note over API,DB: Single DB Transaction
    API->>DB: INSERT INTO messages (status = 'queued')
    API->>DB: INSERT INTO outbox_events (event_type = 'message.outbound.created')
    DB-->>API: 201 Created (Message)
    API-->>Operator: Render message in 'queued' ⏱

    loop Polling Loop (every 500ms)
        Worker->>DB: Claim unpublished outbox events (SKIP LOCKED)
        DB-->>Worker: Batch of claimed events
        Worker->>DB: SET LOCAL app.organization_id = event.orgId
        Worker->>DB: Decrypt channel credentials (AES-256-GCM)
        Worker->>DB: COMMIT outbound_intents.state = 'dispatching'
        Worker->>Meta: POST /v21.0/:phoneNumberId/messages
        alt Success (200 OK)
            Meta-->>Worker: { messages: [{ id: "wamid..." }] }
            Worker->>DB: UPDATE messages SET status = 'sent', provider_message_id = 'wamid...'
            Worker->>DB: UPDATE outbox_events SET published_at = clock_timestamp()
        else Transient Failure (429 / 503 / Timeout)
            Worker->>DB: UPDATE outbox_events SET attempts = attempts + 1, last_error = ...
            Note over Worker,DB: Event remains unpublished for backoff retry
        else Terminal Failure / Exhaustion (attempts >= 5)
            Worker->>DB: UPDATE messages SET status = 'failed', error_detail = ...
            Worker->>DB: UPDATE outbox_events SET published_at = clock_timestamp() (DLQ)
        else Worker interruption / ambiguous provider response
            Worker->>DB: UPDATE outbound_intents SET state = 'reconcile_required'
            Note over Worker,DB: Do not resend until provider outcome is manually reconciled
        end
    end
```

---

## 2. Failure Classification Matrix

| Error Type                           | Category     | HTTP / Provider Code                  | Worker Behavior                                         | Operator Impact                            |
| :----------------------------------- | :----------- | :------------------------------------ | :------------------------------------------------------ | :----------------------------------------- |
| **Rate Limit Exceeded**              | `TRANSIENT`  | `429 Too Many Requests`               | Increments `attempts`; retries with exponential backoff | Message remains `queued` ⏱ until sent      |
| **Explicit provider 5xx**            | `TRANSIENT`  | `500 / 502 / 503 / 504`               | Increments `attempts`; retries with exponential backoff | Message remains `queued` ⏱ until sent      |
| **Network loss / malformed success** | `AMBIGUOUS`  | Timeout, reset, or missing message ID | Marks intent `reconcile_required`; does not auto-resend | Support verifies provider outcome          |
| **Expired WhatsApp Access Token**    | `TERMINAL`   | `190 (OAuthException)`                | Marks event published, sets message `status = 'failed'` | Message displays ⚠️ failed with auth error |
| **Invalid Customer Phone Number**    | `TERMINAL`   | `131026 (Message Undeliverable)`      | Marks event published, sets message `status = 'failed'` | Message displays ⚠️ undeliverable          |
| **Customer Opted Out / Blocked**     | `TERMINAL`   | `131030 (Recipient Cannot Receive)`   | Marks event published, sets message `status = 'failed'` | Message displays ⚠️ opted out              |
| **Max Retries Exhausted (>= 5)**     | `EXHAUSTION` | Any repetitive error                  | Dead-letters event, sets message `status = 'failed'`    | Message displays ⚠️ retry exhausted        |

---

## 3. Monitoring & Diagnostic Queries

Connect via `psql` to the primary database (`DATABASE_URL`) or inspect via Grafana.

### 3.1. Check Current Outbox Lag & Backlog Size

```sql
SELECT
    count(*) AS pending_events,
    min(occurred_at) AS oldest_pending_event,
    avg(attempts) AS average_attempts
FROM flowdesk.outbox_events
WHERE published_at IS NULL;
```

- **Normal State:** `pending_events` < 100, `oldest_pending_event` < 5 seconds old.
- **Alert State:** `pending_events` > 500 or `oldest_pending_event` > 60 seconds old.

### 3.2. List Actively Retrying Events (High Attempt Count)

```sql
SELECT
    id,
    organization_id,
    aggregate_id AS message_id,
    attempts,
    last_error,
    occurred_at
FROM flowdesk.outbox_events
WHERE published_at IS NULL AND attempts > 0
ORDER BY attempts DESC, occurred_at ASC
LIMIT 25;
```

### 3.3. Review Recent Dead-Lettered Messages (Last 24 Hours)

```sql
SELECT
    m.id AS message_id,
    m.organization_id,
    c.customer_phone,
    m.content,
    m.error_detail,
    m.updated_at
FROM flowdesk.messages m
JOIN flowdesk.conversations c ON c.id = m.conversation_id
WHERE m.status = 'failed'
  AND m.updated_at > now() - INTERVAL '24 hours'
ORDER BY m.updated_at DESC
LIMIT 50;
```

### 3.4. Review Dispatches Requiring Reconciliation

```sql
SELECT message_id, organization_id, attempt_count, claimed_at, last_error, updated_at
FROM flowdesk.outbound_intents
WHERE state = 'reconcile_required'
ORDER BY updated_at ASC;
```

Never reset these rows for replay until Meta delivery evidence confirms that the original request was not accepted. Record the support ticket through the documented break-glass procedure before cross-tenant inspection or mutation.

---

## 4. Remediation Procedures

### Procedure 4.1: Replaying Dead-Lettered Messages After Downstream Outage

When Meta WhatsApp API recovers from an outage and you need to replay messages that exhausted retries:

1. **Verify Outage Resolution**: Use the provider sandbox/test sender and confirm Meta accepts a synthetic message. FlowDesk does not expose an unaudited channel-ping endpoint.
2. **Open an Audited Support Session**: Record the ticket and reason with `pnpm db:break-glass`; use the environment's controlled break-glass connection for the approved tenant only.
3. **Re-enqueue Dead-Lettered Events**: Execute the following transaction with the approved organization and message IDs:

```sql
BEGIN;
-- Select target messages to re-enqueue
UPDATE flowdesk.messages
SET status = 'queued',
    error_detail = NULL,
    updated_at = clock_timestamp()
WHERE id IN ('<message_id_1>', '<message_id_2>')
  AND organization_id = '<organization_id>'
  AND status = 'failed';

-- Reset corresponding outbox events for immediate worker pickup
UPDATE flowdesk.outbox_events
SET published_at = NULL,
    dead_lettered_at = NULL,
    claimed_until = NULL,
    claim_token = NULL,
    available_at = clock_timestamp(),
    attempts = 0,
    last_error = NULL,
    occurred_at = clock_timestamp()
WHERE aggregate_id IN ('<message_id_1>', '<message_id_2>')
  AND organization_id = '<organization_id>'
  AND event_type = 'message.outbound.created';
COMMIT;
```

4. **Verify Worker Processing**: Run query 3.1 to verify `pending_events` decreases to 0 and attach before/after evidence to the ticket.

### Procedure 4.2: Rotating Expired Meta WhatsApp Cloud API Access Tokens

If messages fail with `OAuthException` (Code `190`):

1. Generate a new System User Permanent Access Token in the Meta Business Manager.
2. Encrypt the new access token with the environment's master `CHANNEL_ENCRYPTION_KEY`:
   ```bash
   node -e "
     import { encryptSecret } from '@flowdesk/security';
     const token = process.argv[1];
     const key = process.env.CHANNEL_ENCRYPTION_KEY;
     console.log(JSON.stringify(encryptSecret(token, key)));
   " "EAAG..."
   ```
3. Update the channel record:
   ```sql
   UPDATE flowdesk.channels
   SET encrypted_credentials = '<encrypted_json_envelope>',
       status = 'active',
       status_reason = NULL,
       updated_at = clock_timestamp()
   WHERE id = '<channel_id>';
   ```
4. Follow **Procedure 4.1** to replay failed messages for that channel.

---

## 5. Key Metrics & Alerting Thresholds

| Metric                                              | Target | Warning Threshold | Critical Threshold |
| :-------------------------------------------------- | :----- | :---------------- | :----------------- |
| `outbox_pending_events`                             | 0 - 50 | > 200 for 2 min   | > 1,000 for 5 min  |
| `outbox_oldest_event_age_seconds`                   | < 2s   | > 30s             | > 120s             |
| `whatsapp_webhook_processed_total{result="failed"}` | 0      | > 0.1/s for 5 min | sustained increase |
| `outbox_dead_letter_events`                         | 0      | > 0 for 2 min     | sustained increase |

---

## 6. Data Classification & Retention Baseline

| Data                                           | Classification                     | M2 Handling                                                                | Retention Decision                                                                              |
| :--------------------------------------------- | :--------------------------------- | :------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------- |
| Raw signed webhook payload                     | Restricted customer communications | Tenant RLS; no logs/telemetry; support access requires audited break-glass | Keep only for the tenant's configured messaging-retention window; legal hold overrides deletion |
| Messages, contacts, and lifecycle events       | Confidential tenant data           | Tenant transaction + FORCE RLS                                             | Tenant policy; deletion/export automation is expanded in later data-lifecycle milestones        |
| Payload hash, correlation ID, queue timestamps | Internal operational metadata      | Metrics use aggregates only                                                | Keep long enough for deduplication, incident review, and the contracted audit window            |
| Provider credentials                           | Secret                             | AES-256-GCM application envelope; never emitted to logs                    | Rotate on compromise/expiry; remove when channel is disconnected and retention permits          |

Until an automated retention job is released, any approved purge is a ticketed, tenant-scoped break-glass change with a backup/restore check and before/after row counts. Raw payloads must never be copied into tickets, fixtures, logs, or telemetry.
