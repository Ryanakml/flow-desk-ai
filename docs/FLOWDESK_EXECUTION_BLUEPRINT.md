# FlowDesk — Technical Execution Blueprint

**Status:** authoritative execution plan  
**Version:** 1.0.0  
**Depends on:** `FLOWDESK_ENTERPRISE_PRODUCT_AND_ENGINEERING_SPEC.md`  
**Audience:** product, design, engineering, QA, security, platform/SRE, support  
**Project state:** pre-development

> This document turns the Enterprise Product & Engineering Specification into an ordered way of building. It is intentionally not a one-time checklist. Every phase is a customer-valuable vertical slice, and every cross-cutting discipline—CI/CD, testing, Docker, security, data, observability, documentation, and operations—must evolve with it. A later phase inherits every completed requirement from earlier phases unless this document explicitly replaces it.

---

## 1. How to use this blueprint

There are three source-of-truth levels:

| Level | Document/system | Answers |
|---|---|---|
| Product and engineering specification | `FLOWDESK_ENTERPRISE_PRODUCT_AND_ENGINEERING_SPEC.md` | What FlowDesk is, architecture constraints, policies, quality bar. |
| Execution blueprint | This document | What to build next, in what dependency order, and what “done” means. |
| Delivery system | GitHub Issues/Projects, PRs, ADRs, CI runs, deploy records, dashboards | Current status and objective evidence that a phase is complete. |

If documents conflict, the product/engineering specification controls product and platform intent; an approved ADR controls a specific technical decision; this blueprint controls order of work and release gates. A task tracker is never allowed to silently change a decision—record an ADR or update the relevant document in the same PR.

### 1.1 The core rule: phases are vertical slices, not technology silos

Bad sequencing:

```text
Phase A: backend → Phase B: frontend → Phase C: CI/CD → Phase D: tests
```

Correct sequencing:

```text
Capability: receive one WhatsApp message and let one authorized agent reply.
  ├─ UI: inbox state and reply UX
  ├─ API/domain: authorization, conversation/message commands
  ├─ data: migration, RLS, indexes, retention metadata
  ├─ async: webhook/event/outbox/worker
  ├─ Docker/runtime: service image, health checks, graceful shutdown
  ├─ CI/CD: build, contract/integration/E2E checks, deploy changes
  ├─ security: signature, tenant isolation, audit, secret controls
  ├─ observability: trace, queue/provider metrics, alert/runbook
  └─ documentation: API/event contract, operator/support guide
```

No user-facing capability is complete if it exists in only one of these layers.

### 1.2 Cumulative Definition of Done (DoD)

Each phase has two gates:

1. **Phase-specific DoD:** outcome and evidence unique to that phase.
2. **Cumulative DoD:** all relevant obligations introduced in previous phases continue to pass after the new change.

For example, phase 1 introduces CI lint/typecheck/image builds. Phase 4 adds a worker and a database migration. Therefore phase 4 is incomplete until that worker is built/scanned/tested/deployed by CI, the migration is rehearsed, its job metrics exist, and the existing CI gates still pass. CI/CD is a *living capability*, never a closed phase.

### 1.3 What “ready to start” means

A phase may start only when:

- its explicit predecessor exit criteria are satisfied;
- open critical security/reliability defects from earlier phases are resolved or have a time-bound, owner-approved risk acceptance;
- product/design decision needed to avoid rework is recorded;
- a named engineering owner and acceptance owner exist;
- work is decomposed into independently reviewable tickets with dependency links;
- required sandbox credentials/test accounts are available without using production data/secrets.

### 1.4 What “done” never means

The following do **not** close a ticket/phase by themselves: “works on my machine”, UI screenshot, happy-path API response, manual production edit, one manual test, or a passing unit test with no authorization/retry/error behavior.

---

## 2. Delivery operating system

### 2.1 Work-item hierarchy

```text
North-star outcome
  └─ Release milestone (M0…M8)
      └─ Capability epic (one end-to-end business capability)
          └─ Story / technical deliverable
              └─ Implementation task / subtask
                  └─ Pull request(s), tests, docs, deployment evidence
```

For this solo-developer repository, create **one issue per numbered backlog item** (for example, one issue for each item in section 17). Do not create separate issues merely because an item changes CI/CD, Docker/infra, security, data, observability, documentation, or support. Record those cross-cutting aspects as an explicit checklist in the PR description and close them as part of the same backlog item.

Create a separate issue only when one aspect is independently large enough to need its own PR, acceptance criteria, rollout, and evidence. Example: “Send media message” may remain one backlog item while its PR checklist covers object-storage policy, upload UX, scan worker, provider adapter, DB migration, delivery state, test fixtures, dashboards/alerts, and retention. Split it only if, for example, the storage-security foundation is itself a separately reviewable deliverable.

### 2.2 Mandatory fields on every story

| Field | Requirement |
|---|---|
| ID/title | Stable identifier and outcome-oriented title. |
| Parent/phase | Exact epic and milestone; dependency links are reciprocal. |
| User/system outcome | Who benefits and observable expected behavior. |
| Scope / exclusions | What changes and intentionally does not change. |
| Acceptance criteria | Testable Given/When/Then behavior, including negative/error cases. |
| Technical design | Data/API/event/runtime changes or link to ADR/design note. |
| Cross-cutting impact | CI/CD, test, Docker/infra, security, data, observability, docs, support: `none`, `update`, or `new`, with explicit reason. |
| Rollout / rollback | Flag, migration sequencing, compatibility, and safe reversal. |
| Evidence | PRs, test run, preview/staging proof, dashboard/runbook/docs links. |
| Owner / reviewer | Accountable builder; name an external reviewer when one is available or the risk warrants it, but do not create an approval gate that a solo owner cannot satisfy. |

An absent impact declaration is a blocker. “None” is acceptable only with a stated reason.

### 2.3 PR contract

