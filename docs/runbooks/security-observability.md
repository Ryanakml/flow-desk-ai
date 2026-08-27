# Security Headers, Rate Limiting, Redaction, and Observability runbook

## Overview

FlowDesk implements defense-in-depth security controls and real-time operational telemetry across all service boundaries.

## 1. HTTP Security Headers

All HTTP responses from the FlowDesk API and web application shell are automatically decorated with standardized security headers:

- `Content-Security-Policy`: Restricts resource loading to trusted origins, prevents clickjacking (`frame-ancestors 'none'`), disables legacy plugins (`object-src 'none'`), and sets secure base URI.
- `X-Content-Type-Options: nosniff`: Prevents MIME-sniffing attacks.
- `X-Frame-Options: DENY`: Prevents UI redressing and framing.
- `Referrer-Policy: strict-origin-when-cross-origin`: Minimizes referrer leakage on cross-origin requests.
- `Permissions-Policy`: Explicitly disables sensitive browser capabilities (`camera=()`, `microphone=()`, `geolocation=()`, `payment=()`).
- `Cross-Origin-Opener-Policy: same-origin` & `Cross-Origin-Resource-Policy: same-origin`: Enforces cross-origin process isolation.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`: Automatically enforced on production/staging environments.
- `X-Powered-By`: Explicitly suppressed across all frameworks.

## 2. Rate Limiting

FlowDesk implements in-memory sliding window rate limiters to protect public and authenticated endpoints against brute-force, credential stuffing, and denial-of-service attempts.

- **Authentication Endpoints (`/api/v1/auth/*`)**:
  - Quota: 20 requests per 60-second window.
  - Partition Key: Client IP (`x-forwarded-for` or remote address).
- **Mutating Tenant Endpoints**:
  - Quota: 120 requests per 60-second window.
  - Partition Key: `(organization_id, actor_user_id)` or client IP.
- **Response Headers**:
  - `RateLimit-Limit`: Maximum allowable requests in the active window.
  - `RateLimit-Remaining`: Remaining request allowance.
  - `RateLimit-Reset`: Seconds remaining until window replenishment.
- **429 Problem Response**:
  - Emits RFC 9457 Problem (`RATE_LIMIT_EXCEEDED`, status 429) with `Retry-After: <seconds>`.

## 3. PII & Secret Redaction

To prevent sensitive information leakage into log aggregators, telemetry pipelines, and trace exports:

- **Logs & Structured Context**:
  - Pino logger configured with automatic path censoring for `authorization`, `cookie`, `token`, `password`, `secret`, `messageText`, and `providerPayload`.
- **Identity Fields**:
  - Email addresses in logs/telemetry are partially masked (e.g. `a***e@example.com`) preserving domain for debugging while redacting user handle.
- **Audit Metadata**:
  - Sensitive metadata in `flowdesk.audit_logs` is recursively sanitized before database persistence.

## 4. Operational Telemetry & Metrics

Prometheus-compatible metrics are recorded and served via `GET /metrics`:

- `http_requests_total{method, route, status_code}`: Request counter partitioned by HTTP verb, path template, and status code.
- `http_request_duration_seconds{method, route}`: Request latency summary.
- `auth_denials_total{reason}`: Authentication failure counter (e.g., `MISSING_SESSION`, `SESSION_EXPIRED`).
- `permission_denials_total{permission, role}`: Authorization denials from domain capability policies.
- `rate_limit_exceeded_total{route}`: Counter tracking 429 rate limit blocks.

## 5. Attributable Audit Viewer

- The audit viewer endpoint `GET /api/v1/organizations/:orgId/audit-logs` itself emits an immutable audit event (`action: "audit:viewed"`) whenever invoked.
- Unauthorized access attempts are rejected with 403 Forbidden and increment `permission_denials_total`.

## 6. Dashboards & Alerts

- **Grafana Dashboard**: `infra/monitoring/grafana/provisioning/dashboards/m1_operational_dashboard.json`.
- **Key Health Indicators**:
  - HTTP 5xx error rate > 1% triggers P2 alert.
  - P95 latency > 500ms triggers investigation.
  - Auth denial surge > 50/min triggers security review for credential stuffing.
