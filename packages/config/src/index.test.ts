import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadAuthConfig,
  loadChannelEncryptionConfig,
  loadHttpConfig,
  loadMetaEmbeddedSignupConfig,
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

describe("loadMetaEmbeddedSignupConfig", () => {
  it("is disabled until every server-side platform credential is configured", () => {
    expect(loadMetaEmbeddedSignupConfig({})).toBeUndefined();
    expect(() => loadMetaEmbeddedSignupConfig({ META_APP_ID: "app-id" })).toThrow();
  });

  it("keeps the platform App Secret and system-user token server-only", () => {
    expect(
      loadMetaEmbeddedSignupConfig({
        META_APP_ID: "app-id",
        META_APP_SECRET: "app-secret",
        META_EMBEDDED_SIGNUP_CONFIG_ID: "config-id",
        META_SYSTEM_USER_ACCESS_TOKEN: "system-user-token",
        META_SYSTEM_USER_ID: "system-user-id",
        META_ADMIN_SYSTEM_USER_ACCESS_TOKEN: "admin-system-user-token",
        META_GRAPH_API_BASE_URL: "https://graph.facebook.com/v25.0"
      })
    ).toEqual({
      appId: "app-id",
      appSecret: "app-secret",
      configId: "config-id",
      systemUserAccessToken: "system-user-token",
      systemUserId: "system-user-id",
      adminSystemUserAccessToken: "admin-system-user-token",
      graphApiBaseUrl: "https://graph.facebook.com/v25.0"
    });
  });
});

describe("docker compose deployment contract", () => {
  it("includes ENCRYPTION_KEY under x-app-environment in staging compose file", () => {
    const composePath = path.resolve(__dirname, "../../../infra/deploy/digitalocean/compose.yaml");
    const composeContent = fs.readFileSync(composePath, "utf-8");
    expect(composeContent).toMatch(
      /x-app-environment:[\s\S]*?ENCRYPTION_KEY:\s*\$\{ENCRYPTION_KEY/
    );
  });
});
