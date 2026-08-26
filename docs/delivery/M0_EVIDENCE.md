# M0 implementation evidence

- Date: 2026-08-26
- Scope: local repository implementation and runtime; hosted CI evidence pending
- Result: every local foundation gate passes; remote governance and fresh-clone evidence remain

## Evidence captured

| Check                         | Result                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `make verify`                 | Passed: format, lint, strict typecheck, 16 tests across 14 workspaces, and all builds                                                                  |
| `pnpm test:coverage`          | Passed; per-workspace V8 reports generated                                                                                                             |
| Compose model                 | `docker compose ... config --quiet` passed; eight services resolved                                                                                    |
| API runtime                   | `/readyz` and typed `/api/v1/system/build` returned 200                                                                                                |
| Telemetry contract            | Runtime JSON log contained service/environment/version, request ID, supplied correlation ID, method/path/status/duration, with redaction tests passing |
| Production dependency closure | `pnpm deploy --prod` produced a runnable isolated API artifact; `/livez` returned 200                                                                  |
| Secret scan                   | Local repository scan passed                                                                                                                           |
| Five production images        | Built from current source; each `/livez` returned 200 as UID 10001/user `flowdesk`, rejected invalid `PORT`, and stopped gracefully                    |
| Full local stack              | PostgreSQL/pgvector with three synthetic fixtures, Redis, MinIO bucket, Mailpit, OTel Collector, Prometheus, and Grafana all responded                 |
| Five-process dev runtime      | `make dev` started web/api/ingress/worker/scheduler; all probes passed and backend processes logged graceful signal handling                           |
| Terraform                     | Terraform 1.13.1 `fmt`, `init -backend=false`, `validate`, and non-applying preview `plan` passed through the official container image                 |

## Pending before declaring M0 complete

- The remote repository still needs branch protection, required reviews/checks, CODEOWNERS enforcement, private vulnerability reporting verification, and a hosted CI failure-probe run.
- A genuinely fresh-clone `make bootstrap` → `make dev` demo and independent ADR/M1 backlog review remain required.

No M1 tenant schema, auth, customer data, WhatsApp integration, or AI capability is claimed by this evidence.
