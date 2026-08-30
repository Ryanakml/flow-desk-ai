# Milestone 6 (M6) Delivery Backlog — Commercial SaaS Operation: Billing, Integrations, Analytics & Self-Service

## Overview

Milestone 6 transforms FlowDesk into a commercially operable SaaS platform. It introduces plan catalogs, Stripe subscription management, entitlement enforcement, customer self-service billing portals, developer API key lifecycles, outbound webhook dispatch, and analytics reporting.

---

## Epic M6-E1 — Entitlements, Billing & Usage Ledger

### M6-01 — Entitlements Engine, Plan Catalog & Immutable Billing Ledger

- **Outcome:** multi-tier subscription plans (Free, Pro, Enterprise) with atomic entitlement checks and immutable ledger accounting.
- **Depends on:** M5-06.
- **Scope:** database tables `plans`, `subscriptions`, `entitlements`, `usage_ledger`, and `invoices`; Stripe billing webhook integration with HMAC signature verification and deduplication; centralized entitlement checker in `@flowdesk/domain` gating channels, seats, AI tokens, and data retention; fallback grace period policy during upstream billing provider outages.
- **Acceptance:** subscription status changes dynamically grant/revoke tenant capabilities; zero floating point calculations for usage/pricing; billing webhook idempotency prevents double charging or duplicate quota grants.
- **Delivery:** migration `0020_m6_billing_ledger.sql`, Stripe provider in `packages/providers/src/stripe.ts`, API endpoints `/api/v1/organizations/:orgId/billing`.
- **Evidence:** billing webhook supertest suite, entitlement boundary matrix, race condition concurrency test.

---

## Epic M6-E2 — Customer Self-Service & Developer Integrations

### M6-02 — Customer Self-Service Portal, Developer API Keys & Webhook Subscriptions

- **Outcome:** self-serve billing portal handoff, scoped API key rotation (prefix + SHA-256 hash), and outbound webhook delivery engine.
- **Depends on:** M6-01.
- **Scope:** Stripe Customer Portal session generation (`POST /api/v1/organizations/:orgId/billing/portal`); API key CRUD with RBAC, scoped permissions, and expiration; outbound developer webhook engine (`flowdesk.webhook_subscriptions`) delivering signed payloads (HMAC-SHA256) for conversation events with retry backoff and dead-letter queue (DLQ).
- **Acceptance:** customer admins can create/rotate/revoke scoped API keys; external webhooks receive signed payloads with retry on failure; API key hashes are non-reversible.
- **Delivery:** developer API router `apps/api/src/developer.ts`, worker webhook dispatcher `apps/worker/src/developer-webhooks.ts`.
- **Evidence:** API key auth supertest suite, outbound webhook signature & retry verification tests.

---

## Epic M6-E3 — Operational Analytics & Performance Reporting

### M6-03 — Executive & Operational Analytics Engine & CSV Export Controls

- **Outcome:** aggregated inbox metrics, SLA resolution rates, agent workload, bot acceptance/escalation ratios, and audited CSV export engine.
- **Depends on:** M6-02.
- **Scope:** analytics read models and rollup jobs; API endpoints `GET /api/v1/organizations/:orgId/analytics/overview` and `/analytics/export`; metric definitions (inbound/outbound count, p50/p95 first response time, resolution time, bot draft accept vs escalation rate); timezone-aware query parameter filtering; audited CSV stream generator.
- **Acceptance:** analytics queries do not scan primary inbox transaction tables; metrics respect tenant boundary; CSV export events are logged in `audit_logs`.
- **Delivery:** analytics API router `apps/api/src/analytics.ts`, asynchronous aggregation job in `apps/worker/src/analytics-rollup.ts`.
- **Evidence:** analytics supertest suite, CSV stream validation, RBAC export security matrix.

---

## Epic M6-E4 — Release Verification & Verification Packet

### M6-04 — Milestone 6 End-to-End Integration Suite & Evidence Packet

- **Outcome:** end-to-end commercial demonstration of billing, customer self-service, API keys, outbound webhooks, analytics, and release evidence packet.
- **Depends on:** M6-03.
- **Scope:** E2E test `apps/worker/src/m6-commercial.e2e.test.ts`; `docs/delivery/M6_EVIDENCE.md`; update `docs/delivery/TRACEABILITY.md`; full monorepo verification (`pnpm verify`).
- **Acceptance:** all M6 stories pass release gates; 100% test pass rate across monorepo; all CI quality gates pass.
- **Delivery:** `M6_EVIDENCE.md`, updated `TRACEABILITY.md`, and E2E verification test suite.
- **Evidence:** `pnpm verify` clean exit 0 output, hosted CI checks passing.
