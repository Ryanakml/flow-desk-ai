# M2 WhatsApp Inbound-to-Agent Vertical Slice Backlog

- Milestone owner: `@Ryanakml`
- Engineering owner: `@Ryanakml`
- Acceptance owners: product owner for conversation experience; independent security reviewer for webhook and credential boundary
- Entry dependency: M1 evidence packet accepted and all M1 gates passed
- Exit proof: sandbox WhatsApp webhook processed, isolated conversation created, agent replies, and delivery traced
- Review status: execution-ready decomposition; assignees/reviewers confirmed before work starts

---

## Epic M2-E1 — Channel Model & Connection Lifecycle

### M2-01 — Establish channel schema, encrypted credential storage, and connection state machine

- **Outcome:** multi-tenant channel definitions exist with encrypted credentials and verifiable connection states.
- **Depends on:** M1-09.
- **Scope:** `flowdesk.channels` table; AES-256-GCM envelope encryption for Meta access tokens and webhook verify secrets; state machine `DRAFT → CONNECTING → ACTIVE | DEGRADED | DISCONNECTED`; tenant isolation RLS policy.
- **Acceptance:** channel creation stores encrypted credentials; invalid state transitions are rejected; non-owner/non-admin roles cannot access secrets; RLS enforces organization boundary.
- **Design:** envelope encryption key derived from environment secret; credentials decrypted only in memory during provider dispatch.
- **Cross-cutting:** CI `update`; tests `new`; security `new`; data `new`; docs `update`.
- **Delivery:** forward migration; safe to roll forward.
- **Evidence:** SQL migration fixtures, state machine unit tests, AES-GCM round-trip encryption tests.
- **Owners:** engineering `@Ryanakml`.

### M2-02 — Implement Meta WhatsApp Cloud API provider adapter contract & fake adapter

- **Outcome:** strongly typed provider adapter interface enables local testing and real Meta Cloud API dispatch.
- **Depends on:** M2-01.
- **Scope:** `WhatsAppProvider` contract in `@flowdesk/providers`; official Graph API v21.0 message sending; deterministic `FakeWhatsAppProvider` for testing without network calls.
- **Acceptance:** provider sends text messages; handles 4xx/5xx errors and rate limits; fake adapter records outbound calls and simulates delivery/read webhooks.
- **Design:** dependency injection via interface; no hardcoded API keys.
- **Cross-cutting:** tests `new`; observability `update`; docs `update`.
- **Delivery:** library package update in `@flowdesk/providers`.
- **Evidence:** adapter unit tests, mock server tests, error classification tests.
- **Owners:** engineering `@Ryanakml`.

---

## Epic M2-E2 — Durable WhatsApp Ingress Boundary

### M2-03 — Deliver raw-body webhook ingress route and constant-time HMAC-SHA256 signature verification

- **Outcome:** incoming Meta webhook callbacks are verified before any payload processing.
- **Depends on:** M2-01.
- **Scope:** `GET /webhooks/whatsapp` (hub.mode, hub.challenge, hub.verify_token); `POST /webhooks/whatsapp` in `apps/ingress`; constant-time comparison of `X-Hub-Signature-256`.
- **Acceptance:** valid signatures return HTTP 200; invalid/tampered signatures return HTTP 401/403 immediately; challenge endpoint verifies correctly.
- **Design:** raw body captured prior to JSON parsing; constant-time buffer comparison protects against timing attacks.
- **Cross-cutting:** CI/tests/security `new`; docs `update`.
- **Delivery:** ingress router in `apps/ingress`.
- **Evidence:** signature verification test suite (valid, forged, expired, malformed).
- **Owners:** engineering `@Ryanakml`.

### M2-04 — Implement durable webhook event persistence and SHA-256 de-duplication

- **Outcome:** webhooks are durably buffered in the database before acknowledging receipt to Meta.
- **Depends on:** M2-03.
- **Scope:** `flowdesk.webhook_events` table; payload SHA-256 de-duplication; status tracking (`received`, `processing`, `processed`, `failed`); transactional outbox record creation.
- **Acceptance:** identical webhook delivers exactly one database record; acknowledgment happens only after durable commit; failed commits trigger retryable 5xx.
- **Design:** deduplication key `(provider, payload_hash)`; transactional outbox decouples ingress from background worker.
- **Cross-cutting:** data `new`; observability `new`; tests `new`.
- **Delivery:** database migration and ingress persistence logic.
- **Evidence:** deduplication test suite, database failure simulation tests.
- **Owners:** engineering `@Ryanakml`.

---

## Epic M2-E3 — Message Domain & Async Processing Pipeline

### M2-05 — Define message domain tables, conversation state machine, and RLS policies

