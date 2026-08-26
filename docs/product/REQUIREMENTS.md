# Product requirement registry

| ID               | Requirement                                                                          | Source                 | First gate | Status                             |
| ---------------- | ------------------------------------------------------------------------------------ | ---------------------- | ---------- | ---------------------------------- |
| DEV-FOUND-001    | A clean machine can bootstrap and run the platform foundation.                       | Execution blueprint M0 | M0         | Implemented; exit evidence pending |
| SEC-SECRET-001   | No production secret or customer data exists in source, fixtures, or logs.           | Spec 20; M0 S0         | M0         | Implemented locally                |
| OPS-HEALTH-001   | Every deployable exposes liveness/readiness and bounded shutdown.                    | Spec 22; M0 O0         | M0         | Implemented                        |
| SEC-TENANT-001   | Tenant data is protected by TenantContext plus PostgreSQL RLS.                       | Spec 13; ADR-002       | M1         | Planned                            |
| MSG-INBOUND-001  | A verified, durable Meta webhook creates one tenant-isolated inbound message effect. | Spec 8.2               | M2         | Planned                            |
| MSG-OUTBOUND-001 | An authorized agent reply has idempotent provider delivery state.                    | Spec 8.3               | M2         | Planned                            |
| AI-DRAFT-001     | Approved knowledge can produce safe, cited drafts without autonomous send.           | Spec 18                | M4         | Planned                            |
