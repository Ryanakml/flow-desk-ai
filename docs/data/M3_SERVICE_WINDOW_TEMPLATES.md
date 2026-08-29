# WhatsApp 24-Hour Customer Service Window & Template Messaging Specification

## 1. Overview

Under Meta's WhatsApp Business Platform policy, businesses can exchange free-form text and media messages with customers **only within an active 24-hour customer service window**.

A customer service window opens or refreshes whenever an **inbound message from a customer** is received. Once 24 hours have elapsed without a customer inbound message:

- Free-form messages are strictly prohibited by WhatsApp (Meta error `131047`).
- Outbound messages to the customer can **only** be initiated using **Meta-approved WhatsApp message templates**.

This document outlines the architecture, database schema, domain rules, API contracts, worker safeguards, and UI behaviors implementing this capability (`TPL-ELIG-001`).

---

## 2. Customer Service Window Rules & Calculation

### 2.1 Formula & Clock Boundaries

- **Inbound Trigger:** Whenever an inbound customer message (`direction = 'inbound' AND sender_type = 'customer'`) arrives, `flowdesk.conversations.last_inbound_at` is updated to the message creation time.
- **Window Expiry:**
  $$\text{expiresAt} = \text{lastInboundAt} + 24\text{ hours}$$
- **Window Eligibility:**
  - $\text{now} < \text{expiresAt} \implies$ `isOpen = true` (Free-form text messages and approved templates are both permitted).
  - $\text{now} \ge \text{expiresAt} \lor \text{lastInboundAt is null} \implies$ `isOpen = false` (Free-form messages are rejected; only approved templates are permitted).

### 2.2 Boundary Test Cases

The domain function `calculateServiceWindow(lastInboundAt, now)` in `@flowdesk/domain` validates exact second boundaries:

1. `lastInboundAt == null` $\implies$ `isOpen: false`, `expiresAt: null`, `remainingSeconds: 0`.
2. `now == lastInboundAt + 23h 59m 59s` $\implies$ `isOpen: true`, `remainingSeconds: 1`.
3. `now == lastInboundAt + 24h 00m 00s` $\implies$ `isOpen: false`, `remainingSeconds: 0`.
4. `now == lastInboundAt + 24h 00m 01s` $\implies$ `isOpen: false`, `remainingSeconds: 0`.

---

## 3. Database Layer

### 3.1 Migration `0014_m3_service_window.sql`

```sql
ALTER TABLE flowdesk.conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;

-- Backfill from latest customer inbound message
UPDATE flowdesk.conversations c
SET last_inbound_at = m.latest_inbound
FROM (
  SELECT conversation_id, MAX(created_at) AS latest_inbound
  FROM flowdesk.messages
  WHERE direction = 'inbound' AND sender_type = 'customer'
  GROUP BY conversation_id
) m
WHERE c.id = m.conversation_id
  AND c.last_inbound_at IS NULL;

-- Index for organization and last_inbound_at filtering
CREATE INDEX IF NOT EXISTS conversations_org_last_inbound_idx
  ON flowdesk.conversations (organization_id, last_inbound_at DESC NULLS LAST);
```

### 3.2 Transactional Outbox Integration

When a template message is queued via `createOutboundMessageWithOutbox`, the rendered body is saved to `flowdesk.messages.content`, and the template metadata is recorded into the outbox event payload:

```json
{
  "messageId": "msg-uuid",
  "conversationId": "conv-uuid",
  "channelId": "chan-uuid",
  "content": "Halo Budi, pesanan ORD-123 Anda sedang diproses.",
  "template": {
    "name": "order_update",
    "language": "id",
    "versionId": "ver-uuid",
    "variables": { "1": "Budi", "2": "ORD-123" },
    "renderedPayloadHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }
}
```

---

## 4. Double Verification Architecture (API + Worker)

To prevent sending revoked or rejected templates when there is a delay between queuing and dispatching:

```
[Agent Browser / API Client]
       |
       | POST /conversations/:id/messages
       v
+-------------------------------------------------------+
| Barrier 1: API Endpoint (Pre-queue Validation)       |
| 1. Check conversation.serviceWindow                   |
| 2. If freeform and !isOpen -> 422 OUTSIDE_SERVICE_WIN |
| 3. If template:                                       |
|    - Fetch template record for channel                |
|    - Check version.status === "APPROVED"              |
|    - Validate positional variables ({{1}}, {{2}})     |
|    - Render text and compute deterministic SHA-256    |
|    - Write message + outbox event in single tx        |
+-------------------------------------------------------+
       |
       | PostgreSQL transactional outbox
       v
+-------------------------------------------------------+
| Barrier 2: Worker Dispatcher (Pre-send Verification) |
| 1. Lease outbox event (SKIP LOCKED)                   |
| 2. If payload has template:                           |
|    - Query DB for template status                     |
|    - If status != 'APPROVED':                         |
|        Mark message and outbox failed (terminal)      |
|        ABORT SEND                                     |
| 3. Call provider.sendTemplateMessage()                |
| 4. Record sent timestamp and provider message ID      |
+-------------------------------------------------------+
       |
       v
[Meta WhatsApp Graph API / FakeProvider]
```

---

## 5. Parameter Substitution & Deterministic Hashing

- **Placeholder Format:** Standard 1-indexed numbers: `{{1}}`, `{{2}}`.
- **Validation:**
  - If a template has $N$ distinct variable placeholders, all keys `"1"` through `"N"` must be non-empty strings.
  - Unexpected or extra keys outside the expected range are rejected.
- **Rendering:**
  - `renderTemplateText(text, variables)` performs exact string substitution.
- **Deterministic Payload Hash:**
  - A SHA-256 hash is computed over the normalized rendered components (header, body, buttons) using a stable JSON representation.
  - Stored as `renderedPayloadHash` in message metadata and outbox payload for tamper detection and auditability.

---

## 6. API Endpoints

### 6.1 `POST /api/v1/organizations/:orgId/conversations/:id/messages`

- Accepts either free-form text or template payload.
- Free-form outside 24h window returns `422 Unprocessable Entity`:
  ```json
  {
    "type": "https://flowdesk.dev/problems/outside-service-window",
    "title": "Outside Customer Service Window",
    "status": 422,
    "code": "OUTSIDE_SERVICE_WINDOW",
    "detail": "Cannot send free-form message outside 24-hour service window. Please select an approved WhatsApp template."
  }
  ```
- Unapproved template returns `422 TEMPLATE_NOT_APPROVED`.
- Missing variables return `422 INVALID_TEMPLATE_VARIABLES`.

### 6.2 `POST /api/v1/organizations/:orgId/conversations/:id/template-preview`

- Validates variables and returns rendered body, header, eligibility, and deterministic hash prior to sending.

### 6.3 `GET /api/v1/organizations/:orgId/conversations/:id/templates`

- Lists available templates for the conversation's channel, including components and variable counts, allowing dynamic composer rendering.

---

## 7. Operator Inbox UX Safeguards

1. **Header Badge:** Displays real-time status:
   - `⏱️ 24h Window Active` (green) when open.
   - `⚠️ 24h Window Expired` (yellow/amber) when closed.
2. **Composer Lockout:** When the window is expired, the free-form textarea is replaced with a warning callout banner and a prominent **"Select WhatsApp Template"** button.
3. **Template Composer Modal:**
   - Dropdown of approved templates.
   - Auto-generated variable input fields for each placeholder.
   - Live rendered preview showing header, body, and WhatsApp chat bubble preview.
   - Strict validation preventing submission until all parameters are supplied and verified.
