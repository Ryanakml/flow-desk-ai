# Testing conventions

Vitest is the M0 unit runner. Test files live beside source as `*.test.ts(x)`, do not depend on execution order, and use fixed clocks/IDs or injected randomness when behavior depends on them. Fixtures are synthetic and deterministic; real customer data and raw provider payloads are forbidden.

Tests name observable contracts, include dangerous denial/failure paths, and avoid testing private implementation details. A package containing only TypeScript ports proves substitutability with a deterministic fake. Process entrypoints keep boot side effects thin; factories and policies are tested separately.

`pnpm test` is the fast required suite. `pnpm test:coverage` emits per-workspace V8 coverage for CI evidence. M0 reports coverage without a global percentage target because skeleton entrypoints distort the signal; M1 adds risk-based thresholds for domain/auth code. Lowering a threshold later requires an owned, expiring risk acceptance.

Future layers are introduced with their capability: Testcontainers PostgreSQL/Redis and tenant-negative tests in M1, provider/idempotency/retry contracts in M2, browser/a11y/migration compatibility in M3, and load/failure/security/AI evaluation gates in M4/M5.
