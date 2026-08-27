import { describe, expect, it, vi } from "vitest";
import { MockIdentityProvider, OidcIdentityProvider } from "./identity.js";

describe("MockIdentityProvider", () => {
  const provider = new MockIdentityProvider();

  it("exchanges valid code for default operator identity", async () => {
    const claims = await provider.exchangeAuthorizationCode({
      code: "valid-code",
      codeVerifier: "verifier",
      redirectUri: "http://localhost/callback"
    });
    expect(claims).toEqual({
      provider: "mock",
      subject: "mock|operator",
      email: "operator@flowdesk.dev",
      displayName: "Operator",
      emailVerified: true
    });
  });

  it("extracts specific user from user: code prefix", async () => {
    const claims = await provider.exchangeAuthorizationCode({
      code: "user:alice@flowdesk.dev",
      codeVerifier: "verifier",
      redirectUri: "http://localhost/callback"
    });
    expect(claims.email).toBe("alice@flowdesk.dev");
    expect(claims.displayName).toBe("Alice");
    expect(claims.subject).toBe("mock|alice");
  });

  it("rejects invalid code", async () => {
    await expect(
      provider.exchangeAuthorizationCode({
        code: "invalid-code",
        codeVerifier: "verifier",
        redirectUri: "http://localhost/callback"
      })
    ).rejects.toThrow("Invalid or rejected authorization code");
  });
});

describe("OidcIdentityProvider", () => {
  it("exchanges code and extracts claims from id_token", async () => {
    const provider = new OidcIdentityProvider({
      issuer: "https://auth.flowdesk.dev/",
      clientId: "client-123",
      clientSecret: "secret-456"
    });

    const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "auth0|user1",
        email: "user1@flowdesk.dev",
        name: "User One",
        email_verified: true
      })
    ).toString("base64url");
    const mockIdToken = `${header}.${payload}.mock-signature`;

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id_token: mockIdToken, access_token: "mock-access-token" })
    });

    const claims = await provider.exchangeAuthorizationCode({
      code: "auth-code",
      codeVerifier: "verifier",
      redirectUri: "https://app.flowdesk.dev/callback"
    });

    expect(claims).toEqual({
      provider: "oidc",
      subject: "auth0|user1",
      email: "user1@flowdesk.dev",
      displayName: "User One",
      emailVerified: true
    });
  });

  it("throws when token endpoint fails", async () => {
    const provider = new OidcIdentityProvider({
      issuer: "https://auth.flowdesk.dev/",
      clientId: "client-123",
      clientSecret: "secret-456"
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("invalid_client")
    });

    await expect(
      provider.exchangeAuthorizationCode({
        code: "bad-code",
        codeVerifier: "verifier",
        redirectUri: "https://app.flowdesk.dev/callback"
      })
    ).rejects.toThrow("OIDC token exchange failed (401)");
  });
});
