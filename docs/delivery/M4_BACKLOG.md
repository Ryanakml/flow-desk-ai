# M4 Knowledge Ingestion & AI Assistant in Draft Mode Backlog

- Milestone owner: `@Ryanakml`
- Engineering owner: `@Ryanakml`
- Acceptance owners: product owner for AI/knowledge operations; independent security reviewer for anti-SSRF, RAG tenant isolation, and prompt injection boundaries
- Entry dependency: M3 completion evidence accepted, PR #74/#75 merged, and post-merge CI green
- Exit proof: admin uploads and publishes approved knowledge sources; agent in operational inbox receives safe, evidence-backed AI reply drafts with citations and confidence metrics; bot is hard-constrained to `OFF`/`DRAFT` mode with 0 autonomous sending
- Review status: execution-ready decomposition; assignees and reviewers confirmed before implementation

---

## Epic M4-E1 — Knowledge & Vector Data Foundation

### M4-01 — Establish knowledge source, document, vector chunks, bot config, and run audit data model

- **Outcome:** tenant-isolated pgvector and AI audit schema exists with immutable version semantics and Row-Level Security.
- **Depends on:** M3-09.
- **Scope:** tables for `knowledge_sources` (text, file, url), `documents`, `document_chunks` with `vector(1536)` embeddings and cosine similarity index, `knowledge_versions`, `bot_configs` (mode: `off`, `draft`), `bot_runs` (audit of prompts, retrieval citations, tokens, latency, cost); constraints, indexes, and FORCE RLS.
- **Acceptance:** foreign tenant access to vector chunks/knowledge sources is denied; pgvector cosine distance operations `<=>` perform within budget; bot config defaults to `off`/`draft` and rejects auto-send values; migration is additive and reversible.
- **Design:** normalized vector tables with tenant partitioning via RLS; HNSW indexing on cosine embeddings; immutable version snapshots for published knowledge sets.
- **Cross-cutting:** data/security/tests/docs `new`; CI/observability `update`.
- **Delivery:** forward migration, database repository functions, and type definitions in `@flowdesk/db`.
- **Evidence:** fresh/current migration snapshot tests, tenant A/B negative matrix for vector retrieval, query-plan assertions for HNSW index.
- **Owners:** engineering `@Ryanakml`; security review required.

---

## Epic M4-E2 — Safe Ingestion & Embedding Pipeline

### M4-02 — Implement safe knowledge ingestion pipeline with Anti-SSRF protection

- **Outcome:** organization knowledge sources (raw text, markdown, PDF files, web URLs) are safely ingested without SSRF or malware exposure.
- **Depends on:** M4-01.
- **Scope:** ingestion intake for text, files, and URLs; reuse hardened attachment pipeline for files; hardened URL fetcher with anti-SSRF protections (denies private IP ranges 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.169.254, DNS rebinding prevention, max size limits, timeouts).
- **Acceptance:** private IP/metadata targets are rejected; oversized documents fail safely with clear operator errors; URL ingestion follows redirects securely without protocol smuggling.
- **Design:** multi-stage ingestion worker with outbox pattern and anti-SSRF networking sandbox.
- **Cross-cutting:** worker/domain/security/tests/docs `new`.
- **Delivery:** ingestion worker jobs, URL security fetcher, and file extractors.
- **Evidence:** SSRF test suite, malicious payload rejection tests, file parsing unit tests.
- **Owners:** engineering `@Ryanakml`.

### M4-03 — Implement chunking, content hashing, and embedding generation adapter

