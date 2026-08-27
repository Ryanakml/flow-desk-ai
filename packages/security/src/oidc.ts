import { createHash, randomBytes } from "node:crypto";

export interface OidcAuthorizationRequest {
  authorizationUrl: URL;
  state: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: Date;
}
const token = (bytes: number) => randomBytes(bytes).toString("base64url");

export function createOidcAuthorizationRequest(input: {
  issuer: string;
  clientId: string;
  redirectUri: string;
  returnTo: string;
  now?: Date;
}): OidcAuthorizationRequest {
  const state = token(32);
  const nonce = token(32);
  const codeVerifier = token(48);
  const authorizationUrl = new URL(
    "authorize",
    input.issuer.endsWith("/") ? input.issuer : `${input.issuer}/`
  );
  authorizationUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: createHash("sha256").update(codeVerifier).digest("base64url"),
    code_challenge_method: "S256",
    returnTo: input.returnTo
  }).toString();
  return {
    authorizationUrl,
    state,
    nonce,
    codeVerifier,
    expiresAt: new Date((input.now ?? new Date()).getTime() + 600_000)
  };
}
export const hashOidcSecret = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
