import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["local", "preview", "staging", "production"]).default("local"),
  SERVICE_NAME: z.string().min(1),
  SERVICE_VERSION: z.string().min(1).default("dev"),
  GIT_SHA: z.string().min(1).default("local"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  OTEL_SERVICE_NAMESPACE: z.string().min(1).default("flowdesk")
});

const httpSchema = baseSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65535),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000)
});

export type BaseConfig = z.infer<typeof baseSchema>;
export type HttpConfig = z.infer<typeof httpSchema>;

export function loadBaseConfig(
  serviceName: string,
  environment: NodeJS.ProcessEnv = process.env
): BaseConfig {
  return baseSchema.parse({ ...environment, SERVICE_NAME: serviceName });
}

export function loadHttpConfig(
  serviceName: string,
  defaultPort: number,
  environment: NodeJS.ProcessEnv = process.env
): HttpConfig {
  return httpSchema.parse({
    ...environment,
    SERVICE_NAME: serviceName,
    PORT: environment["PORT"] ?? defaultPort
  });
}

export const dependencyConfigSchema = z.object({
  DATABASE_URL: z.string().startsWith("postgresql://"),
  REDIS_URL: z.string().startsWith("redis://"),
  S3_BUCKET: z.string().min(3),
  S3_REGION: z.string().min(1),
  S3_ENDPOINT: z.url().optional(),
  S3_FORCE_PATH_STYLE: booleanString.default(false)
});

export type DependencyConfig = z.infer<typeof dependencyConfigSchema>;

export function loadDependencyConfig(
  environment: NodeJS.ProcessEnv = process.env
): DependencyConfig {
  return dependencyConfigSchema.parse(environment);
}

