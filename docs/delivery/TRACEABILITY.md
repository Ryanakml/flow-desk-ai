# Critical capability traceability

| Requirement    | Phase | Decision/implementation                 | Test/operational signal               | Status              |
| -------------- | ----- | --------------------------------------- | ------------------------------------- | ------------------- |
| DEV-FOUND-001  | M0    | ADR-001; workspace; Makefile; Compose   | `make verify`; five `/livez` probes   | Local gates passed  |
| SEC-SECRET-001 | M0    | SECURITY; logger redaction; secret scan | observability/security tests; CI scan | Implemented locally |
| OPS-HEALTH-001 | M0    | API and process health servers          | app tests; image smoke matrix         | Verified locally    |
| SEC-TENANT-001 | M1    | ADR-002; `TenantContext` contract       | PostgreSQL/RLS negative suite         | Planned             |
