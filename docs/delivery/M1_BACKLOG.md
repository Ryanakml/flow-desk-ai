# M1 secure multi-tenant platform core backlog

- Milestone owner: `@Ryanakml`
- Engineering owner: `@Ryanakml`
- Acceptance owners: product owner for customer behavior; independent security reviewer for tenant-boundary stories
- Entry dependency: M0 evidence packet accepted and required GitHub checks active
- Exit proof: organization A/B isolation demonstration defined by the execution blueprint
- Review status: execution-ready decomposition; assignees/reviewers must be confirmed on the GitHub issues before work starts

M1 is one vertical platform slice. Database isolation precedes identity and UI; no story may introduce a tenant-owned query outside the transaction-scoped tenant repository contract.

## Epic M1-E1 — Tenant-safe persistence foundation

### M1-01 — Establish database extensions, roles, and migration discipline

- **Outcome:** migrations and runtime access use separate least-privilege database identities on a reproducible empty database.
- **Depends on:** M0-12.
- **Scope:** Prisma baseline; UUIDv7/required extensions; migration owner, runtime `NOBYPASSRLS`, reporting, and break-glass roles; expand/backfill/contract template. Excludes tenant business tables beyond M1 scope.
- **Acceptance:** empty and previous-schema fixtures migrate forward; runtime role cannot create schema, change roles, disable RLS, or read without an applicable policy; break-glass use requires an explicit audited path; rollback/roll-forward notes exist.
- **Design:** `packages/db` owns Prisma plus hand-written SQL where Prisma cannot express roles, extensions, or policies. Migration execution is a separate release job.
- **Cross-cutting:** CI `new`; tests `new`; Docker `update`; security `new`; data `new`; observability `update`; docs/support `update`.
- **Delivery:** expand-compatible migrations first; feature remains dark. Prefer roll-forward; local reset stays guarded by `APP_ENV=local`.
- **Evidence:** migration logs for empty/previous fixtures, role capability matrix, SQL integration tests, migration runbook.
- **Owners:** engineering `@Ryanakml`; approval database CODEOWNER plus independent security reviewer.

### M1-02 — Create organization, identity, membership, settings, audit, idempotency, and outbox tables

- **Outcome:** every M1 persistent record has explicit ownership, lifecycle metadata, indexes, and safe deletion semantics.
- **Depends on:** M1-01.
- **Scope:** only tables required by M1; organization-global tables must be explicitly justified. Excludes contacts, conversations, messages, channels, AI, and billing domain data.
- **Acceptance:** IDs, timestamps, uniqueness, foreign keys, status constraints, retention metadata, and organization indexes match documented contracts; no nullable tenant key exists on tenant-owned tables; seed data is synthetic.
- **Design:** schema and data dictionary change together; audit/outbox payloads are versioned and exclude secrets.
- **Cross-cutting:** CI `update`; tests `new`; Docker `none` (existing DB); security/data/docs `new`; observability/support `update`.
- **Delivery:** expand-only initial migration; rollback drops only an unused dark schema before any environment accepts real data.
- **Evidence:** schema review, generated client build, constraint/index tests, updated inventory and ERD.
- **Owners:** engineering `@Ryanakml`; acceptance product owner and database CODEOWNER.

### M1-03 — Enforce RLS and transaction-scoped TenantContext

- **Outcome:** a repository or identifier mistake cannot expose another organization's rows.
- **Depends on:** M1-02; ADR-002.
- **Scope:** RLS on every tenant table; `SET LOCAL app.organization_id`; tenant transaction/repository API; background/system-context contract. Excludes any general tenant-bypass application API.
- **Acceptance:** no-context queries fail closed; organization A cannot select/insert/update/delete B through raw SQL helper, repository, API ID, search, or cursor; pooled connections do not retain scope; runtime role cannot bypass RLS.
- **Design:** all tenant repositories accept `TenantContext` and execute within one bounded transaction. Privileged migration/support connections use separate factories and credentials.
- **Cross-cutting:** CI/tests/security/data `new`; Docker `update`; observability/docs/runbook `new`.
- **Delivery:** enforcement ships before identity/UI data creation. Reversal is prohibited without a superseding security ADR.
- **Evidence:** Testcontainers PostgreSQL matrix, policy inventory query, connection-pool leakage test, threat-model review.
- **Owners:** engineering `@Ryanakml`; acceptance independent security reviewer.