const mediaConfigSchema = z
  .object({
    APP_ENV: z.enum(["local", "preview", "staging", "production"]).default("local"),
    S3_BUCKET: z.string().min(3).optional(),
    S3_REGION: z.string().min(1).optional(),
    S3_ENDPOINT: z.url().optional(),
    S3_FORCE_PATH_STYLE: booleanString.default(false),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    CLAMAV_HOST: z.string().min(1).optional(),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
    MEDIA_CLEAN_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
    MEDIA_REJECTED_RETENTION_DAYS: z.coerce.number().int().positive().default(7)
  })
  .superRefine((config, context) => {
    if (config.APP_ENV !== "staging" && config.APP_ENV !== "production") return;
    for (const field of [
      "S3_BUCKET",
      "S3_REGION",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "CLAMAV_HOST"
    ] as const) {
      if (!config[field]) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} is required in staging and production`
        });
      }
    }
  });

export type MediaConfig = z.infer<typeof mediaConfigSchema>;

export function loadMediaConfig(environment: NodeJS.ProcessEnv = process.env): MediaConfig {
  return mediaConfigSchema.parse(environment);
}

const optionalAiSecret = z.preprocess(
  (value) =>
    typeof value === "string" &&
    (value.trim() === "" || value.trim().toLowerCase().startsWith("replace-with-"))
      ? undefined
      : value,
  z.string().trim().min(20).optional()
);

const aiRuntimeConfigSchema = z
  .object({
    APP_ENV: z.enum(["local", "preview", "staging", "production"]).default("local"),
    AI_PROVIDER: z.enum(["disabled", "fake", "openai"]).default("disabled"),
    OPENAI_API_KEY: optionalAiSecret,
    OPENAI_BASE_URL: z.url().default("https://api.openai.com/v1"),
    OPENAI_CHAT_MODEL: z.string().trim().min(1).default("gpt-4o-mini"),
    OPENAI_EMBEDDING_MODEL: z.string().trim().min(1).default("text-embedding-3-small"),
    AI_CHAT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
    AI_EMBEDDING_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(4_096).default(512)
  })
  .superRefine((config, context) => {
    if (config.AI_PROVIDER === "openai" && !config.OPENAI_API_KEY) {
      context.addIssue({
        code: "custom",
        path: ["OPENAI_API_KEY"],
        message: "OPENAI_API_KEY is required when AI_PROVIDER=openai"
      });
    }
    if (
      config.AI_PROVIDER === "fake" &&
      (config.APP_ENV === "staging" || config.APP_ENV === "production")
    ) {
      context.addIssue({
        code: "custom",
        path: ["AI_PROVIDER"],
        message: "AI_PROVIDER=fake is forbidden in staging and production"
      });
    }
    if (
      (config.APP_ENV === "staging" || config.APP_ENV === "production") &&
      !config.OPENAI_BASE_URL.startsWith("https://")
    ) {
      context.addIssue({
        code: "custom",
        path: ["OPENAI_BASE_URL"],
        message: "OPENAI_BASE_URL must use HTTPS in staging and production"
      });
    }
  });

export type AiRuntimeConfig = z.infer<typeof aiRuntimeConfigSchema>;

export function loadAiRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): AiRuntimeConfig {
  return aiRuntimeConfigSchema.parse(environment);
}

export const authConfigSchema = z.object({
  AUTH_OIDC_ISSUER: z.string().url().default("https://flowdesk.local.auth0.com/"),
  AUTH_OIDC_CLIENT_ID: z.string().min(1).default("flowdesk-local-client"),
  AUTH_OIDC_CLIENT_SECRET: z.string().min(1).default("flowdesk-local-secret"),
  AUTH_OIDC_REDIRECT_URI: z.string().url().default("http://localhost:4000/api/v1/auth/callback"),
  AUTH_COOKIE_SECURE: booleanString.default(false),
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(28_800),
  AUTH_MOCK_ENABLED: booleanString.default(true),
  APP_BASE_URL: z.string().url().default("http://localhost:3000")
});

export type AuthConfig = z.infer<typeof authConfigSchema>;

export function loadAuthConfig(environment: NodeJS.ProcessEnv = process.env): AuthConfig {
  return authConfigSchema.parse(environment);
}

const DEFAULT_WEBHOOK_VERIFY_TOKEN = "flowdesk_webhook_verify_token_default";
const DEFAULT_WEBHOOK_APP_SECRET = "flowdesk_webhook_app_secret_default";

export const webhookConfigSchema = z
  .object({
    APP_ENV: z.enum(["local", "preview", "staging", "production"]).default("local"),
    WEBHOOK_VERIFY_TOKEN: z.string().min(1).default(DEFAULT_WEBHOOK_VERIFY_TOKEN),
    WEBHOOK_APP_SECRET: z.string().min(1).default(DEFAULT_WEBHOOK_APP_SECRET)
  })
  .superRefine((config, context) => {
    if (config.APP_ENV !== "staging" && config.APP_ENV !== "production") return;
    const unsafeValues: Array<["WEBHOOK_VERIFY_TOKEN" | "WEBHOOK_APP_SECRET", string]> = [
      ["WEBHOOK_VERIFY_TOKEN", config.WEBHOOK_VERIFY_TOKEN],
      ["WEBHOOK_APP_SECRET", config.WEBHOOK_APP_SECRET]
    ];
    for (const [field, value] of unsafeValues) {
      if (
        value === DEFAULT_WEBHOOK_VERIFY_TOKEN ||
        value === DEFAULT_WEBHOOK_APP_SECRET ||
        value.toLowerCase().startsWith("replace-with-")
      ) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} must be configured with a real Meta App value in staging and production`
        });
      }
    }
  })
  .transform(({ WEBHOOK_VERIFY_TOKEN, WEBHOOK_APP_SECRET }) => ({
    WEBHOOK_VERIFY_TOKEN,
    WEBHOOK_APP_SECRET
  }));

export type WebhookConfig = z.infer<typeof webhookConfigSchema>;

export function loadWebhookConfig(environment: NodeJS.ProcessEnv = process.env): WebhookConfig {
  return webhookConfigSchema.parse(environment);
}

/**
 * Credentials for FlowDesk's single, platform-owned Meta App. App Secret is
 * intentionally server-only: it must never be placed in the web bundle or a
 * tenant-owned channel record.
 */
const DEFAULT_META_GRAPH_API_BASE_URL = "https://graph.facebook.com/v25.0";
const optionalMetaCredential = z.preprocess(
  (value) =>
    typeof value === "string" &&
    (value.trim() === "" || value.trim().toLowerCase().startsWith("replace-with-"))
      ? undefined
      : value,
  z.string().trim().min(1).optional()
);

const whatsAppGraphApiConfigSchema = z.object({
  META_GRAPH_API_BASE_URL: z.string().url().default(DEFAULT_META_GRAPH_API_BASE_URL)
});

export type WhatsAppGraphApiConfig = z.infer<typeof whatsAppGraphApiConfigSchema>;

export function loadWhatsAppGraphApiConfig(
  environment: NodeJS.ProcessEnv = process.env
): WhatsAppGraphApiConfig {
  return whatsAppGraphApiConfigSchema.parse(environment);
}