Every PR includes: linked numbered backlog issue; concise user/system intent; architecture/data/API/event changes; screenshots or recordings for UI; exact test evidence; migration/rollout/rollback notes; config/secret changes; observability/alert impact; security/privacy impact; documentation updates; and any follow-up issue with owner/date. The cross-cutting items are a checklist in this PR description, not a source of automatic extra issues.

Use conventional commits and protected `main`. In this solo-owner repository, branch protection is gated by **required status checks only**: required-approving-review count is **0**. GitHub does not allow a PR author to approve their own PR, so requiring approvals with one human account would permanently lock the repository. CODEOWNERS may identify ownership for `packages/db`, `infra`, auth/RLS, provider adapters, and workflows, but is informational only and must not be configured as a required-review gate. Keep PRs small enough to inspect actual behavior; use feature flags for incomplete but merge-safe work.

### 2.4 Traceability graph

Every released behavior must be traceable in both directions:

```text
Requirement / policy
  → phase → epic → ticket → ADR/design → PR → tests → image digest
  → migration → staging evidence → production deployment → dashboard/runbook
  → audit/incident/change record
```

Maintain a lightweight `docs/TRACEABILITY.md` later with requirement ID, phase, owner, implementation reference, test suite, operational signal, and status. Do not turn it into bureaucracy: it covers critical capabilities, security controls, provider behavior, and external commitments—not every CSS adjustment.

### 2.5 Change-impact ritual

Before implementation, ask these nine questions:

1. Does this create/change persisted data, migration, index, retention, backup, or deletion behavior?
2. Does it expose/change HTTP, socket, queue, outgoing webhook, or provider contract?
3. Does it create a new process, dependency, Docker image, config, health check, scaling, or shutdown behavior?
4. Does it cross organization, role, support-admin, secret, attachment, payment, or AI security boundaries?
5. What can duplicate, arrive out of order, time out, or partially fail?
6. What needs to be logged, metered, traced, alerted on, and placed in a runbook?
7. Which test layer proves success and which proves a dangerous failure is impossible?
8. How is the change switched on progressively and reversed safely?
9. Which customer/admin/support documentation changes with it?

The answers become story subtasks; they are not discussion notes that disappear after planning.

---

## 3. Cross-cutting capability ladders

These ladders solve the “we did CI/CD in phase 2 and then forgot it” problem. Every phase declares the **delta** it adds. All previously achieved levels remain enforced.

### 3.1 CI/CD ladder

| Level | Required capability | First required |
|---|---|---|
| C0 | Repository protection, pinned Node/pnpm, lockfile integrity, format/lint/typecheck. | M0 |
| C1 | Build every deployable image, unit tests, PR status checks, artifact retention. | M0 |
| C2 | Integration tests with real PostgreSQL/Redis; migration validation; secret/dependency/license scans. | M1 |
| C3 | Contract tests, container scan/SBOM, ephemeral preview or staging deployment, E2E smoke. | M2 |
| C4 | Image digest promotion, signed provenance, IaC plan/apply gate, staging smoke, deployment record. | M3 |
| C5 | Protected production environment, OIDC deploy identity, canary, automatic health/SLO gate, rollback workflow. | M5 |
| C6 | Release train, change-management evidence, scheduled resilience/performance/security gates. | M7 |

**Rule:** a new application, worker, migration, container, public route, event, or IaC module is added to every applicable existing gate in the same PR series.

### 3.2 Testing ladder

| Level | Required capability | First required |
|---|---|---|
| T0 | Test conventions, deterministic fixtures, coverage reporting, no real customer data. | M0 |
| T1 | Unit tests for domain policies and input validation. | M1 |
| T2 | Integration tests with PostgreSQL/Redis and explicit tenant/RLS negative tests. | M1 |
| T3 | Provider webhook/API contract fixtures; idempotency/retry/DLQ tests. | M2 |
| T4 | Browser E2E critical paths, visual/a11y tests, migration compatibility test. | M3 |
| T5 | Load, failure injection, security DAST, AI evaluation/release gates. | M4/M5 |
| T6 | Scheduled restore, chaos/tabletop, production synthetic monitoring. | M7 |

### 3.3 Docker, runtime, and infrastructure ladder

| Level | Required capability | First required |
|---|---|---|
| R0 | Local Compose dependencies, `.env.example`, make targets, reproducible bootstrap. | M0 |
| R1 | Multi-stage non-root images, `.dockerignore`, image build, health endpoints. | M1 |
| R2 | Worker graceful shutdown, resource limits, local full-stack Compose, migrations as one job. | M2 |
| R3 | Terraform remote state, isolated staging, managed Postgres/Redis/object storage, secret manager. | M3 |
| R4 | Immutable image digests, readiness/liveness, autoscaling policy, network segmentation, backup monitoring. | M5 |
| R5 | Multi-AZ/DR configuration, capacity thresholds, production recovery validation. | M7 |

### 3.4 Security and privacy ladder

| Level | Required capability | First required |
|---|---|---|
| S0 | Threat-model backlog, secret handling rules, dependency/secret scanning. | M0 |
| S1 | Auth, RBAC, tenant RLS, secure sessions, audit foundation, security headers. | M1 |
| S2 | Meta signature verification, encrypted channel secrets, rate limiting, strict provider boundaries. | M2 |
| S3 | Attachment scan/SSRF protection, support-access controls, retention/deletion foundations. | M3 |
| S4 | AI data minimization/prompt-injection controls, DPA/vendor review, export/deletion workflow. | M4 |
| S5 | SSO/MFA/SCIM, external pentest, incident exercise, access reviews. | M7 |

### 3.5 Observability and operations ladder

| Level | Required capability | First required |
|---|---|---|
| O0 | Structured logs, correlation ID, `/livez` and `/readyz`, error reporting. | M0 |
| O1 | Metrics/traces for API, DB, auth; operational dashboard. | M1 |
| O2 | Webhook, queue, provider status, DLQ dashboards/alerts and runbooks. | M2 |
| O3 | AI/knowledge/media metrics, cost/budget visibility, synthetic journey. | M4 |
| O4 | SLOs/error budgets, on-call routing, status page, incident process. | M5 |
| O5 | Restore/DR evidence, capacity review, executive/customer operations reports. | M7 |

