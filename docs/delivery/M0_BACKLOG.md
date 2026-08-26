# M0 issue hierarchy and execution status

This local hierarchy is ready to copy into GitHub Issues. GitHub ownership and reciprocal links require repository-administrator action.

| ID    | Outcome                                                     | Dependency | Status                                          |
| ----- | ----------------------------------------------------------- | ---------- | ----------------------------------------------- |
| M0-01 | Repository governance and review contract                   | none       | Implemented in repository; GitHub rules pending |
| M0-02 | pnpm/Turborepo and strict toolchain                         | M0-01      | Implemented                                     |
| M0-03 | Five minimal deployable applications and shared packages    | M0-02      | Implemented                                     |
| M0-04 | Fail-closed typed configuration                             | M0-03      | Implemented                                     |
| M0-05 | Docker, Compose, Make, and bootstrap guide                  | M0-04      | Implemented; local runtime proven               |
| M0-06 | C0/C1 CI baseline                                           | M0-05      | Implemented; hosted run/rules pending           |
| M0-07 | Logging, request IDs, telemetry skeleton, health and errors | M0-03      | Implemented                                     |
| M0-08 | ADRs and operating/security documentation                   | M0-01      | Implemented                                     |
| M0-09 | Local dependencies and synthetic fixtures                   | M0-05      | Implemented; runtime proven                     |
| M0-10 | Deterministic test harness and package/application tests    | M0-03      | Implemented                                     |
| M0-11 | Terraform state and validation skeleton                     | M0-01      | Implemented; local plan proven                  |
| M0-12 | Fresh-clone exit demo and M1 issue review                   | M0-01..11  | Pending                                         |

M1 preparation begins with tenant database roles, UUID/extension decisions, RLS transaction helper, and negative Testcontainers scenarios. It must not begin with feature UI.
