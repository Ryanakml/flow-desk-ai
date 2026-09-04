# Milestone 6 Evidence Packet: Community Platform & Developer Integrations

## Executive Summary

Milestone 6 expands FlowDesk into an extensible, open, free community platform with self-service WhatsApp channels, scoped developer API key management, external REST APIs authenticated via SHA-256 hashed keys, outbound webhooks with HMAC-SHA256 signatures, an hourly analytics aggregation engine, and CSV compliance export. Stripe billing has been set aside as an optional modular extension (on-hold) for future monetization.

## Completed Capability Matrix

| Story ID  | Capability                                   | Blueprint / Spec                                                                                                                               | Verification Status      |
| :-------- | :------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------- |
| **M6-01** | Self-Service WhatsApp Channel Connection UI  | `apps/web/src/ChannelsView.tsx`                                                                                                                | 100% Passed (PR #111)    |
| **M6-02** | Scoped Developer API Keys & Webhooks         | `0035_m6_developer_webhooks_and_analytics.sql`, `DeveloperSettingsView.tsx`, `apps/api/src/external.ts`, `apps/worker/src/webhook-dispatch.ts` | 100% Passed (Issue #209) |
| **M6-03** | Real-Time Analytics Engine & Read Aggregates | `packages/db/src/analytics.ts`, `apps/scheduler/src/process.ts`                                                                                | 100% Passed (Issue #209) |
| **M6-04** | Analytics Dashboard & CSV Compliance Export  | `apps/web/src/AnalyticsView.tsx`, `apps/api/src/analytics.ts`                                                                                  | 100% Passed              |
| **M6-05** | Paid Subscriptions & Stripe Billing          | Blueprint updated to free community model with optional modular billing                                                                        | On-Hold / Optional       |
| **M6-06** | M6 E2E Verification & Evidence Packet        | `apps/worker/src/m6-community-platform.e2e.test.ts`                                                                                            | 100% Passed (Issue #209) |

## Architecture & Security Highlights

1. **Developer API & External Authentication**:
   - SHA-256 key hashing (`fd_live_...` prefix for display/lookup only; raw key returned once at generation).
   - Authenticated external REST endpoints under `/api/v1/external` (`/conversations`, `/conversations/:id`, `/conversations/:id/messages`) with scope enforcement (`conversation:read`, `message:write`, `*`, `admin`).
   - Constant-time verification (`timingSafeEqual`) preventing timing attacks.
2. **Outbound Developer Webhook Engine**:
   - HMAC-SHA256 webhook signatures (`t=...,v1=...`) with timestamp drift verification and replay attack prevention.
   - Transactional outbox event publishing (`developer.webhook.dispatch`) and worker dispatch engine with exponential backoff and dead-letter queue (`dead_letter`) upon max retry exhaustion.
   - Masked secret display on retrieval (`whsec_...****************`).
3. **Analytics Engine & Aggregates**:
   - Migration `0035_m6_developer_webhooks_and_analytics.sql` creating `flowdesk.webhook_deliveries`, `flowdesk.analytics_aggregates_hourly`, and `flowdesk.analytics_watermarks`.
   - Hourly rollup calculation for conversations, messages, FRT, resolution time, and SLA compliance with transactional fallback when aggregate data is absent.
   - Background scheduler job (`runAnalyticsAggregationJob`) executing tenant-isolated rollups.
4. **Open Community Model**:
   - FlowDesk runs out-of-the-box as an open community platform with multi-tenant isolation, without paywall restrictions.

## Verification Evidence

- `pnpm verify` run output: 100% clean formatting, OpenAPI check passed, ESLint 0 errors, TypeScript typecheck clean across all 14 workspace packages, all unit/integration tests passing (22 suites), and production web build generated.
- `apps/worker/src/m6-community-platform.e2e.test.ts`: 6/6 tests passing.
- `apps/api/src/developer.test.ts`: 9/9 tests passing.
- Traceability tracking: Issue #209.
