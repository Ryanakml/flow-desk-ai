# M1 core schema

`organizations` is the tenant root. `users` and `identities` are global identity records; every other M1 table carries a non-null `organization_id`, is indexed by it where queried, and becomes RLS-protected in M1-03.

| Table                   | Purpose                            | Retention/deletion rule                          |
| ----------------------- | ---------------------------------- | ------------------------------------------------ |
| organizations, settings | tenant lifecycle/configuration     | soft-delete organization first                   |
| users, identities       | verified external identity mapping | restrict while membership/audit references exist |
| roles, memberships      | tenant authorization membership    | revoke/suspend; retain audit history             |
| audit_logs              | append-only security evidence      | no application update/delete path                |
| idempotency_keys        | replay-safe mutation responses     | expiry-indexed cleanup                           |
| outbox_events           | transactional side-effect record   | retain until published and policy cleanup        |
