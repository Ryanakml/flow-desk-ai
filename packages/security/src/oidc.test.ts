import { describe, expect, it } from "vitest";
import {
  createOidcAuthorizationRequest,
  createOidcLogoutUrl,
  validateLogoutReturnUrl
} from "./oidc.js";

describe("OIDC authorization request", () => {
  it("uses PKCE, state, and nonce without prompt by default", () => {
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
    expect(request.authorizationUrl.searchParams.has("prompt")).toBe(false);
  });

  it("supports explicit prompt parameter for forced reauth or account switching", () => {
    const loginReq = createOidcAuthorizationRequest({
      issuer: "https://tenant.auth0.com",
      clientId: "client",
      redirectUri: "https://app.example/auth/callback",
      returnTo: "/",
      prompt: "login"
    });
    expect(loginReq.authorizationUrl.searchParams.get("prompt")).toBe("login");

    const switchReq = createOidcAuthorizationRequest({
      issuer: "https://tenant.auth0.com",
      clientId: "client",
      redirectUri: "https://app.example/auth/callback",
      returnTo: "/",
      prompt: "select_account"
    });
    expect(switchReq.authorizationUrl.searchParams.get("prompt")).toBe("select_account");
  });
});

describe("OIDC logout URL", () => {
  it("constructs correct Auth0 v2 logout URL with client_id and returnTo", () => {
    const logoutUrl = createOidcLogoutUrl({
      issuer: "https://auth.flowdesk.dev/",
      clientId: "test-client-id-123",
      returnTo: "https://app.flowdesk.dev/logged-out"
    });

    expect(logoutUrl.origin).toBe("https://auth.flowdesk.dev");
    expect(logoutUrl.pathname).toBe("/v2/logout");
    expect(logoutUrl.searchParams.get("client_id")).toBe("test-client-id-123");
    expect(logoutUrl.searchParams.get("returnTo")).toBe("https://app.flowdesk.dev/logged-out");
    expect(logoutUrl.toString()).not.toContain("client_secret");
    expect(logoutUrl.toString()).not.toContain("secret");
  });

  it("handles issuer without trailing slash correctly", () => {
    const logoutUrl = createOidcLogoutUrl({
      issuer: "https://dev-tenant.us.auth0.com",
      clientId: "client-abc",
      returnTo: "http://localhost:3000"
    });

    expect(logoutUrl.origin).toBe("https://dev-tenant.us.auth0.com");
    expect(logoutUrl.pathname).toBe("/v2/logout");
    expect(logoutUrl.searchParams.get("client_id")).toBe("client-abc");
    expect(logoutUrl.searchParams.get("returnTo")).toBe("http://localhost:3000");
  });
});

describe("validateLogoutReturnUrl", () => {
  const appBaseUrl = "https://app.flowdesk.dev";

  it("resolves safe relative paths against appBaseUrl", () => {
    expect(validateLogoutReturnUrl("/", appBaseUrl)).toBe("https://app.flowdesk.dev/");
    expect(validateLogoutReturnUrl("/login", appBaseUrl)).toBe("https://app.flowdesk.dev/login");
    expect(validateLogoutReturnUrl("/auth/signed-out?reason=user", appBaseUrl)).toBe(
      "https://app.flowdesk.dev/auth/signed-out?reason=user"
    );
  });

  it("accepts same-origin absolute URLs", () => {
    expect(validateLogoutReturnUrl("https://app.flowdesk.dev/dashboard", appBaseUrl)).toBe(
      "https://app.flowdesk.dev/dashboard"
    );
  });

  it("rejects open-redirect attempts and falls back to appBaseUrl", () => {
    // Protocol-relative URL
    expect(validateLogoutReturnUrl("//evil.com/phish", appBaseUrl)).toBe(appBaseUrl);
    // Cross-origin URL
    expect(validateLogoutReturnUrl("https://evil.com/phish", appBaseUrl)).toBe(appBaseUrl);
    expect(validateLogoutReturnUrl("http://evil.com", appBaseUrl)).toBe(appBaseUrl);
    // Malicious protocols
    expect(validateLogoutReturnUrl("javascript:alert(1)", appBaseUrl)).toBe(appBaseUrl);
    expect(validateLogoutReturnUrl("data:text/html,evil", appBaseUrl)).toBe(appBaseUrl);
    // Empty or undefined
    expect(validateLogoutReturnUrl(undefined, appBaseUrl)).toBe(appBaseUrl);
    expect(validateLogoutReturnUrl("", appBaseUrl)).toBe(appBaseUrl);
    expect(validateLogoutReturnUrl("   ", appBaseUrl)).toBe(appBaseUrl);
  });
});
