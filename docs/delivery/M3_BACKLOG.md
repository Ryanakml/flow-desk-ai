# M3 Operational Inbox, Reliable Outbound, Templates & Media Backlog

- Milestone owner: `@Ryanakml`
- Engineering owner: `@Ryanakml`
- Acceptance owners: product owner for support operations; independent security reviewer for realtime authorization and media boundaries
- Entry dependency: M2 corrective evidence accepted, PR #53/#54 merged, and post-merge CI green
- Exit proof: two agents and one supervisor safely operate one queue, reconnect without projection loss, and send approved template/media messages without public object access
- Review status: execution-ready decomposition; assignees and reviewers confirmed before implementation

---

## Epic M3-E1 — Conversation Operations

### M3-01 — Establish queue, team, tag, note, unread, SLA, and business-hours data model

- **Outcome:** tenant-isolated operational inbox state exists with durable lifecycle history.
- **Depends on:** M2-10.
- **Scope:** teams and team memberships; queues and routing membership; conversation queue/team, priority, unread/read marker, waiting reason, bot pause state, SLA timestamps; private notes; tags; saved filters; business-hours policy; indexes, constraints, and FORCE RLS.
- **Acceptance:** every tenant table has non-null tenant ownership and negative RLS tests; private notes never become outbound provider messages; membership removal immediately removes queue visibility; migration is additive and rehearseable.
- **Design:** normalized operational tables with immutable timeline events; queue visibility is policy-driven rather than inferred in the browser.
- **Cross-cutting:** data/security/tests/docs `new`; CI/observability `update`.
- **Delivery:** forward migration and database/domain APIs.
- **Evidence:** fresh/current migration tests, tenant A/B negative matrix, query-plan assertions for inbox indexes.
- **Owners:** engineering `@Ryanakml`; security review required.

### M3-02 — Implement race-safe claim, handoff, notes, tags, read, waiting, and resolve APIs

- **Outcome:** authorized agents can operate conversations without lost updates or invalid transitions.
- **Depends on:** M3-01.
- **Scope:** claim/release/handoff; add private note; add/remove tag; mark read/unread; resolve/reopen/wait; pause/resume bot placeholder; SLA policy; optimistic version preconditions and audit/timeline events.
- **Acceptance:** two simultaneous claims yield one winner; stale tabs receive 409; closed conversations reject sends; removed agents fail closed mid-action; mutation and audit/timeline records are atomic.
- **Design:** centralized domain transition policy and transaction-scoped tenant/RBAC checks; no UI-only authorization.
- **Cross-cutting:** API/contracts/security/tests/audit/docs `update`.
- **Delivery:** versioned REST contracts and generated OpenAPI.
- **Evidence:** domain transition suite, Supertest race/negative suite, PostgreSQL concurrent transaction test.
- **Owners:** engineering `@Ryanakml`.

---

## Epic M3-E2 — Realtime Correctness

### M3-03 — Deliver authenticated Socket.IO rooms, versioning, and reconnect reconciliation

- **Outcome:** realtime hints are authorized, tenant-isolated, versioned, and recoverable after gaps.
- **Depends on:** M3-02.
- **Scope:** authenticated Socket.IO handshake; organization/team/conversation room authorization; Redis adapter; schema-versioned hints; cursor/version reconnect protocol; presence/capacity metadata without message content; backpressure and connection metrics.
- **Acceptance:** foreign tenant/team/conversation rooms are denied; membership revocation disconnects access; reconnect with a version gap forces REST reconciliation; browser telemetry contains no message body or customer PII.
- **Design:** realtime events are invalidation hints, never the source of truth; REST/database projections remain authoritative.
- **Cross-cutting:** API/web/config/observability/security/tests/runbook `new`.
- **Delivery:** Socket.IO server/client plus Redis-backed adapter.
- **Evidence:** room-negative integration tests, reconnect/gap browser test, metrics/dashboard/alert and disconnect runbook.
- **Owners:** engineering `@Ryanakml`; privacy review required before presence rollout.

---

## Epic M3-E3 — Templates & Provider Eligibility

### M3-04 — Model and idempotently synchronize versioned WhatsApp templates

- **Outcome:** local templates reflect provider identity and approval state without unsafe assumptions.
- **Depends on:** M3-01.
- **Scope:** template identity/version/language/category/components, provider status history, sync cursor, payload hash, RLS, indexes, and fake/Meta adapter contracts.
- **Acceptance:** sync replay is idempotent; provider rejection/disable immediately blocks new sends; local drafts are never treated as approved; component and variable contracts are validated.
- **Design:** immutable provider template versions with explicit status history and redacted sync evidence.
- **Cross-cutting:** data/providers/worker/security/tests/docs `new`.
- **Delivery:** migration, adapter, sync worker, support diagnostics.
- **Evidence:** provider fixtures for approved/rejected/paused/duplicate/out-of-order updates.
- **Owners:** engineering `@Ryanakml`.

### M3-05 — Centralize service-window eligibility, template rendering, preview, and dispatch

- **Outcome:** every outbound path explains whether free-form or template messaging is allowed and renders safely.
- **Depends on:** M3-04, M3-02.
- **Scope:** 24-hour service-window policy; template eligibility; typed variable validation; deterministic rendering/preview; audited rendered payload hash; template outbound intent and provider dispatch.
- **Acceptance:** free-form outside the window is rejected with actionable reason; only currently approved template versions send; missing/extra variables fail before queueing; retries preserve one rendered version.
- **Design:** one domain policy consumed by API, UI, and worker; provider status is checked at intent creation and dispatch.
- **Cross-cutting:** domain/API/web/worker/contracts/audit/tests/docs `new`.
- **Delivery:** eligibility service and template composer/dispatch path.
- **Evidence:** boundary-clock tests, rendering fixtures, terminal provider error guidance.
- **Owners:** engineering `@Ryanakml`.

