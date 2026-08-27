import { describe, expect, it } from "vitest";
import { getSecurityHeaders } from "./headers.js";

describe("Security Headers (M1-08)", () => {
  it("provides baseline secure headers", () => {
    const headers = getSecurityHeaders();
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });

  it("includes HSTS when enabled", () => {
    const headers = getSecurityHeaders({ enableHsts: true });
    expect(headers["Strict-Transport-Security"]).toBe(
      "max-age=63072000; includeSubDomains; preload"
    );
  });

  it("allows custom CSP directives", () => {
    const headers = getSecurityHeaders({ cspDirectives: "default-src 'none'" });
    expect(headers["Content-Security-Policy"]).toBe("default-src 'none'");
  });
});
