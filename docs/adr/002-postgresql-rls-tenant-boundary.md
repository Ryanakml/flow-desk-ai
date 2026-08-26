# ADR-002: PostgreSQL RLS as a mandatory tenant boundary

- Status: Accepted
- Date: 2026-08-26
- Owners: FlowDesk engineering and security
- Requirement: SEC-TENANT-001; M1 prerequisite

## Context

Application filters alone are too easy to omit in a multi-tenant messaging product. Tenant isolation must survive a repository or query mistake.

## Decision

Every tenant-owned table will have a non-null `organization_id`, supporting indexes, and PostgreSQL row-level security. Requests run in transactions that apply `SET LOCAL app.organization_id`. The application runtime role is `NOBYPASSRLS`; migration owner and audited break-glass roles are separate. Repositories also require a typed `TenantContext`.

M0 records the boundary but creates no tenant tables. M1 must prove cross-tenant denial through database, repository, API, browser, and realtime integration tests before tenant data is accepted.

## Consequences

Connection and transaction handling are more disciplined, background jobs must restore tenant context explicitly, and migrations require policy review. The defense-in-depth benefit outweighs this cost.

## Reversal

Reversal requires a replacement isolation mechanism with equivalent negative-test evidence and a separately approved security ADR.