### 3.6 Documentation and product-quality ladder

| Level | Required capability | First required |
|---|---|---|
| D0 | README, ADR format, coding/API conventions, contribution/setup guide. | M0 |
| D1 | OpenAPI, data/event contracts, role matrix, admin/operator guide for built capability. | M1 |
| D2 | Provider setup/troubleshooting, support runbooks, changelog/release notes. | M2 |
| D3 | Accessibility/design-system baseline, localized copy, privacy/security docs. | M3 |
| D4 | Customer onboarding, billing/plan documentation, integration guides, status/SLA docs. | M6 |

---

## 4. Phase map and dependencies

```text
M0 Execution foundation
  ↓
M1 Secure multi-tenant platform core
  ↓
M2 WhatsApp inbound-to-agent vertical slice
  ↓
M3 Operational inbox, outbound reliability, templates & media
  ↓
M4 Knowledge ingestion + controlled AI in draft mode
  ↓
M5 Routing + policy-controlled auto-send + production delivery platform
  ↓
M6 Billing, integrations, analytics, customer self-service
  ↓
M7 Enterprise hardening + design-partner beta
  ↓
M8 GA launch + continuous operation
```

The arrows are capability dependencies, not a ban on parallel preparation. Design, research, Terraform modules, test harnesses, and UI prototypes may proceed early, but the phase cannot be declared complete out of order.

### 4.1 Milestone summary

| Milestone | Customer-visible proof | Key dependency it unlocks |
|---|---|---|
| M0 | A developer can reproduce the platform foundation and CI gives trusted feedback. | Safe team development. |
| M1 | An organization can securely access an isolated empty workspace. | Tenant-owned data and authorized UI/API. |
| M2 | A WhatsApp inbound message becomes an isolated conversation; agent can reply. | Real customer traffic. |
| M3 | A team operates a reliable, real-time inbox with templates/media. | Production operator workflow. |
| M4 | Admin-approved knowledge produces safe, cited agent drafts. | AI value without unsafe autonomy. |
| M5 | Approved automation can route/auto-send under policy, with production-grade delivery/release controls. | Controlled automation revenue proposition. |
| M6 | Customers can self-manage channels/API keys, view analytics, and operate for free (Billing optional/on-hold). | Commercial self-service operation & analytics. |
| M7 | Design partners operate safely under enterprise controls and support. | GA confidence. |
| M8 | Public selling and ongoing SLO-driven operation. | Scale and roadmap delivery. |

---

## 5. M0 — Execution foundation

### Goal

Create a reproducible, secure, reviewable development system. M0 produces no customer feature; it prevents every later capability from becoming untestable or non-deployable.

### Ordered work

1. **Repository governance**
   - Create monorepo layout: `apps/{web,api,ingress,worker,scheduler}`, `packages/{db,domain,contracts,providers,config,observability,ui}`, `infra`, `docs`.
   - Add Node 22 LTS/pnpm version pinning, strict TypeScript base config, ESLint/Prettier, EditorConfig, import boundaries, conventional commits, CODEOWNERS, PR/issue templates, SECURITY.md, and contribution guide.
   - Add ADR template and record ADR-001: modular-monolith/process-role architecture; ADR-002: PostgreSQL RLS tenant boundary; ADR-003: deployment reference architecture.
2. **Developer experience**
   - Add `make bootstrap`, `make dev`, `make test`, `make lint`, `make typecheck`, `make build`, `make db-reset` (explicitly local only), `make compose-up/down`, and `make verify`.
   - Compose starts PostgreSQL + pgvector, Redis, MinIO, Mailpit, OpenTelemetry collector, and optional Grafana/Prometheus. Seed only synthetic organization/user/message data.
   - Add configuration package with Zod validation and environment-specific `.env.example`; fail closed for missing config.
3. **First deployable skeleton**
   - API exposes `/livez`, `/readyz`, version/build metadata, structured JSON logger, request ID, error response envelope, and OpenTelemetry bootstrap.
   - Web renders a shell with health/build information through a typed API client.
   - Ingress/worker/scheduler boot and terminate cleanly but have no domain behavior yet.
4. **CI baseline (C0/C1)**
   - PR workflow: dependency install from lockfile, format, lint, strict typecheck, unit test, build all packages, build all images, upload test/build artifacts.
   - Include secret scanning, dependency review, and changed-workspace detection. Pin third-party Action commits.
   - Main branch protection requires CI and review; CI does not deploy.
5. **Foundation decisions and backlog**
   - Create product requirement IDs, initial threat model, data inventory draft, domain glossary, role matrix draft, event naming rules, API style guide, severity taxonomy, and feature-flag registry format.

### M0 exit demonstration

On a clean machine/CI runner: clone → `make bootstrap` → `make dev` results in web/API/dependencies running; `make verify` passes; a deliberate type/lint/unit-test/image failure blocks a PR; service logs show request and trace IDs without secret leakage.

### M0 DoD

- [ ] All C0/C1, T0, R0, S0, O0, D0 requirements are evidenced in repository/CI.
- [ ] Every process starts with validated config and exits gracefully under SIGTERM.
- [ ] Docker images build without developer-local dependencies and run as non-root where compatible.
- [ ] No production credentials, customer data, or hard-coded secrets exist in repo/test fixtures/logs.
- [ ] ADRs and a Phase 1-ready backlog are reviewed.
- [ ] CI duration, flaky-test policy, failure ownership, and artifact retention are documented.

---

## 6. M1 — Secure multi-tenant platform core

### Goal

An organization owner can securely enter a new isolated workspace, invite an operator, and prove that neither user can access any other organization’s data.

### Ordered work

