# Auth and Session runbook

## Overview

FlowDesk delegates primary identity verification to an OpenID Connect provider (Auth0 / OIDC) and maintains its own opaque, revocable application sessions in `flowdesk.auth_sessions`.

## Security Boundaries

1. **OIDC Callback & PKCE**:
   - `GET /api/v1/auth/login` generates state, nonce, and PKCE challenge, records an expiring record in `flowdesk.oidc_authorization_transactions`, and sets a short-lived HttpOnly PKCE cookie.
   - `GET /api/v1/auth/callback` consumes the state transaction atomically. Replays, expired states, or mismatched PKCE verifiers fail with RFC 9457 problem responses (`AUTH_STATE_INVALID` or `PKCE_VERIFICATION_FAILED`).
2. **Session Storage & Cookie**:
   - Sessions are identified by high-entropy opaque tokens (32 bytes base64url).
   - Only `sha256(token)` is stored in `flowdesk.auth_sessions.token_hash`.
   - The browser receives an `HttpOnly; SameSite=Lax; Path=/` cookie (`__Host-flowdesk_session` with `Secure` flag enabled in non-local environments).
   - Long-lived provider tokens (access tokens, refresh tokens) never enter browser storage or telemetry logs.
3. **Session Revocation & Logout**:
   - Calling `POST /api/v1/auth/logout` immediately updates `flowdesk.auth_sessions.revoked_at = clock_timestamp()` and sends an expired cookie with `Max-Age=0`.
   - Any subsequent request using that token fails closed with 401 `SESSION_EXPIRED`.
4. **Local & Testing Sandbox**:
   - When `AUTH_MOCK_ENABLED=true`, the API uses `MockIdentityProvider` which executes deterministic token exchange without external network dependencies.