- **Outcome:** normalized schema for contacts, conversations, messages, and timeline events exists under strict RLS.
- **Depends on:** M2-04.
- **Scope:** `flowdesk.contacts`, `flowdesk.conversations`, `flowdesk.messages`, `flowdesk.message_status_events`, `flowdesk.conversation_events`, `flowdesk.outbound_intents`; conversation state machine (`OPEN`, `WAITING`, `RESOLVED`); optimistic locking (`version`).
- **Acceptance:** tenant isolation RLS on all tables; conversation status transitions enforce domain rules; optimistic concurrency prevents lost updates.
- **Design:** normalized WhatsApp message format; compound indexes on `(organization_id, conversation_id, created_at)`.
- **Cross-cutting:** data `new`; domain `new`; tests `new`.
- **Delivery:** expand migration.
- **Evidence:** schema integration tests, RLS tenant isolation tests.
- **Owners:** engineering `@Ryanakml`.

### M2-06 — Implement worker message normalization and conversation matching pipeline

- **Outcome:** background worker consumes webhook outbox events, updates contacts, and matches or creates conversations.
- **Depends on:** M2-05.
- **Scope:** `apps/worker` pipeline: parse WhatsApp payload; match contact by E.164 phone number; find or open conversation; insert message and audit event in a single atomic transaction.
- **Acceptance:** incoming message appears in conversation thread; 100 identical replayed webhooks yield exactly 1 message; out-of-order statuses reconcile safely.
- **Design:** idempotent transaction handling; optimistic lock retries.
- **Cross-cutting:** worker `update`; observability `update`; tests `new`.
- **Delivery:** worker process execution.
- **Evidence:** pipeline unit and integration tests, crash-recovery tests.
- **Owners:** engineering `@Ryanakml`.

---

## Epic M2-E4 — Operator UI & Outbound Reply Slice

### M2-07 — Deliver conversation API with optimistic concurrency and outbound intent creation

- **Outcome:** authorized agents can query conversations, view message history, and submit replies.
- **Depends on:** M2-06.
- **Scope:** `GET /api/v1/conversations`, `GET /api/v1/conversations/:id/messages`, `POST /api/v1/conversations/:id/messages`; capability check `conversation:reply`; create `flowdesk.outbound_intents` with idempotency.
- **Acceptance:** cursor pagination on messages; optimistic concurrency conflict (409) if conversation version changed; returns 201 with intent ID.
- **Design:** API creates intent instead of making synchronous external provider call.
- **Cross-cutting:** api `update`; contracts `update`; tests `new`.
- **Delivery:** API endpoints and updated OpenAPI contract.
- **Evidence:** Supertest suite, idempotency replay tests.
- **Owners:** engineering `@Ryanakml`.

### M2-08 — Implement outbound dispatch worker with provider status reconciliation

- **Outcome:** outbound intents are claimed, transmitted via WhatsApp API, and traced through delivery/read status.
- **Depends on:** M2-07, M2-02.
- **Scope:** `apps/worker` intent claimer; dispatch to WhatsApp provider; update intent status (`sent`, `failed`, `delivered`, `read`); classified retry on transient errors.
- **Acceptance:** claimed intents dispatch once; provider message ID linked; status transitions recorded in `message_status_events`.
- **Design:** at-least-once dispatch with provider idempotency; dead-letter queue for unrecoverable errors.
- **Cross-cutting:** worker `update`; observability `update`; tests `new`.
- **Delivery:** worker background task.
- **Evidence:** dispatch unit tests, retry/backoff simulation, status lifecycle tests.
- **Owners:** engineering `@Ryanakml`.

### M2-09 — Deliver operator conversation inbox, thread timeline, and message composer UI

- **Outcome:** agents can manage incoming WhatsApp conversations and reply directly from the web application shell.
- **Depends on:** M2-07.
- **Scope:** `apps/web`: conversation list view with unread/status indicators; thread view with message bubbles, timestamps, delivery checkmarks; reply composer; responsive glassmorphic UI.
- **Acceptance:** loads conversations for active tenant; composer submits reply and shows optimistic pending message; updates status on delivery.
- **Design:** accessible markup; keyboard shortcuts (Cmd+Enter to send); role-gated composer.
- **Cross-cutting:** web `update`; tests `new`; a11y `new`.
- **Delivery:** React UI components in `apps/web`.
- **Evidence:** Vitest component tests, visual validation, accessibility audits.
- **Owners:** engineering `@Ryanakml`.

### M2-10 — Build end-to-end integration tests, DLQ runbooks, and M2 evidence packet

- **Outcome:** complete WhatsApp inbound-to-agent reply slice is proven end-to-end and documented.
- **Depends on:** M2-01..M2-09.
- **Scope:** end-to-end integration test (inbound webhook → worker → database → UI view → agent reply → outbound worker → status update); DLQ monitoring and replay; operational runbook; M2 evidence packet.
- **Acceptance:** full end-to-end test passes; simulated Redis/worker crash reconciles without duplicate messages; evidence packet signed.
- **Design:** self-contained E2E suite using fake adapter.
- **Cross-cutting:** CI `update`; docs `update`; observability `update`.
- **Delivery:** `docs/delivery/M2_EVIDENCE.md` and runbooks.
- **Evidence:** automated E2E test runs, CI logs, operational runbook.
- **Owners:** engineering `@Ryanakml`.
