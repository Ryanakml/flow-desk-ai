import { describe, expect, it } from "vitest";
import { loadAuthConfig, loadHttpConfig } from "./index.js";

describe("loadHttpConfig", () => {
  it("fails closed for an invalid port", () => {
    expect(() => loadHttpConfig("api", 4000, { PORT: "not-a-port" })).toThrow();
  });

  it("uses safe local defaults", () => {
    expect(loadHttpConfig("api", 4000, {})).toMatchObject({ SERVICE_NAME: "api", PORT: 4000 });
  });
});

describe("loadAuthConfig", () => {
  it("loads safe local defaults", () => {
    expect(loadAuthConfig({})).toMatchObject({
      AUTH_COOKIE_SECURE: false,
      AUTH_MOCK_ENABLED: true,
      AUTH_SESSION_TTL_SECONDS: 28_800
    });
  });

  it("fails closed for invalid issuer url", () => {
    expect(() => loadAuthConfig({ AUTH_OIDC_ISSUER: "not-a-url" })).toThrow();
  });
});
