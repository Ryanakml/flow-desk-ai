import { describe, expect, it } from "vitest";
import { loadAuthConfig, loadHttpConfig, loadMediaConfig } from "./index.js";

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

describe("loadMediaConfig", () => {
  it("uses bounded local retention defaults", () => {
    expect(loadMediaConfig({})).toMatchObject({
      CLAMAV_PORT: 3310,
      MEDIA_CLEAN_RETENTION_DAYS: 90,
      MEDIA_REJECTED_RETENTION_DAYS: 7
    });
  });

  it("fails closed when staging media dependencies are absent", () => {
    expect(() => loadMediaConfig({ APP_ENV: "staging" })).toThrow();
  });
});