1. **Database baseline before feature UI**
   - Create Prisma schema and hand-written SQL migrations for UUIDv7/extension setup, `organizations`, identity/membership/roles, `audit_logs`, `idempotency_keys`, `outbox_events`, and initial settings.
   - Implement database roles: migration owner, app runtime `NOBYPASSRLS`, reporting/break-glass role. Write RLS policies for every tenant-owned table and test `SET LOCAL app.organization_id` transaction helper.
   - Establish expand/backfill/contract migration template; CI applies all migrations to empty and previous-schema fixture database.
2. **Identity and authorization**
   - Implement chosen identity integration, verified email/invites, secure HttpOnly session/refresh rotation, logout/revocation, organization bootstrap, membership lifecycle, password/MFA flow only if product decision requires it.
   - Implement permissions—not role string checks scattered through controllers—and route/service authorization middleware.
   - Implement platform admin boundary as a future separate audience/host; do not add tenant-bypass API routes.
3. **API/web app shell**
   - Deliver authenticated route guard, organization switcher only if user belongs to multiple organizations, invitation acceptance, team list, role-safe settings shell, error/empty/loading/permission-denied states.
   - Build OpenAPI/Zod contract generation, cursor response primitives, RFC 9457 problem response, `Idempotency-Key` middleware, and audit event helper.
4. **Observability/security hardening**
   - Add CSP/CSRF/cookie/CORS/security headers, login and API rate limits, PII redaction in logs, auth/DB/authorization metrics and traces.
   - Create audit viewer restricted to proper permission and emit audit events for auth, invite, role, organization/security setting changes.
5. **CI/runtime upgrades (C2/T1/T2/R1/S1/O1/D1)**
   - Add Testcontainers PostgreSQL/Redis integration suite including cross-tenant negative test for every repository/API scope.
   - Add database migration validation, dependency/license policy, image vulnerability scan, and baseline coverage threshold for domain/auth code.
   - Add multi-stage hardened images, health endpoint tests, operational dashboard for API/auth/DB, and initial role matrix/admin guide.

### M1 exit demonstration

Create organization A and B; invite an operator into A; authenticate as each role; try direct REST IDs, search, browser routing, socket token, and database repository calls targeting B. All are denied/empty by design, while allowed A workflows work. Audit events show the security-sensitive actions.

### M1 DoD

- [ ] All tenant tables have RLS, non-null `organization_id`, indexes, and integration negative tests.
- [ ] No app runtime database path can query without tenant context; privileged migrations/support access are separate.
- [ ] Session, membership, idempotency, API error, audit, and role behavior have documented contracts and tests.
- [ ] M0 gates remain green; M1 delta is added to CI, image/runtime configuration, monitoring, and docs.
- [ ] Staging database migration rehearsal and rollback/forward notes are stored with the release.

---

## 7. M2 — WhatsApp inbound-to-agent vertical slice

### Goal

Safely receive a real/sandbox WhatsApp webhook, turn it into a tenant-isolated conversation, and let an authorized agent send one plain-text reply with full durability and traceability.

### Ordered work

1. **Channel model and connection lifecycle**
   - Add `channels`, encrypted credential references, connection status/history, sender ownership metadata, and tenant-scoped channel permissions.
   - Build a test/sandbox connection path and state machine `DRAFT → CONNECTING → ACTIVE | DEGRADED | DISCONNECTED`. Implement only official Meta Cloud API adapter interface; fake adapter supports local/E2E tests.
2. **Ingress as a durable boundary**
   - Use raw-body Express route dedicated to Meta verification and callbacks. Validate verify token and HMAC signature in constant time before JSON processing.
   - Persist raw provider event (encrypted/reference), SHA-256 hash, provider identity, validation status, correlation ID, receive timestamp, and processing state before acknowledging.
   - Return a retryable error if durable persistence fails. A Redis outage must not lose a durably stored event; sweeper later queues pending events.
3. **Message domain and async pipeline**
   - Add `contacts`, `conversations`, `messages`, `message_status_events`, `conversation_events`, `webhook_events`, `outbound_intents`, and indexes/state policies.
   - Worker normalizes inbound text/contact/status events; de-duplicates provider IDs; creates/updates a contact and active conversation in one transaction; inserts domain event/outbox record; publishes browser projection.
   - Implement service-window eligibility as one policy service, but use it only to inform UI/intent validation in this phase.
4. **Minimal operator vertical UI**
   - Agent sees a paginated personal/team-safe list, opens timeline, and sends text reply via composer.
   - API validates permission, conversation optimistic version, outbound idempotency key, payload limits, channel status, and creates intent—not a direct provider call.
   - Send worker claims intent, calls fake/Meta adapter, records request/response redacted reference, updates state, retries only classified transient failures, and emits timeline/realtime update.
5. **Operations and quality upgrade (C3/T3/R2/S2/O2/D2)**
   - Provider contract fixture suite covers webhook signature, duplicate/incomplete/out-of-order status, error mapping, and outbound payload.
   - Test crash/retry between each side effect; prove 100 duplicate webhooks yield one message and at most one outbound intent/send.
   - Add queue separation/concurrency config, DLQ, replay command restricted to support role, graceful worker shutdown, queue/webhook/provider dashboards and alerts/runbooks.
   - Update developer/provider setup and operator troubleshooting guides.

### M2 exit demonstration

From a sandbox/test sender, submit an inbound text and replay the identical webhook repeatedly. It appears once in the correct tenant’s inbox. An assigned agent sends one reply; worker/provider status transitions appear once in the timeline and audit trail. Stop Redis or a worker during processing, restore it, and prove reconciliation completes without loss or duplicate send.

### M2 DoD

- [ ] Signed webhooks are raw-body verified, persisted first, idempotently normalized, and independently replayable.
- [ ] All inbound/outbound effects use database-backed idempotency and durable outbox—not Redis-only locks.
- [ ] Tenant/RBAC checks cover channels, contacts, conversations, messages, events, and real-time rooms.
- [ ] Webhook/queue/provider error rate, lag, oldest job, DLQ, duplicate, and send lifecycle are observable with documented alerts/runbooks.
- [ ] CI executes provider contract and worker failure/idempotency tests; updated image/worker startup and shutdown tests pass.
- [ ] API/event/provider setup documentation, data retention classification, and support procedure are updated.

