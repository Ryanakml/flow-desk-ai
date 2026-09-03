import { createHash, randomBytes } from "node:crypto";

export interface OidcAuthorizationRequest {
  authorizationUrl: URL;
  state: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: Date;
}

export interface OidcLogoutUrlOptions {
  issuer: string;
  clientId: string;
  returnTo: string;
}

const token = (bytes: number) => randomBytes(bytes).toString("base64url");

export function createOidcAuthorizationRequest(input: {
  issuer: string;
  clientId: string;
  redirectUri: string;
  returnTo: string;
  prompt?: string | undefined;
  now?: Date;
}): OidcAuthorizationRequest {
  const state = token(32);
  const nonce = token(32);
  const codeVerifier = token(48);
  const authorizationUrl = new URL(
    "authorize",
    input.issuer.endsWith("/") ? input.issuer : `${input.issuer}/`
  );
  const searchParams = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: createHash("sha256").update(codeVerifier).digest("base64url"),
    code_challenge_method: "S256",
    returnTo: input.returnTo
  });
  if (input.prompt) {
    searchParams.set("prompt", input.prompt);
  }
  authorizationUrl.search = searchParams.toString();
  return {
    authorizationUrl,
    state,
    nonce,
    codeVerifier,
    expiresAt: new Date((input.now ?? new Date()).getTime() + 600_000)
  };
}

export function createOidcLogoutUrl(input: OidcLogoutUrlOptions): URL {
  const issuerUrl = input.issuer.endsWith("/") ? input.issuer : `${input.issuer}/`;
  const logoutUrl = new URL("v2/logout", issuerUrl);
  logoutUrl.searchParams.set("client_id", input.clientId);
  logoutUrl.searchParams.set("returnTo", input.returnTo);
  return logoutUrl;
}

export function validateLogoutReturnUrl(candidate: string | undefined, appBaseUrl: string): string {
  const fallback = appBaseUrl || "http://localhost:3000";
  if (!candidate || typeof candidate !== "string") {
    return fallback;
  }

  const trimmed = candidate.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    try {
      return new URL(trimmed, fallback).toString();
    } catch {
      return fallback;
    }
  }

  try {
    const candidateUrl = new URL(trimmed);
    const baseUrl = new URL(fallback);
    if (
      (candidateUrl.protocol === "http:" || candidateUrl.protocol === "https:") &&
      candidateUrl.origin === baseUrl.origin
    ) {
      return candidateUrl.toString();
    }
  } catch {
    return fallback;
  }

  return fallback;
}

export const hashOidcSecret = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
