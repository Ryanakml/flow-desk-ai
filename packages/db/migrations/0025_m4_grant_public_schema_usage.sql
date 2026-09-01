-- Migration 0025: Grant USAGE on public schema to runtime roles
-- Required for pgvector (vector type, operators) and pgcrypto extensions installed in the public schema.

GRANT USAGE ON SCHEMA public TO flowdesk_runtime, flowdesk_reporting, flowdesk_system;