---

## 8. M3 — Operational inbox, reliable outbound, templates, and media

### Goal

Turn the minimal conversation view into the daily operating workspace for a support team, including controlled assignment, handoff, templates, attachments, and reliable real-time behavior.

### Ordered work

1. **Conversation operations**
   - Implement queue/team model, assignment claim/release, private notes, tags, unread/read markers, resolve/reopen, waiting state, pause/resume bot placeholder, SLA timestamps, business hours, and optimistic concurrency behavior.
   - Define every state transition in domain policy and event timeline. Explicitly test races: two claims, send after close, stale tab update, agent removed during action.
2. **Realtime correctness**
   - Add Socket.IO authenticated connection, organization/team/conversation room authorization, Redis adapter, event schema versions, reconnect/reconciliation protocol, presence/capacity only if privacy policy supports it.
   - Browser treats events as hints/projections and refetches on version gaps. No message body is written into third-party browser telemetry.
3. **Templates and provider eligibility**
   - Add template sync records/status, versioned approved template model, component/variable validation, service-window/template eligibility service, preview/audit of rendered payload, and terminal error guidance.
   - Sync provider state idempotently; no local template is assumed approved without provider status.
4. **Attachment/media pipeline**
   - Add private presigned upload flow, MIME magic-byte/type/size validation, checksum, malware scan/quarantine, encrypted object storage metadata, provider upload/download adapter, secure download authorization, lifecycle/retention.
   - Handle scan/provider failures safely; media is never served with permanent public URLs.
5. **Web UX quality**
   - Build keyboard-accessible queue list/timeline/composer; add saved filters, empty/loading/offline/error/conflict states, responsive triage layout, and localized Bahasa Indonesia/English strings for shipped screens.
6. **Release/quality upgrades (T4/R3/S3/D3)**
   - Browser E2E: agent login → inbound → claim → note/tag → text/template/media send → status update; negative authorization and reconnect checks.
   - Add a11y checks, visual regression for critical states, migration compatibility test, staging object-storage/malware fixture test, and SSRF/file-upload security tests.
   - Provision isolated staging infrastructure and secret manager through reviewed Terraform; update images/runtime manifests, network policies, retention and support guides.

### M3 exit demonstration

Two agents and a supervisor work the same simulated queue across browser tabs. Only authorized actions succeed; state conflicts are visible; one agent safely claims and replies with a provider-approved template and scanned attachment; delivery updates reconnect correctly after an API restart. All operations are traceable/auditable and no attachment is publicly accessible.

### M3 DoD

- [ ] Inbox actions have domain transition tests, API integration tests, and browser E2E coverage including conflict/reconnect/error states.
- [ ] Media pipeline has authorization, checksum, scan/quarantine, provider error, retention, and deletion behavior tested.
- [ ] Realtime has auth, room isolation, version/reconciliation, backpressure/connection metrics, and disconnect runbook.
- [ ] Templates and service eligibility are centralized, fixture-tested, and explain failure safely to operator.
- [ ] Terraform/staging and all C0–C3/T0–T4/R0–R3/S0–S3/O0–O2/D0–D3 obligations are met.

---

## 9. M4 — Knowledge ingestion and AI assistant in draft mode

### Goal

An admin can publish approved tenant knowledge and agents can receive safe, evidence-backed AI reply drafts. The bot cannot auto-send in this milestone.

### Ordered work

1. **Knowledge data/version model**
   - Add sources, documents, chunks, knowledge sets/versions, ingest jobs, content hashes, parse/embedding metadata, source permissions, publish/archive/delete state, and vector indexes benchmarked on representative data.
   - Define immutable published version semantics. A bot run snapshots exact bot/knowledge/model/prompt version.
2. **Safe ingestion pipeline**
   - Text/file/approved-URL source intake; reuse hardened attachment pipeline; URL fetcher denies private IPs/metadata targets, controls DNS rebinding/redirects, permits protocols/content types, and enforces size/time limits.
   - Virus scan, parse/normalize/extract, chunk with content hash/metadata, embed through provider adapter/cache, index, report progress and safe error reason. Retry is idempotent per source/version.
3. **Retrieval and bot configuration**
   - Add bot draft/published versions, language/tone/instructions, source allow-list, retrieval top-K/threshold, allowed hours, fallback/escalation rules, `OFF`/`DRAFT` mode, and organization emergency disable.
   - Retrieve only organization/version-scoped approved chunks. Build bounded conversation context and structured provider output with citations. Enforce source quality threshold; insufficient evidence must create escalation/no answer.
4. **Draft experience and audit**
   - In the conversation timeline/composer show AI draft, source citations/internal confidence/reason, token/cost estimate where permitted, approve/edit/send/reject controls, and feedback taxonomy.
   - Persist `bot_runs`, retrieval evidence, policy result, output hash, latency/tokens/cost model metadata. Human approval creates the standard outbound intent path from M2/M3.
5. **AI safety and quality release gate (T5/S4/O3)**
   - Build anonymized/versioned evaluation set: grounded, no-evidence, multilingual, ambiguous, prompt injection, policy-sensitive, escalation and cost-limit cases.
   - Add prompt-injection rules, PII minimization/redaction, provider data-handling configuration, budget/rate limits, circuit breaker, and failure fallback. No raw prompts/answers in default logs.
   - CI runs schema/policy/retrieval tests; scheduled evaluation produces metrics. Dashboard shows ingestion states, retrieval quality indicators, provider latency/error, AI cost/budget, block/escalation rate.

### M4 exit demonstration

Admin uploads a clean and a malicious/invalid source, publishes a knowledge version, and sends a representative question. Agent receives a cited draft only when evidence exceeds policy; an unsupported/injected question escalates safely. Rejected source and AI provider outage produce clear statuses, no data leak, and no outbound send.

