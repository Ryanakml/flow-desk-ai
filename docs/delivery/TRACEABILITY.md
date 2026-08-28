# Critical capability traceability

| Requirement     | Phase | Decision/implementation                  | Test/operational signal                     | Status   |
| --------------- | ----- | ---------------------------------------- | ------------------------------------------- | -------- |
| DEV-FOUND-001   | M0    | ADR-001; workspace; Makefile; Compose    | hosted CI; fresh-clone five-process probes  | Complete |
| SEC-SECRET-001  | M0    | SECURITY; logger redaction; secret scan  | observability/security tests; CI scan       | Complete |
| OPS-HEALTH-001  | M0    | API and process health servers           | app tests; hosted image smoke matrix        | Complete |
| SEC-TENANT-001  | M1    | ADR-002; `TenantContext` contract        | PostgreSQL/RLS negative suite               | Complete |
| SEC-AUTH-001    | M1    | ADR-004; OIDC + HttpOnly session token   | Supertest auth suite; session revocation    | Complete |
| SEC-RBAC-001    | M1    | Domain permission policy & invitations   | Supertest org suite; last-owner protection  | Complete |
| API-PRIM-001    | M1    | Idempotency, audit, OpenAPI, cursor      | Replay tests; drift check; audit suite      | Complete |
| UI-WORK-001     | M1    | Authenticated workspace & team shell     | React suites; route guards; a11y focus      | Complete |
| SEC-OBS-001     | M1    | Security headers, rate limit, telemetry  | Rate limit suites; metrics/redaction tests  | Complete |
| CHAN-MOD-001    | M2    | Channel schema & AES-256-GCM envelope    | RLS isolation tests; encryption suites      | Complete |
| CHAN-PROV-001   | M2    | WhatsApp Cloud API & Fake provider       | Error classification; adapter test suite    | Complete |
| ING-HMAC-001    | M2    | Ingress raw-body HMAC-SHA256 signature   | Supertest verification suite; forge denial  | Complete |
| ING-PERSIST-001 | M2    | Durable webhook event & deduplication    | Deduplication suite; transactional outbox   | Complete |
| CONV-MOD-001    | M2    | Full conversation/message domain + RLS   | PostgreSQL lifecycle/RLS integration test   | Complete |
| NORM-MATCH-001  | M2    | Worker normalization & thread matching   | Pipeline tests; idempotent message creation | Complete |
| CONV-API-001    | M2    | Tenant transaction + idempotent outbox   | Required key; replay/conflict API suites    | Complete |
| DISP-WORK-001   | M2    | Leased dispatch + retry/status history   | Competing-claim PostgreSQL integration test | Complete |
| UI-INBOX-001    | M2    | Inbox, composer, tenant SSE invalidation | UI/RBAC suites; authorized refresh path     | Complete |
| E2E-SLICE-001   | M2    | PostgreSQL vertical slice + ops controls | Hosted DB suite; dashboard; alerts; runbook | Complete |
