import { describe, expect, it } from "vitest";
import { createOidcAuthorizationRequest } from "./oidc.js";
describe("OIDC authorization request", () =>
  it("uses PKCE, state, and nonce", () => {
    const request = createOidcAuthorizationRequest({
      issuer: "https://tenant.auth0.com/",
      clientId: "client",
      redirectUri: "https://app.example/auth/callback",
      returnTo: "/"
    });
    expect(request.authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(request.authorizationUrl.searchParams.get("state")).toBe(request.state);
    expect(request.authorizationUrl.searchParams.get("nonce")).toBe(request.nonce);
    expect(request.authorizationUrl.searchParams.get("code_challenge")).not.toBe(
      request.codeVerifier
    );
  }));