### M4 DoD

- [ ] Bot is hard-limited to `OFF`/`DRAFT`; no path can auto-send, including retries/races.
- [ ] Every usable answer is attributable to bot/config/knowledge/model/prompt/evidence versions and human approval.
- [ ] Knowledge source and chunk queries are RLS/version scoped; ingest/delete/retention and URL/file safety are tested.
- [ ] AI evaluation threshold, cost budget, provider fallback/circuit behavior, policy audit, and emergency disable work in staging.
- [ ] Existing inbound/outbound, CI/CD, image, tracing, alert, and support standards include AI/knowledge processes.

---

## 10. M5 — Controlled automation and production release platform

### Goal

Enable qualified automatic responses and routing under strict policy, while upgrading deployment, monitoring, and operational controls to production-grade standards.

### Ordered work

1. **Routing and automation policy engine**
   - Implement deterministic ordered rules: channel/contact/tag/language/time/intent/queue capacity/bot state/consent/plan entitlement. Rules have draft/published version, priority, simulator, trace output, and conflict detection.
   - Define auto-send allow-list, max replies per contact/conversation/time window, required confidence/evidence, prohibited intents, business-hour behavior, template/window eligibility, escalation conditions, and mandatory customer disclosure where required.
2. **Auto-send state machine**
   - Introduce `AUTO` only per bot version/channel/organization explicit opt-in. Before send, re-check current conversation version/assignment/pause/emergency status and eligibility—draft-time approval is not enough.
   - Auto-send uses same `outbound_intents`/provider delivery pipeline as agents; causal link to inbound message and bot run is mandatory. Handoff or manual action cancels unsent automated intent atomically where possible.
   - Add globally scoped and tenant scoped kill switches with audited reason/expiry; test propagation to running workers/queued jobs.
3. **Production CI/CD (C4/C5/R4/O4)**
   - Build once, scan/SBOM/provenance attest, publish immutable image digest, promote identical digest staging→production.
   - Terraform plan/apply uses protected environments and short-lived cloud OIDC. Staging deploy runs migration validation, synthetic webhook/provider test, smoke/E2E.
   - Production uses expand-compatible migrations, canary 5%→25%→100%, explicit pause/rollback, health/SLO/queue/provider gates, deploy/change record, and post-deploy synthetics.
4. **SLO and incident operating model**
   - Implement defined availability/webhook/queue/outbound/AI SLOs and error budget dashboard. Configure P1/P2 routing, status page, on-call runbooks, provider outage/playbook, incident roles/templates.
   - Conduct staged failure drills: worker crash, Redis outage, DB failover simulation, Meta 429/5xx, AI timeout, stale websocket; prove safe mode and reconciliation.
5. **Auto-send release gate**
   - Per bot version pass evaluation threshold, peer/security/product approval, staged tenant enablement, human sampling plan, rate/cost ceiling, rollback owner, and clear customer consent/settings.

### M5 exit demonstration

A controlled beta tenant enables auto-send for an approved FAQ. A qualifying message is routed, evidenced, and sent once; a human takeover, insufficient evidence, plan limit, provider 429, and global kill switch each prevent/safely halt automation. A canary deployment progresses/rolls back based on measurable signals without manual server editing.

### M5 DoD

- [ ] Auto-send is policy-gated, opt-in, rate/cost limited, evidence-backed, audited, and can be disabled globally/tenant/bot/conversation levels.
- [ ] Production deployment consumes immutable verified images with OIDC, staging promotion, canary, automated health gates, and documented rollback.
- [ ] SLOs, alerts, on-call ownership, status communication, incident runbooks, and failure drill evidence are live.
- [ ] All previous ladders remain green; new policy/routing/auto-send paths have unit, integration, E2E, load/failure, and AI-evaluation evidence.

---

## 11. M6 — Customer self-service, integrations, analytics, and optional billing

### Goal

Make FlowDesk self-service and production-operable for all customers: administrators self-manage channels and seats for free, developers integrate safely via scoped API keys/webhooks, and operational analytics provide rich team performance insights. (Stripe/Paid Billing is held as an optional modular extension for later).

### Ordered work

1. **Customer self-service & Channel Onboarding**
   - Deliver self-service channel management (Meta WhatsApp Business connection UI), seat/team administration, API-key lifecycle (prefix + hash only), scoped integration webhooks, endpoint verification, signed deliveries, retry/history/DLQ, and audit trail.
   - FlowDesk runs as a **Free & Open Community Tier** by default with zero paywalls.
2. **Analytics and reporting**
   - Define metrics glossary: inbound/outbound volume, first response time, resolution rates, queue/SLA compliance, agent workload, bot draft/accept/escalation metrics, knowledge health, and system telemetry.
   - Create asynchronous aggregate read models; provide exports with authorization, rate limits, watermarks, audit log tracking, and retention.
3. **[OPTIONAL / ON-HOLD FOR LATER] Billing & Entitlements Foundation**
   - Modular plan catalog/version, paid tier entitlements, subscription state, usage ledger, and billing provider (Stripe) webhook adapter. Held on standby for future monetization needs.
4. **Quality & documentation expansion**
   - Integration delivery dashboard, analytics freshness metrics, export/deletion security tests, customer API documentation, and support scripts.

### M6 exit demonstration

Administrator self-connects a WhatsApp channel in the UI, rotates a scoped API key, and inspects signed integration webhook retries. Supervisor views a live metric report and exports authorized CSV reports; customer operates 100% free with full self-service controls.

### M6 DoD

- [ ] All customer self-service channel onboarding, API keys, and webhooks are fully functional and audited in the UI.
- [ ] Analytics engine provides metric definitions, privacy/RBAC, freshness/error behavior, scalable read paths, export controls, and customer documentation.
- [ ] Billing architecture is documented as an optional on-hold module without blocking free customer usage.

---

## 12. M7 — Enterprise hardening and design-partner beta

### Goal

Validate FlowDesk with real design partners and complete the controls required to make credible enterprise promises.

