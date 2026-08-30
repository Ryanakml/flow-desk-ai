# M5 Controlled Automation, Routing, Policy Auto-Send & Production Release Platform Backlog

- Milestone owner: `@Ryanakml`
- Engineering owner: `@Ryanakml`
- Acceptance owners: product owner for automated routing & bot auto-send; independent security reviewer for auto-send policy bounds and global killswitches
- Entry dependency: M4 completion evidence accepted, PR #89 merged, and post-merge CI green
- Exit proof: incoming WhatsApp messages are routed automatically based on tenant rules; high-confidence bot responses (`mode: auto`) are safely auto-sent under strict policy checks; global/tenant killswitches halt automation immediately; production CI/CD promotes immutable images with canary health gates and live SLO metrics
- Review status: execution-ready decomposition; assignees and reviewers confirmed before implementation

---

## Epic M5-E1 — Automated Routing & Policy Engine

### M5-01 — Automated Conversation Routing Engine & Rules Data Model

- **Outcome:** tenant-isolated routing rules, skill-based queue matching, and load-balanced agent assignment engine exist with Row-Level Security.
- **Depends on:** M4-07.
- **Scope:** database tables for `routing_rules` (priority, condition_json, target_queue_id, target_team_id, target_user_id) and `routing_logs`; domain routing policy evaluator matching inbound messages by channel, contact tag, language, customer priority, and operational hours; REST endpoints `GET/PUT/POST /api/v1/organizations/:orgId/routing/rules`; worker integration in message normalization pipeline.
- **Acceptance:** incoming messages are deterministically routed to matching queues/teams; unmatched messages fall back to default queue; foreign tenant rules are isolated via RLS; rule priority ordering is strictly respected.
- **Design:** ordered rule evaluation engine in `@flowdesk/domain` with database-backed transaction RLS policies.
- **Cross-cutting:** data/domain/api/worker/tests/docs `new`.
- **Delivery:** database migration `0019_m5_routing_rules.sql`, domain evaluator in `@flowdesk/domain/src/routing.ts`, API router `apps/api/src/routing.ts`, and worker stage in `apps/worker`.
- **Evidence:** routing evaluator unit tests, RLS tenant isolation negative matrix, API supertest suite.
- **Owners:** engineering `@Ryanakml`.

---

## Epic M5-E2 — Policy-Controlled Auto-Send & Killswitches

### M5-02 — Policy-Controlled Auto-Send Engine & Pre-Send Validation

- **Outcome:** bot `auto` mode enables autonomous replies only under strict multi-layer policy checks with zero unauthorized auto-sending.
- **Depends on:** M5-01.
- **Scope:** update bot config to allow `mode: auto`; pre-send policy gate checking: confidence $\ge$ threshold (default 0.9), active business hours, valid 24h WhatsApp service window, non-escalated intent, rate limits ($\le 3$ auto-replies per conversation per hour), mandatory AI disclosure footer ("_Balasan otomatis oleh AI FlowDesk_"); atomic transaction outbox dispatch.
- **Acceptance:** bot auto-sends only when all safety policy criteria pass; insufficient confidence or policy violation downgrades run to `escalated` / `draft` status; duplicate auto-sends on conversation races are prevented.
- **Design:** pre-send guardrail engine in `@flowdesk/domain` executing immediately before `outbound_intents` creation.
- **Cross-cutting:** domain/api/worker/contracts/tests `update`.
- **Delivery:** pre-send policy validator in `@flowdesk/domain/src/auto-send.ts`, worker auto-send stage in `apps/worker/src/auto-send.ts`.
- **Evidence:** auto-send policy unit tests, race condition concurrency tests, outbox integration tests.
- **Owners:** engineering `@Ryanakml`; security review required.

### M5-03 — Multi-Level Emergency Killswitches & Instant Propagation