## Epic M1-E2 — Identity, session, membership, and permissions

### M1-04 — Select identity provider and implement secure application sessions

- **Outcome:** a verified identity obtains a revocable FlowDesk session without FlowDesk storing unnecessary credentials.
- **Depends on:** M1-01..03; approved identity-provider ADR.
- **Scope:** OIDC provider integration, callback state/nonce/PKCE, secure HttpOnly session cookie, refresh rotation, logout/revocation, verified email. Local password/MFA is excluded unless the ADR explicitly adds it.
- **Acceptance:** forged/expired/replayed callbacks and sessions are denied; logout/revocation invalidates access; cookie, CSRF, CORS, CSP, and rotation behaviors pass tests; tokens never enter browser storage or logs.
- **Design:** provider identity maps to application identity; permissions and tenant membership remain FlowDesk-owned.
- **Cross-cutting:** CI/tests/security/observability/docs/support `new`; Docker/config `update`; data `update`.
- **Delivery:** provider sandbox only, feature flag disabled outside preview until security review; rollback disables login and revokes created sessions.
- **Evidence:** auth contract tests, browser security evidence, redaction logs, ADR and provider setup runbook.
- **Owners:** engineering `@Ryanakml`; acceptance product owner and independent security reviewer.

### M1-05 — Bootstrap organizations, invitations, memberships, and permission policies

- **Outcome:** an owner can create an isolated organization, invite an operator, and grant only documented capabilities.
- **Depends on:** M1-04.
- **Scope:** organization bootstrap, invite issue/accept/revoke/expire, membership lifecycle, permission policy service. Excludes platform support access and ad-hoc role-string checks.
- **Acceptance:** invite tokens are single-use, hashed, scoped, expiring, and rate-limited; removed/suspended membership loses access immediately; last-owner protection exists; every allow and deny path is unit/integration tested.
- **Design:** controllers ask a centralized permission service for named permissions. Role mapping follows the reviewed role matrix.
- **Cross-cutting:** CI/tests/security/data/observability/docs/support `new`; Docker `none`; config `update`.
- **Delivery:** organization bootstrap and invites use independent flags; revocation is the rollback/safety action.
- **Evidence:** permission decision table, lifecycle tests, audit events, operator/admin guide.
- **Owners:** engineering `@Ryanakml`; acceptance product owner and security reviewer.

## Epic M1-E3 — Contracted API and authenticated workspace

### M1-06 — Add API primitives, idempotency, audit, and generated OpenAPI

- **Outcome:** M1 mutations and reads have stable validated contracts and security-sensitive actions are attributable.
- **Depends on:** M1-03 and M1-05.
- **Scope:** `/api/v1`; request/response Zod contracts; OpenAPI 3.1 generation; cursor primitives; RFC 9457 errors; idempotency middleware; audit helper.
- **Acceptance:** malformed input/output fails predictably; repeated relevant mutation keys return the original result without duplicate effects; cursor scope cannot cross organizations; OpenAPI drift fails CI; audit records actor/action/target/result/correlation without secrets.
- **Design:** contracts package is the source for runtime validation and OpenAPI; idempotency is organization, route, actor, and request-fingerprint scoped.
- **Cross-cutting:** CI/tests/security/data/observability/docs `new`; Docker `none`; support `update`.
- **Delivery:** additive versioned endpoints behind authenticated routing; incompatible behavior requires a new version.
- **Evidence:** contract snapshot, Supertest/Testcontainers suite, replay/concurrency tests, audit export sample.
- **Owners:** engineering `@Ryanakml`; acceptance API and security reviewers.

### M1-07 — Deliver the authenticated empty workspace and team settings shell