- **Outcome:** ingested documents are normalized, chunked idempotently, and embedded via provider adapters into pgvector.
- **Depends on:** M4-02.
- **Scope:** token-aware text chunking with overlap; SHA-256 chunk content hashing for deduplication; `AiEmbeddingProvider` adapter contract (OpenAI `text-embedding-3-small` / 1536d and deterministic `FakeEmbeddingProvider`); transactional batch chunk insertion.
- **Acceptance:** identical content yields identical hashes without duplicate embeddings; provider rate-limits/retries are handled with exponential backoff; embedding failures mark source status as failed without orphan chunks.
- **Design:** idempotent worker outbox consumer with batch embedding generation and transaction-scoped insertion.
- **Cross-cutting:** providers/worker/contracts/tests `update`.
- **Delivery:** chunking engine, embedding provider adapters, and worker processor.
- **Evidence:** chunking boundary tests, provider adapter unit tests, outbox retry/failure integration tests.
- **Owners:** engineering `@Ryanakml`.

---

## Epic M4-E3 — Semantic Retrieval & Bot Engine

### M4-04 — Implement semantic RAG retrieval engine with bounded context assembly

- **Outcome:** search engine returns top-K relevance-ranked knowledge chunks strictly within tenant boundaries and builds safe context windows.
- **Depends on:** M4-03.
- **Scope:** vector similarity search query using cosine distance `<=>`; minimum similarity threshold filtering; citation metadata extraction; bounded conversation context builder (message history + knowledge chunks formatted for LLM).
- **Acceptance:** queries never leak cross-tenant knowledge chunks; low-confidence queries below threshold return 0 chunks triggering fallback; context builder respects token budgets.
- **Design:** PostgreSQL pgvector cosine similarity search executed inside `TenantContext` transaction; deterministic citation generator.
- **Cross-cutting:** domain/db/tests/security `update`.
- **Delivery:** retrieval service and context assembly utilities.
- **Evidence:** semantic search accuracy fixtures, cross-tenant isolation negative suite, token truncation tests.
- **Owners:** engineering `@Ryanakml`.

### M4-05 — Implement bot configuration and AI reply draft generation API

- **Outcome:** AI generates safe, structured reply drafts with citations and confidence metrics based on conversation context.
- **Depends on:** M4-04.
- **Scope:** Bot configuration REST API (`GET`/`PUT` bot config); draft generation trigger on incoming messages; `AiChatProvider` adapter (OpenAI / Anthropic / Fake); structured prompt generation; audit record creation in `bot_runs`.
- **Acceptance:** draft mode only—no outbound intent is created autonomously; bot runs record exact model, prompt, latency, tokens, citations, and confidence; bot is disabled if emergency switch is active.
- **Design:** outbox-driven AI draft generation worker with structured JSON response schema and audit persistence.
- **Cross-cutting:** API/worker/contracts/observability/tests `new`.
- **Delivery:** bot config endpoints, AI draft generator service, and audit logger.
- **Evidence:** Supertest API tests, draft generation integration tests, emergency disable tests.
- **Owners:** engineering `@Ryanakml`.

---

## Epic M4-E4 — Operator Inbox Copilot UX

### M4-06 — Deliver Agent Inbox AI Copilot panel with draft approval and citation controls

- **Outcome:** customer support operators can inspect AI-suggested drafts, review source citations, and approve/edit/reject drafts with 1 click.
- **Depends on:** M4-05.
- **Scope:** Copilot recommendation card in conversation timeline; confidence level indicator; expandable citation source drawer; action buttons: **Approve & Send** (creates outbound intent), **Edit in Composer**, **Reject / Dismiss**; bilingual localization (`en-US` and `id-ID`).
- **Acceptance:** clicking Approve inserts message into standard outbound outbox pipeline; Edit copies draft into composer; Reject logs feedback reason; all states are fully accessible via WCAG keyboard navigation.
- **Design:** optimistic React component subscribing to realtime draft updates with citation popovers.
- **Cross-cutting:** web/ui/i18n/tests `update`.
- **Delivery:** React Copilot components in `apps/web/src/InboxView.tsx`.
- **Evidence:** React testing library suite, keyboard navigation tests, browser verification evidence.
- **Owners:** engineering `@Ryanakml`.