### Ordered work

1. **Enterprise identity and administration**
   - Add SAML/OIDC SSO, enforced MFA/session policies, SCIM lifecycle provisioning where packaged, verified domains, device/session management, and separate audited support-console impersonation/break-glass workflow.
2. **Security/compliance evidence**
   - Complete data inventory, DPA/subprocessor/security documentation, retention/deletion/export flow, quarterly access review process, key/credential rotation, vendor assessment, risk register, and policy ownership.
   - Engage independent penetration test; triage/remediate findings; run SAST/DAST/container/dependency/secret scans continuously. Do not claim certification without formal scope/audit.
3. **Reliability/capacity/DR**
   - Load test forecast and 2× forecast traffic; benchmark retrieval/vector, queue, websockets, migration, and API connection pools. Record thresholds and scaling actions.
   - Prove RPO/RTO via isolated restore; execute DR, credential compromise, tenant-isolation, Meta outage, and harmful-AI-reply tabletops. Resolve action items.
4. **Beta operation**
   - Onboard limited design partners through documented checklist; configure explicit beta flags/limits; weekly review SLO, quality, tickets, costs, provider health, and feedback.
   - Run customer support escalation, incident/status communication, change communication, and training. No broad launch until measured beta exit conditions pass.
5. **Release hardening (C6/T6/R5/S5/O5/D4)**
   - Add scheduled restore/resilience/performance/security tests, release train/change evidence, executive/customer operational reporting, complete runbooks/ownership and launch material.

### Beta exit criteria

- [ ] Agreed number/type of beta tenants have completed representative workflows for agreed period without unresolved P1 or repeat P2 failure.
- [ ] SLOs, recovery objectives, AI evaluation/feedback, queue/provider performance, and support response meet published beta thresholds.
- [ ] Pentest/high-risk review findings are resolved or formally risk accepted by authorized leadership with compensating control and expiry.
- [ ] Restore and incident drills have evidence and all material follow-ups are closed.
- [ ] Legal/commercial/customer-support documents match the product actually shipped.

---

## 13. M8 — General availability and continuous operation

### Goal

Launch deliberately, operate by SLO/error budget, and evolve FlowDesk without degrading foundational controls.

### Launch sequence

1. Hold go/no-go review against the Enterprise Specification launch checklist and M7 beta exit evidence. Product, engineering, security, operations/support, and legal/commercial owners each sign their scope.
2. Freeze nonessential high-risk changes; verify production images/config/secrets, backups, alert routing, status page, billing, provider contacts, support staffing, and rollback path.
3. Enable new customers in cohorts with measured capacity/support headroom. Observe first onboarding, sender connection, inbound, manual reply, AI draft/auto-send, billing, and support journeys.
4. Run daily launch review then transition to weekly operations review. Prioritize bugs/reliability/security over roadmap expansion while error budget is unhealthy.

### Continuous rules

- Every roadmap feature enters the same story/PR/change-impact/DoD system; no “post-GA shortcut.”
- Monthly: access review, vulnerability triage, cost/capacity/flag/credential-expiry review.
- Quarterly: restore test, incident exercise, provider/version/dependency review, disaster-recovery and retention validation.
- Release decisions depend on SLO/error-budget state, not just date pressure.

---

## 14. Phase-by-phase cross-cutting matrix

This is the mandatory anti-forgetting map. `Maintain` means all preceding requirements still apply; `Add` is the new deliverable.

| Track | M0 | M1 | M2 | M3 | M4 | M5 | M6 | M7/M8 |
|---|---|---|---|---|---|---|---|---|
| CI/CD | Add C0–C1 | Add C2 | Add C3 | Maintain + staging checks | Add provenance/digest promotion preparation | Add C4–C5 canary | Add provider contract coverage | Add C6 release train |
| Tests | Add T0 | Add T1–T2 | Add T3 | Add T4 | Add AI eval portion T5 | Complete T5 failure/load | Billing/integration contracts | Add T6 restore/chaos |
| Docker/infra | Add R0 | Add R1 | Add R2 | Add R3 | Maintain | Add R4 | Scale/read-model needs | Add R5 DR/capacity |
| Security/privacy | Add S0 | Add S1 | Add S2 | Add S3 | Add S4 | Maintain/validate auto-send | Billing/API/data-export controls | Add S5/pentest/SSO |
| Observability | Add O0 | Add O1 | Add O2 | Maintain | Add O3 | Add O4/SLO/on-call | Financial/integration metrics | Add O5/DR evidence |
| Docs/product | Add D0 | Add D1 | Add D2 | Add D3 | AI admin guide/eval policy | Incident/status docs | Add D4 customer docs | Launch/enterprise docs |
| Data | Baseline conventions | RLS/migrations | messaging/event/outbox | media/template/conversation state | versioned knowledge/vector | automation/audit retention | billing/analytics read models | backup/restore/DSAR proof |

No phase is allowed to mark a track “N/A” merely because no dedicated engineer is assigned. The phase lead assigns ownership or removes the feature from scope.

---

## 15. Generic DoD checklists, applied to every capability

Use the relevant items below as a checklist in the PR description for the numbered backlog item being delivered. They are not a template for creating new issues; create an additional issue only when a concern is independently large enough to require its own PR, acceptance criteria, rollout, and evidence.

### 15.1 Backend/domain DoD

- [ ] Domain state transitions, invariants, authorization, idempotency, and error taxonomy are explicit and unit-tested.
- [ ] API/event DTOs are schema validated/versioned; breaking change has a migration/deprecation plan.
- [ ] All tenant data access occurs inside tenant context/RLS transaction; negative tests prove isolation.
- [ ] Transaction boundary, outbox/event publication, concurrency behavior, and retry safety are documented/tested.
- [ ] Input limits, pagination/query budgets, rate limits, and provider timeouts are defined.

### 15.2 Frontend/UX DoD

