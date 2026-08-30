# Milestone 6 (M6) Backlog — Customer Self-Service, Analytics & Free Access Model

**Status:** READY FOR IMPLEMENTATION  
**Goal:** Deliver complete self-service onboarding (WhatsApp channel connection UI, API keys, webhooks) and team performance analytics while operating FlowDesk as a **Free & Open Community Platform**. (Billing & Paid Subscription entitlement is placed on hold as an optional modular extension for later).

---

## Epic M6-E1 — Customer Self-Service & Integration Management

### M6-01 — Self-Service WhatsApp Channel Connection UI & Management

- **Outcome:** Admins can connect, test, and manage Meta WhatsApp Business Accounts directly from the FlowDesk Web Dashboard UI without manual database setup.
- **Depends on:** M5-06.
- **Scope:** Web UI page `/settings/channels` supporting WhatsApp Cloud API credential entry (Phone Number ID, WhatsApp Business Account ID, Access Token) & verification testing; channel status toggle (`active`, `paused`, `error`); status badge indicators; RLS tenant isolation.
- **Acceptance:** Admins can add and verify a live WhatsApp channel via UI; invalid credentials return friendly error feedback; channel operations are tenant-isolated.
- **Delivery:** React UI components in `apps/web/src/views/ChannelsView.tsx`, API endpoints `POST/DELETE /api/v1/organizations/:orgId/channels`.

### M6-02 — Scoped Developer API Keys & Webhook Subscriptions

- **Outcome:** External developers can generate scoped API keys (prefix + hashed token) and register outbound webhooks with HMAC signatures and retry queues.
- **Depends on:** M6-01.
- **Scope:** API key generation and rotation UI (`/settings/api-keys`); scoped permissions (`conversation:read`, `message:write`); outbound webhook registration (`/settings/webhooks`) with URL verification, HMAC secret signing, delivery log viewer, and dead-letter queue (DLQ) retry.
- **Acceptance:** Generated API keys work for external REST requests; webhooks deliver event payloads signed with HMAC-SHA256; failed deliveries retry with exponential backoff.
- **Delivery:** Database tables `flowdesk.api_keys` & `flowdesk.webhook_subscriptions`, API endpoints, worker delivery process.

---

## Epic M6-E2 — Operational Analytics & Performance Reporting

### M6-03 — Real-Time Analytics Engine & Read Aggregates

- **Outcome:** Live analytical metrics for response times, SLA compliance, queue load, and AI bot resolution rates.
- **Depends on:** M6-02.
- **Scope:** Asynchronous aggregation background process computing 5-minute and 1-hour metrics (inbound/outbound volume, first response time, average resolution time, SLA breach count, bot draft acceptance rate); PostgreSQL analytics read models.
- **Acceptance:** Analytics queries execute instantly off read aggregates without scanning transactional message history; metrics respect tenant boundary.
- **Delivery:** Database read models `flowdesk.analytics_aggregates_hourly`, background cron collector in `apps/scheduler`.

### M6-04 — Analytics Dashboard & CSV Compliance Export

- **Outcome:** Interactive analytics charts in Web Dashboard UI and compliance data export.
- **Depends on:** M6-03.
- **Scope:** Web UI view `/analytics` displaying metric cards and trend charts (Message Volume, SLA Resolution %, Bot vs Human ratio); CSV export action (`POST /api/v1/organizations/:orgId/analytics/export`) with audit logging.
- **Acceptance:** Dashboard renders responsive trend charts; CSV export generates downloadable report with proper headers and audited download event.
- **Delivery:** React UI view `apps/web/src/views/AnalyticsView.tsx`, REST API export router `apps/api/src/analytics.ts`.

---

## Epic M6-E3 [OPTIONAL / ON-HOLD FOR LATER] — Paid Subscriptions & Stripe Billing

### M6-05 — [ON-HOLD] Stripe Billing Adapter & Subscription Entitlements

- **Outcome:** Optional paid plan subscription billing and quota enforcement (Held on standby for future monetization).
- **Status:** **ON-HOLD / OPTIONAL**. FlowDesk operates 100% free by default.

---

## Epic M6-E4 — Release Verification & Evidence

### M6-06 — M6 End-to-End Verification & Evidence Packet

- **Outcome:** Full monorepo verification (`pnpm verify`), publication of `docs/delivery/M6_EVIDENCE.md`, and updated `docs/delivery/TRACEABILITY.md`.
- **Acceptance:** 100% monorepo build & test pass rate across all 14 packages; clean hosted CI quality gates.
