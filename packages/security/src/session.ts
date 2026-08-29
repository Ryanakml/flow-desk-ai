import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "__Host-flowdesk_session";
export const LOCAL_SESSION_COOKIE_NAME = "flowdesk_session";

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
export function sameSessionToken(token: string, hash: string): boolean {
  const actual = Buffer.from(hashSessionToken(token));
  const expected = Buffer.from(hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function serializeSessionCookie(token: string, secure: boolean): string {
  const name = secure ? SESSION_COOKIE_NAME : LOCAL_SESSION_COOKIE_NAME;
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure ? "; Secure" : ""}`;
}

export function serializeExpiredSessionCookie(secure: boolean): string {
  const name = secure ? SESSION_COOKIE_NAME : LOCAL_SESSION_COOKIE_NAME;
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? "; Secure" : ""}`;
}

export function parseSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const matchHost = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
  if (matchHost?.[1]) return decodeURIComponent(matchHost[1]);
  const matchLocal = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${LOCAL_SESSION_COOKIE_NAME}=([^;]+)`)
  );
  return matchLocal?.[1] ? decodeURIComponent(matchLocal[1]) : null;
}
