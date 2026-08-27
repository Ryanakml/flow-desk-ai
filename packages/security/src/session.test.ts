import { describe, expect, it } from "vitest";
import {
  createOpaqueToken,
  hashSessionToken,
  sameSessionToken,
  serializeSessionCookie,
  serializeExpiredSessionCookie,
  parseSessionCookie
} from "./session.js";
describe("sessions", () => {
  it("uses opaque, verifiable tokens", () => {
    const token = createOpaqueToken();
    expect(sameSessionToken(token, hashSessionToken(token))).toBe(true);
    expect(sameSessionToken(createOpaqueToken(), hashSessionToken(token))).toBe(false);
  });
  it("sets an HttpOnly host cookie", () =>
    expect(serializeSessionCookie("token", true)).toContain(
      "__Host-flowdesk_session=token; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800; Secure"
    ));
  it("clears an expired session cookie", () =>
    expect(serializeExpiredSessionCookie(true)).toContain(
      "__Host-flowdesk_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure"
    ));
  it("parses session cookie from header", () => {
    expect(parseSessionCookie("__Host-flowdesk_session=test-token; other=val")).toBe("test-token");
    expect(parseSessionCookie("other=val; __Host-flowdesk_session=another-token")).toBe(
      "another-token"
    );
    expect(parseSessionCookie("no-session=val")).toBeNull();
    expect(parseSessionCookie(undefined)).toBeNull();
  });
});