---

## Epic M3-E4 — Secure Media Pipeline

### M3-06 — Implement private presigned upload, validation, checksum, and quarantine scanning

- **Outcome:** attachments enter a private quarantine and cannot be used before validation and scanning succeed.
- **Depends on:** M3-01.
- **Scope:** attachment/upload session model; private S3-compatible storage; short-lived presigned upload; size limit; MIME allowlist plus magic-byte validation; SHA-256 checksum; malware scanner adapter/fake; quarantine/clean/rejected states; encrypted object metadata.
- **Acceptance:** spoofed MIME, oversized files, checksum mismatch, scanner failure, and malicious fixture fail closed; object keys are tenant-scoped and unguessable; no permanent public URL exists.
- **Design:** API authorizes metadata, storage receives bytes privately, worker validates/scans asynchronously, and clean state is required for dispatch/download.
- **Cross-cutting:** API/worker/config/storage/security/tests/observability/docs `new`.
- **Delivery:** migration, S3/scanner adapters, upload and scan workers.
- **Evidence:** MinIO/scanner integration fixtures, SSRF/file-upload security suite, quarantine runbook.
- **Owners:** engineering `@Ryanakml`; security review required.

### M3-07 — Deliver authorized media download, provider upload/send, retention, and deletion

- **Outcome:** clean media can be sent and viewed by authorized users while lifecycle and deletion remain controlled.
- **Depends on:** M3-06, M3-05.
- **Scope:** short-lived authorized download; range/content-disposition controls; provider media upload/download adapter; media outbound intent; provider failure reconciliation; retention expiry, object deletion, tombstone/audit evidence.
- **Acceptance:** foreign/removed users cannot download; quarantined/deleted objects are never served; provider retry does not duplicate messages; expiry deletes bytes and records evidence; permanent public object access is impossible.
- **Design:** database authorization precedes every signed URL; deletion is idempotent and observable.
- **Cross-cutting:** API/worker/providers/security/tests/retention/docs `new`.
- **Delivery:** download/send endpoints, lifecycle jobs, support procedure.
- **Evidence:** authorization matrix, provider failure fixtures, retention/deletion integration tests.
- **Owners:** engineering `@Ryanakml`.

---

## Epic M3-E5 — Operational UX & Release Evidence

### M3-08 — Upgrade inbox UX, accessibility, localization, and conflict/offline states

- **Outcome:** the inbox is usable as a daily bilingual support workspace across keyboard and responsive layouts.
- **Depends on:** M3-02, M3-03, M3-05, M3-07.
- **Scope:** queue/assignment views; private notes/tags; saved filters; template/media composer; accessible focus/labels/live regions; empty/loading/offline/error/conflict states; responsive triage; Indonesian/English strings.
- **Acceptance:** primary workflow is keyboard-complete; reconnect/conflict states are understandable and recoverable; accessibility gate has no serious/critical findings; no customer content enters third-party telemetry.
- **Design:** authoritative refetch after hints/gaps; optimistic UI is reversible and version-aware.
- **Cross-cutting:** web/UI/a11y/i18n/tests/privacy/docs `new`.
- **Delivery:** production UI components and browser state model.
- **Evidence:** component, axe, visual regression, responsive, offline and reconnect tests.
- **Owners:** engineering `@Ryanakml`; product acceptance required.

### M3-09 — Prove the M3 workflow in isolated staging and publish the evidence packet

- **Outcome:** M3 is demonstrated through real infrastructure boundaries and cumulative gates.
- **Depends on:** M3-01 through M3-08.
- **Scope:** browser E2E with two agents and supervisor; PostgreSQL/Redis/object-storage/scanner/provider fixtures; negative authorization; API restart/reconnect; migration compatibility; isolated staging Terraform, secret manager, network policy; dashboards, alerts, runbooks, retention/support evidence.
- **Acceptance:** claim conflict, note/tag, approved template, scanned attachment, delivery update, restart reconciliation, and foreign access denial all pass; C0-C3/T0-T4/R0-R3/S0-S3/O0-O2/D0-D3 remain green.
- **Design:** synthetic data only; immutable images; no production provider, bucket, database, Redis, or secrets shared with staging.
- **Cross-cutting:** CI/E2E/Terraform/security/observability/docs `update`.
- **Delivery:** hosted checks, staging rehearsal, M3 evidence packet, milestone closeout.
- **Evidence:** CI URLs, screenshots/artifacts, migration rehearsal, alert/runbook drill, merged PR list.
- **Owners:** engineering `@Ryanakml`; independent acceptance/security review required.

---

## M3 Exit Checklist

- [ ] All M3 issues are closed by merged PRs with hosted checks.
- [ ] Conversation operations have domain, API, PostgreSQL race, and browser conflict coverage.
- [ ] Realtime authentication, room isolation, version reconciliation, metrics, and runbook are proven.
- [ ] Template sync/eligibility/rendering and provider errors are centralized and fixture-tested.
- [ ] Media authorization, validation, checksum, scan/quarantine, provider handling, retention, and deletion are proven.
- [ ] Accessibility, localization, offline/error/reconnect, and responsive states pass release gates.
- [ ] Isolated staging Terraform and cumulative C/T/R/S/O/D obligations are evidenced.
- [ ] `docs/delivery/M3_EVIDENCE.md` records the final merge commits and post-merge CI run.
