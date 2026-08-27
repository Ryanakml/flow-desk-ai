# M0 implementation evidence

- Date: 2026-08-27
- Scope: local repository, runtime, and hosted GitHub evidence
- Result: M0 exit evidence complete; M1 remains planned only

## Evidence captured

| Check                         | Result                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `make verify`                 | Passed: format, lint, strict typecheck, 16 tests across 14 workspaces, and all builds                                                                                    |
| `pnpm test:coverage`          | Passed; per-workspace V8 reports generated                                                                                                                               |
| Compose model                 | `docker compose ... config --quiet` passed; eight services resolved                                                                                                      |
| API runtime                   | `/readyz` and typed `/api/v1/system/build` returned 200                                                                                                                  |
| Telemetry contract            | Runtime JSON log contained service/environment/version, request ID, supplied correlation ID, method/path/status/duration, with redaction tests passing                   |
| Production dependency closure | `pnpm deploy --prod` produced a runnable isolated API artifact; `/livez` returned 200                                                                                    |
| Secret scan                   | Local repository scan passed                                                                                                                                             |
| Five production images        | Built from current source; each `/livez` returned 200 as UID 10001/user `flowdesk`, rejected invalid `PORT`, and stopped gracefully                                      |
| Full local stack              | PostgreSQL/pgvector with three synthetic fixtures, Redis, MinIO bucket, Mailpit, OTel Collector, Prometheus, and Grafana all responded                                   |
| Five-process dev runtime      | `make dev` started web/api/ingress/worker/scheduler; all probes passed and backend processes logged graceful signal handling                                             |
| Terraform                     | Terraform 1.13.1 `fmt`, `init -backend=false`, `validate`, and non-applying preview `plan` passed through the official container image                                   |
| Hosted CI                     | Required `quality`, `terraform`, and all five image checks passed on `main` and PR #1; dependency review passed after enabling repository dependency analysis            |
| Solo repository controls      | `main` requires the seven CI status checks, is strict/up-to-date, and has zero required approvals; CODEOWNERS is informational because a solo author cannot self-approve |
| GitHub tracking               | Twelve M0 issues and nine numbered M1 issues exist; cross-cutting work is a PR checklist rather than additional issues                                                   |
| Fresh-clone exit demo         | Fresh clone of `Ryanakml/flow-desk-ai`, Node 22, `make bootstrap`, and `make dev` passed with web at 3000 and API/ingress/worker/scheduler at 4000–4003                  |

## Hosted evidence

- Repository: `https://github.com/Ryanakml/flow-desk-ai`
- Main CI: `https://github.com/Ryanakml/flow-desk-ai/actions/runs/33039816503`
- PR #1: `https://github.com/Ryanakml/flow-desk-ai/pull/1` was mergeable and squash-merged with zero required human approvals after all required checks passed.
- Deliberate failure probe: `https://github.com/Ryanakml/flow-desk-ai/actions/runs/33040160409`; the workflow's `exit 42` path is expected to fail as designed.

No M1 tenant schema, auth, customer data, WhatsApp integration, or AI capability is claimed by this evidence.
