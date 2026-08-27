# Database migration runbook

`packages/db` owns Prisma schema validation and the hand-written SQL migrations that Prisma cannot safely express: PostgreSQL extensions, database roles, and security metadata. Migrations are additive and run as a distinct release step; application processes must never apply them at startup.

## Local rehearsal

1. Start PostgreSQL: `make compose-up`.
2. Copy `.env.example` to `.env` if needed. `DATABASE_MIGRATOR_URL` is the synthetic local bootstrap credential only.
3. Run `make db-migrate` twice. The first execution applies each migration; the second must report it as already applied.
4. Validate the role matrix: `DATABASE_MIGRATOR_URL=postgresql://flowdesk:flowdesk_local@127.0.0.1:5433/flowdesk pnpm --filter @flowdesk/db test:integration`.

`db-reset` remains limited to `APP_ENV=local`; it destroys only the local PostgreSQL volume. After any reset, rerun `make db-migrate`.

## Release discipline

The release system supplies `DATABASE_MIGRATOR_URL` for a distinct `NOINHERIT` login that is a member of `flowdesk_migrator`. The bootstrap identity required to create roles/extensions exists only during initial infrastructure provisioning; after `0001`, the migrator group owns `flowdesk_meta` and can record later additive migrations. Runtime, reporting, and break-glass logins are provisioned outside this repository and granted only their corresponding group role. No application `DATABASE_URL` may use the migrator login.

Never modify an applied SQL file: the runner stores a SHA-256 checksum and refuses drift. Use expand/backfill/contract migrations. Prefer a roll-forward compensating migration over rollback once a migration reaches a shared environment.

## Break-glass

The break-glass group is `NOLOGIN` and `BYPASSRLS`; it must never be granted to a runtime login. Before temporary operational access, the owner supplies a unique ticket, a reason, separate break-glass credentials, and an explicit confirmation:

```sh
DATABASE_BREAK_GLASS_URL='postgresql://…' \
BREAK_GLASS_TICKET='INC-123' \
BREAK_GLASS_REASON='Customer-approved recovery for organization …' \
BREAK_GLASS_CONFIRMATION='I_UNDERSTAND_BREAK_GLASS' \
pnpm db:break-glass
```

The command records immutable request metadata in `flowdesk_meta.break_glass_access_log` before privileged work begins. M1-03 will add tenant-table RLS policies and the corresponding access-expiry/closure evidence.
