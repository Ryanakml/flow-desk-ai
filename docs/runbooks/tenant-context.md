# TenantContext runbook

Every runtime query against a tenant-owned table runs through `withTenantTransaction`. The helper starts a transaction and sets `app.organization_id` with `SET LOCAL`; it is cleared on commit or rollback before the pooled connection is reused.

The runtime role has `NOBYPASSRLS`. Missing context returns no tenant rows; a foreign organization ID cannot be selected or written. Migrations and break-glass work use separate credentials and are not application request paths.
