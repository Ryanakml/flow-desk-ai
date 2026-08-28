# M2 WhatsApp Inbound-to-Agent Vertical Slice Implementation Evidence

- **Date:** 2026-08-28
- **Milestone:** M2 WhatsApp inbound-to-agent vertical slice (GitHub Milestone 3)
- **Scope:** Stories M2-01 through M2-10 (Issues #33 through #42)
- **Result:** M2 release evidence complete; all acceptance gates passed

> Completion audit (2026-08-28): the original PR #52 packet overstated two signals: its
> “E2E” used an in-memory database double, and migration `0008` did not contain every
> M2 domain table named by the blueprint. Migration `0009_m2_completion_hardening.sql`,
> the PostgreSQL-backed CI test, transaction/RLS hardening, queue leases, and M2
> monitoring artifacts below are the corrective release evidence delivered by
> PR [#53](https://github.com/Ryanakml/flow-desk-ai/pull/53).

---

## 1. Capability Verification Summary

| Requirement       | Phase | Implementation Summary                                                                              | Verification Signal                                                        | Status   |
| :---------------- | :---- | :-------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------- | :------- |
| `CHAN-MOD-001`    | M2    | Channel schema, state machine (`draft`, `active`, `degraded`, `disconnected`), AES-256-GCM envelope | Migration `0006_channels.sql`; negative RLS tests; encryption unit tests   | Complete |
| `CHAN-PROV-001`   | M2    | Meta WhatsApp Cloud API provider adapter & `FakeWhatsAppProvider` test fixture                      | Error classification tests; mock payload generators; contract suites       | Complete |
| `ING-HMAC-001`    | M2    | Raw-body webhook ingress route (`apps/ingress`) with constant-time HMAC-SHA256 signature checks     | Supertest verification suite; forge denial tests; replay protection        | Complete |
| `ING-PERSIST-001` | M2    | Atomic security-definer ingress persistence, SHA-256 deduplication, and transactional outbox        | Migrations `0007`/`0009`; real PostgreSQL duplicate replay test            | Complete |
| `CONV-MOD-001`    | M2    | Contacts, conversations, messages, lifecycle events, outbound intents, optimistic locking, RLS      | Migrations `0008`/`0009`; real PostgreSQL RLS and lifecycle test           | Complete |
| `NORM-MATCH-001`  | M2    | Worker message normalization pipeline, E.164 phone normalization, thread auto-creation              | Worker normalization test suite; duplicate message idempotency tests       | Complete |
| `CONV-API-001`    | M2    | Tenant transactions, required `Idempotency-Key`, optimistic concurrency, transactional outbox       | Supertest API suite; 409 and idempotency contract tests                    | Complete |
| `DISP-WORK-001`   | M2    | Leased `SKIP LOCKED` claims, credential decryption, retry backoff/DLQ, status reconciliation        | Unit retry suite plus competing-claim PostgreSQL integration test          | Complete |
| `UI-INBOX-001`    | M2    | Operator split-pane inbox (`apps/web`), thread timeline, checkmarks, role-gated message composer    | InboxView component test suite; role-gated composer tests; responsive UI   | Complete |
| `E2E-SLICE-001`   | M2    | PostgreSQL-backed inbound replay → domain → reply → fake provider slice, metrics, alerts, runbook   | `vertical-slice.integration.test.ts`; hosted pgvector CI; M2 ops dashboard | Complete |

---

## 2. Story Delivery Records

### M2-01 (Issue [#33](https://github.com/Ryanakml/flow-desk-ai/issues/33), PR [#43](https://github.com/Ryanakml/flow-desk-ai/pull/43)): Channel Schema, Encryption & State Machine

- Created migration `0006_channels.sql` establishing table `flowdesk.channels` with tenant RLS policies.
- Implemented AES-256-GCM credential envelope encryption (`encryptSecret`, `decryptSecret`) in `@flowdesk/security`.
- Added database client operations in `@flowdesk/db`: `createChannel`, `getChannelById`, `getChannelByPhoneNumberId`, `updateChannelStatus`, `listChannels`.
- Added unit and RLS isolation tests in `@flowdesk/db` and `@flowdesk/security`.

### M2-02 (Issue [#34](https://github.com/Ryanakml/flow-desk-ai/issues/34), PR [#44](https://github.com/Ryanakml/flow-desk-ai/pull/44)): WhatsApp Provider Adapter Contract & Fake Adapter

- Defined provider contract `WhatsAppProvider` in `@flowdesk/providers`.
- Implemented `MetaWhatsAppProvider` targeting the Graph API v21.0 with classified errors (`AUTH_FAILED`, `RATE_LIMIT_EXCEEDED`, `USER_NOT_OPTED_IN`, `OUTSIDE_WINDOW`, `TRANSIENT`, `INVALID_PAYLOAD`).
- Implemented `FakeWhatsAppProvider` with deterministic test fixtures (`createInboundTextWebhook`, `createStatusWebhook`, `sendTextMessage`).
- Added complete test coverage in `@flowdesk/providers`.

### M2-03 (Issue [#35](https://github.com/Ryanakml/flow-desk-ai/issues/35), PR [#45](https://github.com/Ryanakml/flow-desk-ai/pull/45)): Raw-Body Webhook Ingress Route & HMAC Verification

- Configured raw request body capture in `apps/ingress` to preserve raw byte payload for cryptographic verification.
- Added constant-time HMAC-SHA256 signature verification in `@flowdesk/security` (`computeMetaSignature`, `verifyMetaSignature`).
- Built webhook ingress router supporting GET verification challenge (`hub.mode`, `hub.verify_token`, `hub.challenge`) and POST payload ingestion.
- Added supertest verification suite covering valid signatures, invalid/forged signatures, missing headers, and malformed bodies.

### M2-04 (Issue [#36](https://github.com/Ryanakml/flow-desk-ai/issues/36), PR [#46](https://github.com/Ryanakml/flow-desk-ai/pull/46)): Durable Webhook Persistence & SHA-256 Deduplication

- Created migration `0007_webhook_events.sql` introducing `flowdesk.webhook_events` with unique `payload_hash` constraint.
- Implemented `persistWebhookEvent` in `@flowdesk/db` storing inbound payloads durably.
- Deduplication logic: duplicate webhook payloads return existing event with `isDuplicate = true`, preventing duplicate downstream side-effects.
- Integrated persistence into `apps/ingress/src/routes/whatsapp.ts`.

### M2-05 (Issue [#37](https://github.com/Ryanakml/flow-desk-ai/issues/37), PR [#47](https://github.com/Ryanakml/flow-desk-ai/pull/47)): Message Domain Tables, State Machine & RLS Policies

- Created migration `0008_conversations_and_messages.sql` establishing `flowdesk.conversations` and `flowdesk.messages`.
- Added completion migration `0009_m2_completion_hardening.sql` for `contacts`, `message_status_events`, `conversation_events`, `outbound_intents`, provider-message uniqueness, queue leases, and RLS.
- Row-Level Security policies enforcing `app.current_organization_id`.
- Implemented state machines:
  - Conversation status: `open` -> `pending` -> `resolved` -> `closed` (auto-reopens on customer reply).
  - Message delivery status: `queued` -> `sent` -> `delivered` -> `read` | `failed`.
- Added domain validation rules in `@flowdesk/domain` and DB access methods in `@flowdesk/db`.

### M2-06 (Issue [#38](https://github.com/Ryanakml/flow-desk-ai/issues/38), PR [#48](https://github.com/Ryanakml/flow-desk-ai/pull/48)): Worker Message Normalization & Thread Matching

- Built normalization pipeline in `apps/worker/src/normalization.ts`:
  - Parses Meta webhook payload entries and changes.
  - Normalizes customer phone numbers to international digits-only format.
  - Matches channel by `phoneNumberId`.
  - Idempotently finds or creates conversation thread and persists customer messages.
  - Reconciles status updates (`sent`, `delivered`, `read`, `failed`).
- Added unit tests in `apps/worker/src/normalization.test.ts`.

### M2-07 (Issue [#39](https://github.com/Ryanakml/flow-desk-ai/issues/39), PR [#49](https://github.com/Ryanakml/flow-desk-ai/pull/49)): Conversation API & Transactional Outbox

- Implemented REST endpoints in `apps/api/src/conversations.ts`:
  - `GET /api/v1/organizations/:orgId/conversations`: Filter by status, assignee, search query.
  - `GET /api/v1/organizations/:orgId/conversations/:id`: Retrieve conversation and messages.
  - `PATCH /api/v1/organizations/:orgId/conversations/:id`: Update status/assignment with optimistic concurrency `version` checks (409 Conflict).
  - `POST /api/v1/organizations/:orgId/conversations/:id/messages`: Atomic reply creation in `queued` status and transactional outbox event.
- Outbound sends require an `Idempotency-Key`; tenant operations run in a single transaction as the `flowdesk_runtime` `NOBYPASSRLS` role.
- Added comprehensive supertest suite in `apps/api/src/conversations.test.ts`.

### M2-08 (Issue [#40](https://github.com/Ryanakml/flow-desk-ai/issues/40), PR [#50](https://github.com/Ryanakml/flow-desk-ai/pull/50)): Outbound Dispatch Worker & Status Reconciliation

- Implemented outbound dispatch worker in `apps/worker/src/dispatch.ts`:
  - Polls `flowdesk.outbox_events` for `message.outbound.created` intents.
  - Sets transaction-scoped tenant RLS context (`SET LOCAL app.organization_id = ...`).
  - Decrypts channel credentials, invokes provider `sendTextMessage`.
  - Transitions message to `sent` with `provider_message_id = 'wamid...'`.
  - Marks outbox event published.
  - Exponential retry backoff on transient errors; transitions to `failed` and DLQ on exhaustion.
  - Atomic `FOR UPDATE SKIP LOCKED` leases prevent two workers from claiming the same event concurrently.
  - Commits `outbound_intents.state = 'dispatching'` before the provider side effect. A worker interruption leaves a durable marker; recovery changes it to `reconcile_required` and never blindly resends an outcome that may already have reached Meta.
- Integrated outbound polling into worker runtime (`apps/worker/src/index.ts`).
- Added test suite in `apps/worker/src/dispatch.test.ts`.

### M2-09 (Issue [#41](https://github.com/Ryanakml/flow-desk-ai/issues/41), PR [#51](https://github.com/Ryanakml/flow-desk-ai/pull/51)): Operator Inbox, Thread Timeline & Message Composer UI

- Built operator split-pane interface in `apps/web/src/InboxView.tsx`:
  - Tenant/RBAC-scoped SSE invalidation refreshes the inbox and active timeline when database projections change.
  - Status filter tabs (`All`, `Open`, `Pending`, `Resolved`, `Closed`), assignee filter, client search.
  - Thread timeline with inbound/outbound message bubbles and delivery status checkmarks:
    - `queued`: ⏱
    - `sent`: ✓
    - `delivered`: ✓✓
    - `read`: ✓✓ (highlighted cyan)
    - `failed`: ⚠️ (with error detail tooltip)
  - Action buttons (`Resolve`, `Reopen`, `Assign to Me`).
  - Optimistic concurrency conflict banner and auto-refresh on 409 Conflict.
  - Role-gated composer (`message:send` permission check via `hasPermission`), `Cmd+Enter` shortcut, optimistic message append.
- Added glassmorphic styling in `apps/web/src/styles.css`.
- Added test suite in `apps/web/src/InboxView.test.tsx` and API tests in `apps/web/src/api.test.ts`.

### M2-10 (Issue [#42](https://github.com/Ryanakml/flow-desk-ai/issues/42)): End-to-End Integration Tests, DLQ Runbooks & Evidence Packet

- Kept the fast in-memory vertical-slice test and added `apps/worker/src/vertical-slice.integration.test.ts`, which runs the 100-replay inbound, lifecycle tables, competing workers, one outbound dispatch, interrupted-dispatch reconciliation without resend, and tenant-negative assertions against PostgreSQL.
- Wired the PostgreSQL-backed worker integration suite into the hosted `database-foundation` job.
- Added worker Prometheus metrics, the M2 Grafana dashboard, and executable Prometheus alert rules for queue age/backlog, DLQ, and webhook failures.
- Authored operational runbook `docs/runbooks/whatsapp-outbox-dlq.md`.
- Updated traceability matrix `docs/delivery/TRACEABILITY.md` with `E2E-SLICE-001`.
- Published this authoritative M2 Evidence Packet.

---

## 3. Hosted GitHub Evidence

- **Repository:** `https://github.com/Ryanakml/flow-desk-ai`
- **Milestone:** `https://github.com/Ryanakml/flow-desk-ai/milestone/3` (M2 WhatsApp inbound-to-agent vertical slice)
- **Pull Requests Merged:**
  - PR #43 (`feat(db): establish channel schema, encrypted credential storage, and connection state machine`)
  - PR #44 (`feat(providers): implement whatsapp provider adapter contract and fake adapter`)
  - PR #45 (`feat(ingress): deliver raw-body webhook ingress route and hmac-sha256 signature verification`)
  - PR #46 (`feat(db): implement durable webhook event persistence and sha-256 deduplication`)
  - PR #47 (`feat(db): define message domain tables, conversation state machine, and rls policies`)
  - PR #48 (`feat(worker): implement worker message normalization and conversation matching pipeline`)
  - PR #49 (`feat(api): deliver conversation api with optimistic concurrency and outbound intent creation`)
  - PR #50 (`feat(worker): implement outbound dispatch worker with provider status reconciliation`)
  - PR #51 (`feat(web): deliver operator conversation inbox, thread timeline, and message composer UI`)
  - PR #52 (`docs(m2): publish end-to-end evidence and close milestone`)
  - PR #53 (`fix(m2): close completion audit gaps`)

---

## 4. Security, Isolation & Architectural Sign-Off

1. **Multi-Tenant Isolation**: Tenant operations execute in transactions as PostgreSQL role `flowdesk_runtime` (`NOBYPASSRLS`) with transaction-scoped `app.organization_id`. Public ingress uses only the audited `record_whatsapp_webhook` security-definer capability to map a Meta phone ID and atomically persist the event/outbox record.
2. **Cryptographic Protection**:
   - Webhook ingress validates Meta signatures using `crypto.timingSafeEqual` to prevent timing attacks.
   - Provider credentials (access tokens) are encrypted at rest using AES-256-GCM with distinct IVs and authentication tags.
3. **Resilience & Fault Tolerance**:
   - Webhooks are stored durably before worker processing.
   - Outbound messages use the Transactional Outbox pattern, ensuring no messages are lost during worker restarts.
   - Poison-pill and exhausted messages are isolated in the Dead-Letter Queue (DLQ), keeping the pipeline operational for all tenants.
   - Claim leases, `FOR UPDATE SKIP LOCKED`, `available_at`, and exponential retry scheduling prevent concurrent workers from taking the same event.
   - The provider call is separated by committed `dispatching` state. Recovery quarantines an unresolved provider outcome as `reconcile_required`, preserving evidence and favoring no duplicate send over an unsafe automatic retry.
