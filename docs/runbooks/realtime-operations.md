# Realtime Operations Runbook

FlowDesk uses an authenticated Socket.IO pipeline with Redis adapter fan-out (`/realtime`) to stream tenant-isolated projection invalidation hints to connected operator workspaces.

## Architectural Principles

1. **Hints, Not State**: Realtime events are strictly invalidation hints (`projection.changed`), never the source of truth. Authoritative data is always retrieved from PostgreSQL via authenticated REST endpoints.
2. **Zero PII in Realtime Envelopes**: Event payloads adhere to `RealtimeHintSchema` (`schemaVersion: 1`, `organizationId`, `resourceType`, `resourceId`, `version`). They never carry message text, phone numbers, or customer identifiers.
3. **Fail-Closed Authorization**: All socket handshakes and room join requests (`room.join`) verify active session and tenant/team/queue memberships against PostgreSQL.
4. **Monotonic Version Gap Recovery**: The database maintains monotonic tenant projection versions in `flowdesk.realtime_versions`. On handshake, the client provides `lastVersion`. If a gap exists, the server emits `realtime.ready` with `reconcileRequired: true`, prompting the browser to perform a full REST synchronization.

## Socket.IO Room Boundaries

- `organization:{orgId}`: Joined automatically upon handshake verification. Receives organization-wide invalidation hints.
- `team:{orgId}:{teamId}`: Joined explicitly via `room.join`. Permitted only for active team members or operators with `owner`, `admin`, or `supervisor` roles.
- `conversation:{orgId}:{conversationId}`: Joined explicitly via `room.join`. Permitted only for assigned queue members or supervisor/admin roles. Foreign conversation rooms are rejected with `ROOM_ACCESS_DENIED`.

## Periodic Authorization & Revocation

The realtime server executes a background authorization sweep every 5,000ms (configurable via `authorizationRecheckMs`):

- Verifies session token validity in `flowdesk.auth_sessions`.
- Verifies active membership in all joined rooms.
- If session or membership is revoked, emits `access.revoked` (`SESSION_REVOKED` or `ROOM_ACCESS_REVOKED`) and forcefully disconnects the socket (`socket.disconnect(true)`).

## Redis Clustering & Fan-Out

In clustered environments, Socket.IO nodes coordinate via `@socket.io/redis-adapter`:

- Set `REDIS_URL=redis://<host>:6379`.
- The adapter manages multi-node pub/sub broadcast for room emits.
- If Redis is unavailable and clustering is required (`redisRequired: true`), the server fails fast on startup.

## Observability & Signals

The service exports the following Prometheus metrics at `GET /metrics`:

- `realtime_active_connections`: Current count of authenticated operator sockets.
- `realtime_authorization_denials_total{room_type}`: Counter incremented when handshakes or room join attempts fail authorization (`handshake`, `session`, `organization`, `team`, `conversation`, `room_limit`).
- `realtime_reconnect_gaps_total{result="reconcile_required"}`: Counter incremented when an operator reconnects after a disconnect and requires REST projection reconciliation.
- `realtime_dropped_hints_total{reason="backpressure"}`: Counter incremented when slow consumers exceed internal write buffer limits.

## Incident & Triage Procedures

### 1. High Authorization Denial Rate

1. Check Prometheus metric: `rate(realtime_authorization_denials_total[5m])`.
2. Inspect log records for `realtime.auth_failed` or `ROOM_ACCESS_DENIED`.
3. Check if session cookie expiration or corporate IdP token expiry is churning operator sessions.

### 2. High Reconnect Gap Rate (Reconciliation Storm)

1. Check metric: `rate(realtime_reconnect_gaps_total[5m])`.
2. A sudden spike indicates network partition or rolling API deployment.
3. Confirm that REST endpoints `/api/v1/organizations/{orgId}/conversations` are handling the reconciliation refetches without elevated latency.

### 3. Dropped Hints (Backpressure)

1. Check metric: `rate(realtime_dropped_hints_total[5m])`.
2. Identifies operators with stalled WebSocket transports or congested network links.
3. Once the operator's socket drains or reconnects, the monotonic version protocol forces automatic reconciliation, preventing stale UI projections.
