# Critical capability traceability

| Requirement    | Phase | Decision/implementation                 | Test/operational signal                    | Status   |
| -------------- | ----- | --------------------------------------- | ------------------------------------------ | -------- |
| DEV-FOUND-001  | M0    | ADR-001; workspace; Makefile; Compose   | hosted CI; fresh-clone five-process probes | Complete |
| SEC-SECRET-001 | M0    | SECURITY; logger redaction; secret scan | observability/security tests; CI scan      | Complete |
| OPS-HEALTH-001 | M0    | API and process health servers          | app tests; hosted image smoke matrix       | Complete |
| SEC-TENANT-001 | M1    | ADR-002; `TenantContext` contract       | PostgreSQL/RLS negative suite              | Planned  |
