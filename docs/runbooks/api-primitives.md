# API Primitives, Idempotency, and Audit runbook

## Overview

FlowDesk provides contract-first API primitives ensuring stable, secure, attributable, and reproducible interactions across the multi-tenant core.

## 1. Cursor Pagination Primitives

- **Deterministic Ordering**: All cursor queries order by deterministic compound keys, typically `(occurred_at DESC, id DESC)`.
- **Token Encoding**: Cursors are opaque URL-safe base64url payloads containing the record ID, sort value, and tenant organization ID.
- **Cross-Organization Protection**: `decodeCursor(cursor, expectedOrgId)` validates that the cursor's organization ID matches the caller's tenant context. Foreign-tenant cursors fail closed immediately, preventing cross-organization enumeration attacks.
- **Request Parameters**:
  - `cursor`: optional opaque string.
  - `limit`: optional integer between 1 and 100 (defaults to 50).
- **Response Structure**:
  - `items`: array of typed records.
  - `pageInfo`: `{ hasNextPage, hasPreviousPage, startCursor, endCursor, totalCount? }`.

## 2. Idempotency Key Semantics

- **Header**: Mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) accept an `Idempotency-Key` header (1–256 characters).
- **Scope**: Keys are strictly scoped by `(organization_id, actor_user_id, route, key)`.
- **Concurrency Locking**:
  - If a second request arrives while an identical key is in flight, the API responds with `409 Conflict` (`IDEMPOTENCY_CONCURRENT_REQUEST`).
- **Payload Fingerprinting**:
  - A SHA-256 fingerprint of `METHOD:PATH:BODY` is stored with the key.
  - If a key is reused with a different request payload, the API responds with `422 Unprocessable Entity` (`IDEMPOTENCY_FINGERPRINT_MISMATCH`).
- **Replay Behavior**:
  - Completed requests return the original status and response body with header `Idempotent-Replay: true` without re-executing business logic or database mutations.
- **Failure Recovery**:
  - 5xx internal server errors release the in-flight key so callers can retry safely.

## 3. RFC 9457 Problem Details

All API errors return `application/problem+json` with standard fields:

- `type`: URI identifying the error type (`https://flowdesk.dev/problems/...`).
- `title`: Short human-readable summary.
- `status`: HTTP status code (400–599).
- `code`: Machine-readable error code string.
- `detail`: Human-readable explanation specific to this occurrence.
- `requestId`: Request correlation ID matching `x-request-id` response header.

## 4. Audit Logging

- **Attribution**: Security-sensitive operations emit immutable audit records into `flowdesk.audit_logs`:
  - `organization_id`, `actor_user_id`, `action`, `target_type`, `target_id`, `result`, `correlation_id`, `metadata`, `occurred_at`.
- **Secret Redaction**: `redactSensitiveMetadata` sanitizes metadata before persistence. Any key matching passwords, tokens, secrets, cookies, or credentials is automatically masked with `[REDACTED]`.
- **Viewer Route**: `GET /api/v1/organizations/:orgId/audit-logs` provides cursor-paginated audit history and is strictly restricted to roles with `audit:view` capability (`owner`, `admin`, `analyst`).

## 5. OpenAPI 3.1 Contract & Drift Detection

- **Specification Source**: Generated from `@flowdesk/contracts` definitions into `docs/api/openapi.json`.
- **Generation Command**: `pnpm openapi:generate`
- **Drift Verification**: `pnpm openapi:check` runs during `pnpm verify` and hosted CI. Any discrepancy between contracts and `openapi.json` fails the build immediately.
