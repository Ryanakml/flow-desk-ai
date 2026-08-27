-- M1-01: additive database foundation. Apply only through `pnpm db:migrate`.
-- Rollback: do not drop a migration already used by an environment; issue a
-- compensating migration instead. See docs/runbooks/database-migrations.md.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS flowdesk_meta;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flowdesk_migrator') THEN
    CREATE ROLE flowdesk_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flowdesk_runtime') THEN
    CREATE ROLE flowdesk_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flowdesk_reporting') THEN
    CREATE ROLE flowdesk_reporting NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flowdesk_break_glass') THEN
    CREATE ROLE flowdesk_break_glass NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  END IF;
END $$;

ALTER ROLE flowdesk_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE flowdesk_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE flowdesk_reporting NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE flowdesk_break_glass NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;

REVOKE ALL ON SCHEMA flowdesk_meta FROM PUBLIC;
ALTER SCHEMA flowdesk_meta OWNER TO flowdesk_migrator;
GRANT USAGE, CREATE ON SCHEMA flowdesk_meta TO flowdesk_migrator;

CREATE TABLE IF NOT EXISTS flowdesk_meta.break_glass_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  opened_by name NOT NULL DEFAULT current_user,
  change_ticket text NOT NULL CHECK (length(change_ticket) > 0),
  reason text NOT NULL CHECK (length(reason) >= 10),
  confirmation text NOT NULL CHECK (confirmation = 'BREAK_GLASS_CONFIRMED')
);

REVOKE ALL ON TABLE flowdesk_meta.break_glass_access_log FROM PUBLIC;
GRANT INSERT ON TABLE flowdesk_meta.break_glass_access_log TO flowdesk_break_glass;
ALTER TABLE flowdesk_meta.break_glass_access_log OWNER TO flowdesk_migrator;

ALTER TABLE flowdesk_meta.schema_migrations OWNER TO flowdesk_migrator;
GRANT SELECT, INSERT ON TABLE flowdesk_meta.schema_migrations TO flowdesk_migrator;