- **Outcome:** authorized members can enter an isolated empty workspace, accept invitations, view their team, and see correct loading/empty/error/denied states.
- **Depends on:** M1-05 and M1-06.
- **Scope:** route guard, invitation acceptance, organization switcher only for multi-membership users, team list, role-safe settings shell. Excludes inbox/channel/AI UI.
- **Acceptance:** direct routes and stale UI cache cannot expose B; keyboard/focus semantics and baseline accessibility pass; session expiry recovers safely; denied and empty states disclose no foreign-resource existence.
- **Design:** typed API client plus server-authoritative permissions; client state is never an authorization boundary.
- **Cross-cutting:** CI/tests/security/observability/docs/support `update`; accessibility/E2E `new`; Docker/config `update`; data `none`.
- **Delivery:** preview first; protected routes remain dark until backend acceptance passes; rollback disables navigation and route flag.
- **Evidence:** browser E2E, a11y report, responsive screenshots, role matrix walkthrough.
- **Owners:** engineering `@Ryanakml`; acceptance product/design owner and security reviewer.

## Epic M1-E4 — Operational and release upgrade

### M1-08 — Add M1 security headers, rate limits, redaction, metrics, traces, and audit viewer

- **Outcome:** operators can detect auth/authorization/DB failures and authorized admins can inspect audit activity without exposing PII.
- **Depends on:** M1-04..07.
- **Scope:** CSP/CSRF/cookie/CORS headers, login/API rate limits, PII redaction, auth/DB/permission telemetry, operational dashboard, permission-restricted audit viewer.
- **Acceptance:** headers and rate-limit keys are tenant/actor/IP appropriate; redaction tests cover new identity fields; dashboard shows request/error/latency/auth denial/DB pool signals; audit viewer itself emits audit events and denies unauthorized roles.
- **Design:** low-cardinality metrics; organization identifiers appear only where policy permits; alerts link to runbooks.
- **Cross-cutting:** CI/tests/security/observability/docs/support `new`; Docker/config `update`; data `update`.
- **Delivery:** alert thresholds tune in preview/staging before paging; rollback disables viewer, never audit emission.
- **Evidence:** header scan, rate-limit tests, sanitized trace/log samples, dashboard and runbook links.
- **Owners:** engineering `@Ryanakml`; acceptance security and operations reviewers.

### M1-09 — Upgrade CI/runtime and close the M1 evidence packet

- **Outcome:** every M1 contract is continuously proven with real PostgreSQL/Redis and a rehearsed staging migration.
- **Depends on:** M1-01..08.
- **Scope:** C2/T1/T2/R1/S1/O1/D1 delta; Testcontainers; migration and license policy; image vulnerability scan; hardened health/readiness; coverage threshold for domain/auth; M1 release evidence.
- **Acceptance:** all M0 gates remain green; empty/previous migrations and tenant-negative matrix block PRs; images are non-root and health-tested; staging rehearsal records forward/rollback decision; phase demo proves organization A/B isolation through DB, API, browser, search, cursor, and future socket-token boundary.
- **Design:** build once per commit; artifacts and evidence identify commit/image/migration. No production deploy is introduced in M1.
- **Cross-cutting:** every category `update` or `new`; no unassessed impact remains.
- **Delivery:** merge only after protected checks and independent review; rollback is application disable plus migration-specific roll-forward plan.
- **Evidence:** hosted CI URLs, coverage/security artifacts, image digests, rehearsal record, dashboard/runbooks, signed phase-close note.
- **Owners:** engineering `@Ryanakml`; acceptance product, security, and operations reviewers.

## Review checklist before M1 starts

- [ ] GitHub milestone, four epics, and nine reciprocal dependency-linked issues exist.
- [ ] Identity provider ADR has a named decision owner and deadline.
- [ ] A real independent reviewer is assigned to RLS, auth/session, workflows, and database changes.
- [ ] Provider sandbox credentials exist outside source control.
- [ ] Preview/staging data stores are isolated and contain synthetic data only.
- [ ] No critical M0 defect or unreliable required check remains open.