---

## Epic M4-E5 — AI Safety, Evaluation & Release

### M4-07 — Build AI safety guardrails, prompt injection defenses, evaluation suite, and M4 evidence packet

- **Outcome:** AI draft engine is protected against prompt injections and evaluated on groundedness, with complete staging evidence packet.
- **Depends on:** M4-06.
- **Scope:** prompt injection filter rules; PII redaction on LLM prompts; LLM budget limits and circuit breaker on provider outage; automated evaluation test suite (`E2E-M4-001`) covering grounded, no-evidence, adversarial injection, and multilingual cases; publish `M4_EVIDENCE.md` and update `TRACEABILITY.md`.
- **Acceptance:** adversarial prompt injection attempts are neutralized or escalated without leaking system prompts; evaluation suite scores >= 90% groundedness; all CI quality gates pass.
- **Design:** layered defense with input sanitization, system prompt hardening, and output validation.
- **Cross-cutting:** security/observability/docs/delivery `update`.
- **Delivery:** evaluation runner, safety filters, runbooks, and `M4_EVIDENCE.md`.
- **Evidence:** evaluation benchmark report, prompt injection test results, staging evidence packet.
- **Owners:** engineering `@Ryanakml`.

---

## Epic M4-E6 — Continuously Inspectable Staging Delivery

### M4-08 — Add repeatable DigitalOcean staging deployment

- **Outcome:** every accepted `main` commit is available for real-time inspection on a hardened staging host without building or editing application code on that host.
- **Depends on:** M4-07.
- **Scope:** BuildKit/GitHub Actions caching; immutable SHA-tagged GHCR images for all five process roles and the migration runner; single-host Compose dependencies; dedicated SSH deploy identity; migration lock; public smoke test; automatic application rollback; operator runbook.
- **Acceptance:** pull requests build and test without mutating staging; a green `main` run publishes all images, deploys the exact SHA, verifies public web/API health, and retains deployment evidence; PostgreSQL, Redis, MinIO, and ClamAV are not publicly bound.
- **Design:** Caddy is the only public application edge; GitHub Environment secrets and a pinned host key authorize deploys; stateful volumes survive application rollback; database recovery remains roll-forward.
- **Cross-cutting:** CI/CD, Docker/infra, security, data, observability, docs, and support `update`.
- **Delivery:** DigitalOcean manifests/scripts, cached CI image publication, gated staging deployment, and `digitalocean-staging.md`.
- **Evidence:** PR checks, main deployment job, public build-info response, host firewall/container inspection, and linked issue #90.
- **Owners:** engineering `@Ryanakml`; staging cost/backup owner `@Ryanakml`.

### M4-09 — Make staging auth failures diagnosable and organization conflicts actionable

- **Outcome:** operators can correlate browser failures with safe server logs, while expected organization slug conflicts no longer appear as opaque internal errors.
- **Depends on:** M4-08.
- **Scope:** structured unexpected-error logs; organization bootstrap conflict mapping; bounded SSH diagnostics; deploy-failure log capture; synthetic login/session/logout staging smoke test.
- **Acceptance:** duplicate slugs return `409 ORGANIZATION_SLUG_CONFLICT`; unexpected failures include request/correlation IDs in protected logs; failed deployments print recent service logs before rollback; every successful staging deploy proves a full mock-auth session lifecycle.
- **Design:** browser responses expose only safe Problem details and request IDs; detailed diagnostics remain in Docker/GitHub deployment logs; no credentials, cookies, or provider payloads are logged.
- **Cross-cutting:** API, CI/CD, observability, security, tests, and runbooks `update`.
- **Delivery:** API error classification/logging, `diagnose.sh`, CI auth smoke, and staging incident instructions.
- **Evidence:** API tests, full verification, protected main deployment output, live duplicate-conflict check, and linked issue #92.
- **Owners:** engineering and staging operations `@Ryanakml`.
