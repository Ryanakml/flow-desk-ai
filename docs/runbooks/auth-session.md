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
3. **Session Revocation & Upstream OIDC / Auth0 Logout**:
   - Calling `POST /api/v1/auth/logout` or navigating to `GET /api/v1/auth/logout` revokes the local FlowDesk session (`flowdesk.auth_sessions.revoked_at = clock_timestamp()`) and clears the local cookie (`Max-Age=0`).
   - In addition to local session termination, it constructs the upstream OIDC/Auth0 logout URL (`{AUTH_OIDC_ISSUER}/v2/logout?client_id={AUTH_OIDC_CLIENT_ID}&returnTo={safeReturnTo}`).
   - The `returnTo` parameter is validated against `APP_BASE_URL` to protect against open-redirect vulnerabilities.
   - The frontend navigates the top-level browser window to this provider logout endpoint, terminating the Auth0 SSO cookies in the browser so that subsequent login attempts do not silently re-authenticate without user consent.
   - For tests and local development (`AUTH_MOCK_ENABLED=true`), logout safely redirects back to `safeReturnTo` (`APP_BASE_URL`).
4. **Reauthentication & Account Switching (Prompt Control)**:
   - Normal login requests to `GET /api/v1/auth/login` omit the `prompt` parameter, preserving standard OIDC SSO session reuse across visits.
   - Forced reauthentication can be triggered by passing `?prompt=login` or `?reauth=true`.
   - Account switching can be triggered by passing `?prompt=select_account` or `?switch=true`.
5. **Local & Testing Sandbox**:
   - When `AUTH_MOCK_ENABLED=true`, the API uses `MockIdentityProvider` which executes deterministic token exchange without external network dependencies.
