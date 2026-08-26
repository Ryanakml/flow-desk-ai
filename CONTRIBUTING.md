# Contributing to FlowDesk

FlowDesk uses Node.js 22, pnpm 10, strict TypeScript, ESM, and a protected `main` branch. Start with `make bootstrap`, then use `make dev`; run `make verify` before opening a pull request.

Create a story with explicit acceptance criteria and cross-cutting impact before implementation. Use conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), keep pull requests independently reviewable, and include test, rollout, rollback, security, observability, and documentation evidence using the PR template.

Application code may depend on `@flowdesk/*` packages but never another application's internals. Shared packages never import applications. Persisted tenant data and external side effects are forbidden until their M1/M2 security and reliability contracts exist.

Tests use synthetic deterministic data only. A flaky test is treated as a defect: quarantine requires an owner, linked issue, and expiry date; silently rerunning until green is prohibited.
