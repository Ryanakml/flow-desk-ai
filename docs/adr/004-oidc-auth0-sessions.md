# ADR-004: Auth0 OIDC with FlowDesk-managed revocable sessions

- Status: Accepted
- Date: 2026-08-27
- Owners: FlowDesk owner
- Requirement: M1-04

## Context

FlowDesk must not store customer passwords or long-lived provider tokens in the browser. It needs standards-based identity, verified email, logout/revocation, and a future enterprise SSO path.

## Decision

Use Auth0 Universal Login through OpenID Connect Authorization Code + PKCE. The API validates OIDC callback state, nonce, issuer, audience, signature, and verified-email claim. FlowDesk stores only the provider subject mapping and its own opaque, hashed, revocable session record. The browser receives only a Secure, HttpOnly, SameSite=Lax cookie; provider tokens never enter browser storage or logs.

## Consequences

Auth0 tenant/domain/client credentials are deployment secrets. Local and preview use a dedicated sandbox tenant. Password, MFA, and social-login configuration remain Auth0 concerns unless a later ADR adds FlowDesk-owned authentication.

## Alternatives considered

- Local username/password: rejected; password/MFA recovery is unnecessary security surface.
- JWT-only browser sessions: rejected; revocation and rotation are weaker.
- Generic unaffiliated OIDC: rejected for M1 because a named operational owner and sandbox are required.

## Security, privacy, and operability impact

The callback requires PKCE + state + nonce. Session rotation/revocation produces audit events. Cookies are secure outside local development. Auth failures are generic and rate-limited in M1-08.

## Rollout and reversal

Auth routes are feature-gated until sandbox verification. Reversal disables login and revokes all active FlowDesk sessions; it never falls back to local passwords.
