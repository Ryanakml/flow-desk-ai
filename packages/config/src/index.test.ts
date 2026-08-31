import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadAiRuntimeConfig,
  loadAuthConfig,
  loadChannelEncryptionConfig,
  loadHttpConfig,
  loadMetaEmbeddedSignupConfig,
  loadMediaConfig,
  loadWebhookConfig,
  loadWhatsAppGraphApiConfig
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

describe("loadAiRuntimeConfig", () => {
  it("defaults to a disabled AI runtime instead of silently selecting a fake provider", () => {
    expect(loadAiRuntimeConfig({})).toMatchObject({
      AI_PROVIDER: "disabled",
      OPENAI_CHAT_MODEL: "gpt-4o-mini",
      OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
      AI_CHAT_TIMEOUT_MS: 15_000,
      AI_EMBEDDING_TIMEOUT_MS: 15_000,
      AI_MAX_OUTPUT_TOKENS: 512
    });
  });

  it("requires a non-placeholder credential when OpenAI is enabled", () => {
    expect(() => loadAiRuntimeConfig({ AI_PROVIDER: "openai" })).toThrow();
    expect(() =>
      loadAiRuntimeConfig({
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "replace-with-openai-api-key"
      })
    ).toThrow();
    expect(
      loadAiRuntimeConfig({
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-test-key-with-safe-length"
      })
    ).toMatchObject({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "synthetic-test-key-with-safe-length"
    });
  });

  it("allows explicit local fake use but rejects it in staging and production", () => {
    expect(loadAiRuntimeConfig({ APP_ENV: "local", AI_PROVIDER: "fake" })).toMatchObject({
      AI_PROVIDER: "fake"
    });
    expect(() => loadAiRuntimeConfig({ APP_ENV: "staging", AI_PROVIDER: "fake" })).toThrow();
    expect(() => loadAiRuntimeConfig({ APP_ENV: "production", AI_PROVIDER: "fake" })).toThrow();
  });

  it("requires HTTPS provider transport outside local and preview environments", () => {
    expect(() =>
      loadAiRuntimeConfig({
        APP_ENV: "staging",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-test-key-with-safe-length",
        OPENAI_BASE_URL: "http://provider.invalid/v1"
      })
    ).toThrow();
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
    expect(() =>
      loadChannelEncryptionConfig({
        NODE_ENV: "production",
        APP_ENV: "staging",
        ENCRYPTION_KEY: "replace-with-random-encryption-key"
      })
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

describe("loadWebhookConfig", () => {
  it("allows local defaults but rejects defaults and placeholders in staging", () => {
    expect(loadWebhookConfig({})).toEqual({
      WEBHOOK_VERIFY_TOKEN: "flowdesk_webhook_verify_token_default",
      WEBHOOK_APP_SECRET: "flowdesk_webhook_app_secret_default"
    });
    expect(() => loadWebhookConfig({ APP_ENV: "staging" })).toThrow();
    expect(() =>
      loadWebhookConfig({
        APP_ENV: "staging",
        WEBHOOK_VERIFY_TOKEN: "real-verify-token",
        WEBHOOK_APP_SECRET: "replace-with-meta-app-secret"
      })
    ).toThrow();
    expect(
      loadWebhookConfig({
        APP_ENV: "staging",
        WEBHOOK_VERIFY_TOKEN: "real-verify-token",
        WEBHOOK_APP_SECRET: "real-meta-app-secret"
      })
    ).toEqual({
      WEBHOOK_VERIFY_TOKEN: "real-verify-token",
      WEBHOOK_APP_SECRET: "real-meta-app-secret"
    });
  });
});

describe("loadMetaEmbeddedSignupConfig", () => {
  it("is disabled until every server-side platform credential is configured", () => {
    expect(loadMetaEmbeddedSignupConfig({})).toBeUndefined();
    expect(() => loadMetaEmbeddedSignupConfig({ META_APP_ID: "app-id" })).toThrow();
  });

  it("treats deployment placeholders as disabled instead of usable credentials", () => {
    expect(
      loadMetaEmbeddedSignupConfig({
        META_APP_ID: "replace-with-flowdesk-meta-app-id",
        META_APP_SECRET: "replace-with-flowdesk-meta-app-secret",
        META_EMBEDDED_SIGNUP_CONFIG_ID: "replace-with-meta-embedded-signup-config-id",
        META_SYSTEM_USER_ACCESS_TOKEN: "replace-with-flowdesk-system-user-access-token",
        META_SYSTEM_USER_ID: "replace-with-flowdesk-system-user-id",
        META_ADMIN_SYSTEM_USER_ACCESS_TOKEN: "replace-with-business-admin-system-user-access-token"
      })
    ).toBeUndefined();
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

describe("loadWhatsAppGraphApiConfig", () => {
  it("uses one current Graph API URL unless explicitly overridden", () => {
    expect(loadWhatsAppGraphApiConfig({})).toEqual({
      META_GRAPH_API_BASE_URL: "https://graph.facebook.com/v25.0"
    });
    expect(
      loadWhatsAppGraphApiConfig({
        META_GRAPH_API_BASE_URL: "https://graph.facebook.com/v26.0"
      })
    ).toEqual({ META_GRAPH_API_BASE_URL: "https://graph.facebook.com/v26.0" });
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

  it("passes the same Graph API URL to API and worker through shared environment", () => {
    const composePath = path.resolve(__dirname, "../../../infra/deploy/digitalocean/compose.yaml");
    const composeContent = fs.readFileSync(composePath, "utf-8");
    const sharedEnvironment = composeContent.match(
      /x-app-environment:[\s\S]*?x-api-meta-environment:/
    )?.[0];
    expect(sharedEnvironment).toContain("META_GRAPH_API_BASE_URL");
  });

  it("passes AI configuration only to the API and defaults staging AI to disabled", () => {
    const composePath = path.resolve(__dirname, "../../../infra/deploy/digitalocean/compose.yaml");
    const composeContent = fs.readFileSync(composePath, "utf-8");
    const sharedEnvironment = composeContent.match(
      /x-app-environment:[\s\S]*?x-api-meta-environment:/
    )?.[0];
    const aiEnvironment = composeContent.match(
      /x-api-ai-environment:[\s\S]*?x-ingress-webhook-environment:/
    )?.[0];
    const apiService = composeContent.match(/\n {2}api:[\s\S]*?\n {2}ingress:/)?.[0];
    const workerService = composeContent.match(/\n {2}worker:[\s\S]*?\n {2}scheduler:/)?.[0];

    expect(sharedEnvironment).not.toContain("OPENAI_API_KEY");
    expect(aiEnvironment).toContain("AI_PROVIDER: ${AI_PROVIDER:-disabled}");
    expect(aiEnvironment).toContain("OPENAI_API_KEY: ${OPENAI_API_KEY:-}");
    expect(apiService).toContain("*api-ai-environment");
    expect(workerService).toContain("*api-ai-environment");
  });
});