- [ ] Design/interaction states include loading, empty, validation, server error, offline/reconnect, permission denied, conflict, and irreversible-action confirmation.
- [ ] Uses typed API/event contracts; never makes authorization assumption from UI visibility.
- [ ] Accessibility: keyboard, focus, semantics, labels/errors, contrast; critical flow checked automatically and manually.
- [ ] UI does not expose secrets/PII in logs, analytics, URLs, or cached unauthorized screens.
- [ ] Analytics events and localization are intentional and privacy-reviewed.

### 15.3 Data/migration DoD

- [ ] Schema ownership, constraints, indexes, RLS, retention/deletion, encrypted fields, and query plan impact reviewed.
- [ ] Migration is expand-compatible, reversible/forward-fix documented, test-rehearsed, and runs once under deploy lock.
- [ ] Backfill has throttling, resume key, progress metric, error path, and rollback/cutover condition.
- [ ] Backup/restore and analytics impact are assessed; no unbounded query is added to a hot transaction path.

### 15.4 Async/provider DoD

- [ ] Side effects have durable intent/event, idempotency key/unique constraint, retry classification, timeout, backoff/jitter, DLQ, and safe replay behavior.
- [ ] Duplicate, out-of-order, provider 4xx/429/5xx, timeout, worker crash, and reconciliation are tested.
- [ ] Provider secrets/payloads are encrypted/redacted; version, rate limits, and deprecation owner are recorded.
- [ ] Queue concurrency/priority/backpressure and job cleanup/retention are defined.

### 15.5 CI/CD and Docker DoD

- [ ] New package/process/image is included in install, lint, typecheck, test, build, scan, artifact/image publication, and deployment manifests.
- [ ] Image is reproducible, pinned, non-root, minimal, scanned/SBOM’d at applicable level, has health/graceful shutdown/resource requirements.
- [ ] Config schema, secret references, readiness, scaling, network access, and runtime permissions are updated per environment.
- [ ] Deployment uses immutable artifact digest; migration and rollback/feature flag plan are recorded.

### 15.6 Security/operations/docs DoD

- [ ] Threat/privacy impact assessed; RBAC/RLS, audit event, rate/abuse limit, secret handling, and retention changes implemented.
- [ ] Logs/metrics/traces/dashboards/alerts and runbook cover success/failure; PII redaction verified.
- [ ] Support/admin/developer docs, OpenAPI/event schema, release note and status communication needs updated.
- [ ] Owner, on-call route, SLO impact/cost impact, feature flag/kill switch, and rollback are clear.

---

## 16. Release workflow for every milestone

```text
Plan → Design/ADR → Slice tickets → Implement behind safe boundary
     → PR/CI → Preview or staging → integration/E2E/security checks
     → demo against acceptance criteria → phase evidence review
     → release/promotion → post-release synthetic checks → retrospective
```

### 16.1 Required phase-close evidence packet

Phase owner publishes a short release note containing:

1. customer capability delivered and excluded scope;
2. linked epics/PRs/ADRs/migrations/image digests;
3. test and staging evidence, including known limitations;
4. cross-cutting matrix delta completed;
5. dashboards/alerts/runbooks/docs added or changed;
6. security/privacy review result;
7. rollout/rollback result and unresolved risks with owner/date;
8. next-phase prerequisites confirmed.

An evidence packet is a practical written handoff, not a slide presentation. It makes it possible to stop/restart the project without rebuilding context from memory.

### 16.2 Definition of a blocked phase

Stop and resolve rather than build around it when there is: unclear tenant/data ownership; a missing required provider/legal decision; inability to prove a security boundary; a broken migration/backup path; no safe testing environment; uncontrolled production access; or recurring flakiness that invalidates CI trust. Record a decision/risk, not an invisible workaround.

---

## 17. Initial M0 backlog in exact execution order

This is the first actionable queue after approving this blueprint. Do not open feature implementation before items 1–12 are completed or explicitly re-sequenced by ADR.

1. Create Git repository controls: protected `main` gated by required status checks only; required-approving-review count = `0`; CODEOWNERS informational only (not a required-review gate); issue/PR templates; SECURITY.md. This is required because a solo owner cannot self-approve a GitHub PR, and a required-review rule would otherwise lock the repository permanently.
2. Initialize pnpm/Turborepo workspace, Node/pnpm pins, shared TypeScript/ESLint/Prettier configuration, and workspace boundaries.
3. Create application/package directory skeleton and minimal buildable `api`, `web`, `ingress`, `worker`, `scheduler` processes.
4. Add `packages/config` with schema-validated configuration, `.env.example`, config documentation, and tests for fail-closed startup.
5. Add Dockerfiles, `.dockerignore`, non-root execution, Compose dependency profile, Makefile, and clean-machine bootstrap guide.
6. Add CI C0/C1 workflow with lockfile install, format/lint/typecheck/unit/build/image build, secret scan, artifact retention, and intentionally failing verification.
7. Add structured logger, correlation/request IDs, OpenTelemetry skeleton, health endpoints, error envelope, and redaction tests.
8. Write ADRs only for real decisions with meaningful alternatives and tradeoffs (for example, Turborepo versus Nx); do not create ADRs merely to restate choices already dictated by this blueprint or the enterprise specification. Also add the initial domain glossary, API/event naming conventions, threat model backlog, and severity/runbook template.
9. Configure local PostgreSQL+pgvector/Redis/MinIO/Mailpit/observability services and synthetic seed data.
10. Create test harness conventions and one unit test per application/package; enforce deterministic test setup.
11. Add initial Terraform structure/state backend and validate formatting/plan in CI without applying infrastructure.
12. Run M0 exit demonstration from a fresh clone, fix friction, then create/review the M1 tickets using the mandatory story template.

### The exact next action

Start with **M0 item 1** and create one issue for each numbered M0 backlog item at the same time. Once M0 is green, do not jump to AI or inbox UI: start M1 with database tenant/RLS foundation. This ordering prevents FlowDesk’s most expensive possible rework—retrofitting tenant isolation, auditability, and delivery discipline after real messaging data exists.
