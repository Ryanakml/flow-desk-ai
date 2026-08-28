# Testing conventions

Vitest is the M0 unit runner. Test files live beside source as `*.test.ts(x)`, do not depend on execution order, and use fixed clocks/IDs or injected randomness when behavior depends on them. Fixtures are synthetic and deterministic; real customer data and raw provider payloads are forbidden.

Tests name observable contracts, include dangerous denial/failure paths, and avoid testing private implementation details. A package containing only TypeScript ports proves substitutability with a deterministic fake. Process entrypoints keep boot side effects thin; factories and policies are tested separately.

`pnpm test` is the fast required suite. `pnpm test:coverage` emits per-workspace V8 coverage for CI evidence. M0 reports coverage without a global percentage target because skeleton entrypoints distort the signal; M1 adds risk-based thresholds for domain/auth code. Lowering a threshold later requires an owned, expiring risk acceptance.

The hosted database job runs migrations twice (fresh plus already-current compatibility) and then executes `@flowdesk/worker#test:integration` against PostgreSQL. The M2 database test covers 100 duplicate inbound replays, domain lifecycle records, competing workers, one fake-provider dispatch, interrupted-dispatch reconciliation without resend, and cross-tenant denial. Fast in-memory tests remain useful but are not accepted as database E2E evidence.

Future layers are introduced with their capability: browser/a11y/migration compatibility in M3, and load/failure/security/AI evaluation gates in M4/M5.
