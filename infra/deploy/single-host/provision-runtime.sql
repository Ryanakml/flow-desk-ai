\set ON_ERROR_STOP on

SELECT format(
  'CREATE ROLE flowdesk_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS PASSWORD %L',
  :'runtime_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flowdesk_app')
\gexec

SELECT format(
  'ALTER ROLE flowdesk_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS PASSWORD %L',
  :'runtime_password'
)
\gexec

GRANT flowdesk_runtime TO flowdesk_app;
