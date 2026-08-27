# M0 issue hierarchy and execution status

The GitHub hierarchy is implemented in `Ryanakml/flow-desk-ai`: one issue per numbered backlog item and no separate cross-cutting checklist issues.

| ID    | Outcome                                                     | Dependency | Status                                           |
| ----- | ----------------------------------------------------------- | ---------- | ------------------------------------------------ |
| M0-01 | Repository governance and review contract                   | none       | Complete; CI status-check-only protection active |
| M0-02 | pnpm/Turborepo and strict toolchain                         | M0-01      | Implemented                                      |
| M0-03 | Five minimal deployable applications and shared packages    | M0-02      | Implemented                                      |
| M0-04 | Fail-closed typed configuration                             | M0-03      | Implemented                                      |
| M0-05 | Docker, Compose, Make, and bootstrap guide                  | M0-04      | Implemented; local runtime proven                |
| M0-06 | C0/C1 CI baseline                                           | M0-05      | Complete; hosted CI and failure path proven      |
| M0-07 | Logging, request IDs, telemetry skeleton, health and errors | M0-03      | Implemented                                      |
| M0-08 | ADRs and operating/security documentation                   | M0-01      | Implemented                                      |
| M0-09 | Local dependencies and synthetic fixtures                   | M0-05      | Implemented; runtime proven                      |
| M0-10 | Deterministic test harness and package/application tests    | M0-03      | Implemented                                      |
| M0-11 | Terraform state and validation skeleton                     | M0-01      | Implemented; local plan proven                   |
| M0-12 | Fresh-clone exit demo and M1 issue review                   | M0-01..11  | Complete; fresh clone passed; M1-01..09 created  |

M1 preparation begins with tenant database roles, UUID/extension decisions, RLS transaction helper, and negative Testcontainers scenarios. It must not begin with feature UI.