const metaEmbeddedSignupConfigSchema = z
  .object({
    META_APP_ID: optionalMetaCredential,
    META_APP_SECRET: optionalMetaCredential,
    META_EMBEDDED_SIGNUP_CONFIG_ID: optionalMetaCredential,
    META_SYSTEM_USER_ACCESS_TOKEN: optionalMetaCredential,
    META_SYSTEM_USER_ID: optionalMetaCredential,
    META_ADMIN_SYSTEM_USER_ACCESS_TOKEN: optionalMetaCredential,
    META_GRAPH_API_BASE_URL: z.string().url().default(DEFAULT_META_GRAPH_API_BASE_URL)
  })
  .superRefine((config, context) => {
    const configured = [
      config.META_APP_ID,
      config.META_APP_SECRET,
      config.META_EMBEDDED_SIGNUP_CONFIG_ID,
      config.META_SYSTEM_USER_ACCESS_TOKEN,
      config.META_SYSTEM_USER_ID,
      config.META_ADMIN_SYSTEM_USER_ACCESS_TOKEN
    ].filter(Boolean).length;
    if (configured !== 0 && configured !== 6) {
      context.addIssue({
        code: "custom",
        message:
          "META_APP_ID, META_APP_SECRET, META_EMBEDDED_SIGNUP_CONFIG_ID, META_SYSTEM_USER_ACCESS_TOKEN, META_SYSTEM_USER_ID, and META_ADMIN_SYSTEM_USER_ACCESS_TOKEN must be configured together"
      });
    }
  })
  .transform((config) =>
    config.META_APP_ID &&
    config.META_APP_SECRET &&
    config.META_EMBEDDED_SIGNUP_CONFIG_ID &&
    config.META_SYSTEM_USER_ACCESS_TOKEN &&
    config.META_SYSTEM_USER_ID &&
    config.META_ADMIN_SYSTEM_USER_ACCESS_TOKEN
      ? {
          appId: config.META_APP_ID,
          appSecret: config.META_APP_SECRET,
          configId: config.META_EMBEDDED_SIGNUP_CONFIG_ID,
          systemUserAccessToken: config.META_SYSTEM_USER_ACCESS_TOKEN,
          systemUserId: config.META_SYSTEM_USER_ID,
          adminSystemUserAccessToken: config.META_ADMIN_SYSTEM_USER_ACCESS_TOKEN,
          graphApiBaseUrl: config.META_GRAPH_API_BASE_URL
        }
      : undefined
  );

export type MetaEmbeddedSignupConfig = NonNullable<z.infer<typeof metaEmbeddedSignupConfigSchema>>;

export function loadMetaEmbeddedSignupConfig(
  environment: NodeJS.ProcessEnv = process.env
): MetaEmbeddedSignupConfig | undefined {
  return metaEmbeddedSignupConfigSchema.parse(environment);
}

const DEVELOPMENT_ENCRYPTION_KEY = "dev-encryption-key-32-bytes-long!!";

const channelEncryptionConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_ENV: z.enum(["local", "preview", "staging", "production"]).default("local"),
    ENCRYPTION_KEY: z.string().min(16).optional()
  })
  .superRefine((config, context) => {
    const developmentFallbackAllowed =
      config.NODE_ENV === "development" && config.APP_ENV === "local";
    if (!config.ENCRYPTION_KEY && !developmentFallbackAllowed) {
      context.addIssue({
        code: "custom",
        path: ["ENCRYPTION_KEY"],
        message: "ENCRYPTION_KEY is required outside local development"
      });
    }
    if (
      !developmentFallbackAllowed &&
      config.ENCRYPTION_KEY?.toLowerCase().startsWith("replace-with-")
    ) {
      context.addIssue({
        code: "custom",
        path: ["ENCRYPTION_KEY"],
        message: "ENCRYPTION_KEY must not be a placeholder outside local development"
      });
    }
  })
  .transform((config) => ({
    ENCRYPTION_KEY: config.ENCRYPTION_KEY ?? DEVELOPMENT_ENCRYPTION_KEY
  }));

export type ChannelEncryptionConfig = z.infer<typeof channelEncryptionConfigSchema>;

export function loadChannelEncryptionConfig(
  environment: NodeJS.ProcessEnv = process.env
): ChannelEncryptionConfig {
  return channelEncryptionConfigSchema.parse(environment);
}
