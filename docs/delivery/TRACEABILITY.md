# Critical capability traceability

| Requirement      | Phase | Decision/implementation                           | Test/operational signal                           | Status   |
| ---------------- | ----- | ------------------------------------------------- | ------------------------------------------------- | -------- |
| DEV-FOUND-001    | M0    | ADR-001; workspace; Makefile; Compose             | hosted CI; fresh-clone five-process probes        | Complete |
| SEC-SECRET-001   | M0    | SECURITY; logger redaction; secret scan           | observability/security tests; CI scan             | Complete |
| OPS-HEALTH-001   | M0    | API and process health servers                    | app tests; hosted image smoke matrix              | Complete |
| SEC-TENANT-001   | M1    | ADR-002; `TenantContext` contract                 | PostgreSQL/RLS negative suite                     | Complete |
| SEC-AUTH-001     | M1    | ADR-004; OIDC + HttpOnly session token            | Supertest auth suite; session revocation          | Complete |
| SEC-RBAC-001     | M1    | Domain permission policy & invitations            | Supertest org suite; last-owner protection        | Complete |
| API-PRIM-001     | M1    | Idempotency, audit, OpenAPI, cursor               | Replay tests; drift check; audit suite            | Complete |
| UI-WORK-001      | M1    | Authenticated workspace & team shell              | React suites; route guards; a11y focus            | Complete |
| SEC-OBS-001      | M1    | Security headers, rate limit, telemetry           | Rate limit suites; metrics/redaction tests        | Complete |
| CHAN-MOD-001     | M2    | Channel schema & AES-256-GCM envelope             | RLS isolation tests; encryption suites            | Complete |
| CHAN-PROV-001    | M2    | WhatsApp Cloud API & Fake provider                | Error classification; adapter test suite          | Complete |
| ING-HMAC-001     | M2    | Ingress raw-body HMAC-SHA256 signature            | Supertest verification suite; forge denial        | Complete |
| ING-PERSIST-001  | M2    | Durable webhook event & deduplication             | Deduplication suite; transactional outbox         | Complete |
| CONV-MOD-001     | M2    | Full conversation/message domain + RLS            | PostgreSQL lifecycle/RLS integration test         | Complete |
| NORM-MATCH-001   | M2    | Worker normalization & thread matching            | Pipeline tests; idempotent message creation       | Complete |
| CONV-API-001     | M2    | Tenant transaction + idempotent outbox            | Required key; replay/conflict API suites          | Complete |
| DISP-WORK-001    | M2    | Leased dispatch + retry/status history            | Competing-claim PostgreSQL integration test       | Complete |
| UI-INBOX-001     | M2    | Inbox, composer, tenant SSE invalidation          | UI/RBAC suites; authorized refresh path           | Complete |
| E2E-SLICE-001    | M2    | PostgreSQL vertical slice + ops controls          | Hosted DB suite; dashboard; alerts; runbook       | Complete |
| OPS-INBOX-001    | M3    | Queue/team model and atomic operations API        | PostgreSQL race/RLS; domain/API suites            | Complete |
| RT-AUTH-001      | M3    | Authenticated, versioned realtime rooms           | Room denial; reconnect/gap reconciliation         | Complete |
| TPL-SYNC-001     | M3    | Versioned provider template sync                  | Provider status/idempotency fixtures              | Complete |
| TPL-ELIG-001     | M3    | Central eligibility and rendering policy          | Boundary-clock/render/dispatch fixtures           | Complete |
| MEDIA-PIPE-001   | M3    | Private upload, scan, send, and deletion          | Storage/scanner/provider/security suites          | Complete |
| UX-OPS-001       | M3    | Accessible bilingual operational inbox            | Axe/visual/offline/conflict browser evidence      | Complete |
| E2E-M3-001       | M3    | Isolated staging operational workflow             | Hosted E2E; Terraform; runbooks; evidence         | Complete |
| RAG-DATA-001     | M4    | Document ingestion, chunking, pgvector HNSW       | Vector similarity tests; database migrations      | Complete |
| RAG-EXTR-001     | M4    | Multi-format document text extraction             | Text parsing unit tests & parsing fixtures        | Complete |
| BOT-CFG-001      | M4    | Bot config control, mode toggle, killswitch       | Bot config API endpoints & schema validation      | Complete |
| RAG-ENG-001      | M4    | Grounded RAG draft engine & grounding audit       | Grounding evaluation & audit logging suites       | Complete |
| UX-COPILOT-001   | M4    | Agent Inbox AI Copilot UX panel & citations       | InboxView Copilot UI unit & component tests       | Complete |
| AI-SAFETY-001    | M4    | Prompt injection, PII redaction, circuit          | `ai-safety.test.ts` suite (`E2E-M4-001`)          | Complete |
| E2E-M4-001       | M4    | AI Safety & groundedness evaluation suite         | Evaluation test suite & release evidence          | Complete |
| ROUTE-ENG-001    | M5    | Automated conversation routing engine & RLS       | Evaluator unit tests; API/DB routing suites       | Complete |
| AUTO-SEND-001    | M5    | Multi-layer pre-send policy validation gate       | Domain policy suite; worker pipeline test         | Complete |
| KILLSWITCH-001   | M5    | Multi-level emergency killswitches & API          | Security killswitch suite; API emergency test     | Complete |
| PROD-RELEASE-001 | M5    | Production CI/CD, image provenance, canary        | Production release workflow & Terraform           | Complete |
| SLO-MON-001      | M5    | Prometheus SLO alert rules & failure drills       | Alert rule syntax; failure injection suite        | Complete |
| E2E-M5-001       | M5    | Milestone 5 End-to-End integration suite          | `m5-auto-send.e2e.test.ts` & M5 evidence          | Complete |
| CHAN-UI-001      | M6    | Self-Service WhatsApp Channel Connection UI       | `ChannelsView.tsx` component & unit tests         | Complete |
| DEV-API-001      | M6    | Scoped Developer API Keys & Webhook Subscriptions | SHA-256 key hashing & `DeveloperSettingsView.tsx` | Complete |
| ANALYTICS-001    | M6    | Real-Time Analytics Engine & Read Aggregates      | `packages/db/src/analytics.ts` query engine       | Complete |
| DASHBOARD-001    | M6    | Analytics Dashboard & CSV Compliance Export       | `AnalyticsView.tsx` & REST export endpoint        | Complete |
| E2E-M6-001       | M6    | Milestone 6 End-to-End Community Suite            | `m6-community-platform.e2e.test.ts` & evidence    | Complete |
