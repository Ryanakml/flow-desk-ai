import { describe, expect, it } from "vitest";
import {
  loadAuthConfig,
  loadChannelEncryptionConfig,
  loadHttpConfig,
  loadMediaConfig
} from "./index.js";

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

describe("loadChannelEncryptionConfig", () => {
  it("allows the fallback only for local development", () => {
    expect(
      loadChannelEncryptionConfig({ NODE_ENV: "development", APP_ENV: "local" })
    ).toMatchObject({ ENCRYPTION_KEY: "dev-encryption-key-32-bytes-long!!" });
    expect(() => loadChannelEncryptionConfig({ NODE_ENV: "test", APP_ENV: "local" })).toThrow();
    expect(() =>
      loadChannelEncryptionConfig({ NODE_ENV: "production", APP_ENV: "staging" })
    ).toThrow();
  });

  it("uses the canonical ENCRYPTION_KEY in staging and production", () => {
    expect(
      loadChannelEncryptionConfig({
        NODE_ENV: "production",
        APP_ENV: "staging",
        ENCRYPTION_KEY: "staging-channel-key-material"
      })
    ).toEqual({ ENCRYPTION_KEY: "staging-channel-key-material" });
  });
});
