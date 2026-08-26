# Initial threat-model backlog

| ID     | Threat                                   | Boundary/asset         | Initial control                                                       | Verification milestone        |
| ------ | ---------------------------------------- | ---------------------- | --------------------------------------------------------------------- | ----------------------------- |
| TM-001 | Cross-organization object access         | Tenant data            | TenantContext + RLS + NOBYPASSRLS                                     | M1 negative integration tests |
| TM-002 | Session theft or fixation                | Identity/session       | HttpOnly secure cookies, rotation, revocation, CSRF                   | M1 auth tests                 |
| TM-003 | Forged or replayed Meta webhook          | Public ingress         | Raw-body signature verification, timestamp/dedupe, rate limit         | M2 contract tests             |
| TM-004 | Duplicate external side effect           | Queue/provider         | Inbox/outbox idempotency and provider keys                            | M2 retry tests                |
| TM-005 | Secret exposure                          | Repo, logs, image, CI  | Typed references, redaction, scan, short-lived identity               | M0/M2 tests                   |
| TM-006 | Malicious attachment/SSRF                | Media/storage          | Private quarantine, type/size checks, scanner, egress controls        | M3 security tests             |
| TM-007 | Prompt injection/data exfiltration       | AI/RAG                 | Approved corpus, isolation, minimization, tool allowlist, safety gate | M4 evals                      |
| TM-008 | Privileged support abuse                 | Platform support       | Separate audience, JIT approval, reason, audit, expiry                | M3/M7 review                  |
| TM-009 | Supply-chain compromise                  | CI/images/dependencies | SHA-pinned actions, lockfile, review, scan/SBOM/provenance ladder     | M0-M5 CI                      |
| TM-010 | Destructive migration or failed recovery | PostgreSQL             | Expand/contract, protected job, PITR, restore drill                   | M1/M7 evidence                |

Threats are reviewed whenever a change crosses data, identity, provider, attachment, payment, or AI boundaries.
