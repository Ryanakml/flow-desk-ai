# Organizations and Memberships runbook

## Overview

FlowDesk manages multi-tenant isolation via isolated `organizations`. Each organization has standard roles (`owner`, `admin`, `supervisor`, `agent`, `analyst`, `billing_admin`) mapped to named capabilities in `@flowdesk/domain`.

## Security Boundaries & Invariants

1. **Organization Bootstrap**:
   - `POST /api/v1/organizations` calls `flowdesk.bootstrap_organization` atomically.
   - It provisions the 6 standard roles, creates default settings, and assigns the authenticated creator as the initial `owner` member.
2. **Invitations Lifecycle**:
   - `POST /api/v1/organizations/:orgId/invitations` requires `membership:invite` permission.
   - Only single-use, high-entropy tokens are issued; only `sha256(token)` is persisted in `flowdesk.invitations.token_hash`.
   - `POST /api/v1/invitations/accept` consumes the invitation atomically using `flowdesk.consume_invitation`.
   - Expired, already accepted, or forged invitation tokens are denied immediately.
   - Pending invitations can be revoked via `DELETE /api/v1/organizations/:orgId/invitations/:inviteId` by an authorized admin.
3. **Last-Owner Protection**:
   - Any mutation attempting to revoke, delete, or demote the sole active `owner` of an organization throws `LastOwnerProtectionError` and returns RFC 9457 `LAST_OWNER_PROTECTION_VIOLATION`.
   - Organizations can never become ownerless.
4. **Immediate Access Loss**:
   - When a membership is revoked or suspended, queries fail closed via RLS and permission checks immediately.
5. **Centralized Permission Policy**:
   - Controllers never perform raw string role checks.
   - They query the centralized permission service (`hasPermission(roleKey, permission)` in `@flowdesk/domain`).