- **Outcome:** global and tenant-scoped emergency killswitches instantly halt auto-send operations with zero latency or race conditions.
- **Depends on:** M5-02.
- **Scope:** global system killswitch flag (`GLOBAL_AUTO_SEND_DISABLED`), tenant emergency disabled flag (`emergencyDisabled` in `bot_configs`), conversation-level bot pause (`botPaused`); instant propagation to worker processes via Redis pub-sub / DB poll; REST emergency endpoints `POST /api/v1/organizations/:orgId/bot/emergency-stop`.
- **Acceptance:** tripping a killswitch immediately halts in-flight and queued auto-send jobs; killswitch status is audited with actor ID and timestamp; normal manual agent operations remain active during auto-send killswitch activation.
- **Design:** fail-closed circuit breaker and pub-sub signal propagation across all worker nodes.
- **Cross-cutting:** security/worker/api/tests `update`.
- **Delivery:** emergency killswitch service in `@flowdesk/security`, API emergency endpoints, worker signal listener.
- **Evidence:** killswitch unit tests, pub-sub propagation tests, API emergency stop supertest suite.
- **Owners:** engineering `@Ryanakml`.

---

## Epic M5-E3 — Production Delivery & SLO Reliability

### M5-04 — Production CI/CD Pipeline, Image Provenance & Canary Promotion (C4/C5/R4)

- **Outcome:** production deployment controls with immutable image digest signing, SBOM generation, staging promotion, and automated canary deployment.
- **Depends on:** M5-03.
- **Scope:** GitHub Actions workflow `.github/workflows/production-release.yml`; Docker image digest signing and SBOM generation (`syft` / `cosign`); Terraform production infrastructure module (`infra/terraform/environments/production/`); canary traffic promotion gate (5% → 25% → 100%) with automated health check rollback.
- **Acceptance:** production images are deployed exclusively via verified SHA256 digests; canary deployment automatically rolls back if health checks fail; Terraform state is protected and isolated.
- **Design:** immutable release pipeline with OIDC deployment identity and automated health rollback gates.
- **Cross-cutting:** infra/ci/docs `new`.
- **Delivery:** GitHub Actions release workflow, Terraform production modules, container build manifests.
- **Evidence:** release workflow validation, SBOM artifact generation, canary health check simulation.
- **Owners:** engineering `@Ryanakml`.

### M5-05 — SLO Dashboard, Operational Alerting & Failure Injection Drills (O4/T5)

- **Outcome:** live SLO error budgets, Prometheus metrics, Grafana dashboards, P1/P2 alerting rules, and simulated failure recovery evidence.
- **Depends on:** M5-04.
- **Scope:** SLO metrics definitions (webhook latency < 500ms, queue lag < 5s, auto-send success $\ge 99.9\%$); Prometheus alert rules (`infra/monitoring/prometheus/rules/m5-routing.yml`); Grafana dashboard configs; failure injection test suite (simulated Redis crash, DB failover, Meta API 429 rate limit backoff).
- **Acceptance:** P1/P2 alerts trigger reliably on simulated SLO breaches; system gracefully recovers from component failures without data loss or duplicate sends.
- **Design:** Prometheus metrics collectors and resilience test harness.
- **Cross-cutting:** observability/infra/tests `update`.
- **Delivery:** Prometheus alerting rules, Grafana dashboard JSONs, failure injection suite `apps/worker/src/failure-injection.test.ts`.
- **Evidence:** Prometheus rule syntax validation, Grafana dashboard render checks, failure injection test results.
- **Owners:** engineering `@Ryanakml`.

---

## Epic M5-E4 — Release Verification & Evidence

### M5-06 — M5 End-to-End Verification & Evidence Packet

- **Outcome:** complete staging demonstration of controlled auto-send, routing, killswitches, canary deployment, and release evidence packet.
- **Depends on:** M5-05.
- **Scope:** end-to-end integration test suite `apps/worker/src/m5-auto-send.e2e.test.ts`; publication of `docs/delivery/M5_EVIDENCE.md`; update `docs/delivery/TRACEABILITY.md`; full repository verification (`pnpm verify`).
- **Acceptance:** all M5 stories pass release gates; 100% test pass rate across monorepo; all CI quality gates pass.
- **Design:** cumulative milestone evidence compilation.
- **Cross-cutting:** docs/tests `update`.
- **Delivery:** `M5_EVIDENCE.md`, updated `TRACEABILITY.md`, and E2E verification test suite.
- **Evidence:** `pnpm verify` clean exit 0 output, hosted CI checks passing.
- **Owners:** engineering `@Ryanakml`.
