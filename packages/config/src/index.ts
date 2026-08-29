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

export const webhookConfigSchema = z.object({
  WEBHOOK_VERIFY_TOKEN: z.string().min(1).default("flowdesk_webhook_verify_token_default"),
  WEBHOOK_APP_SECRET: z.string().min(1).default("flowdesk_webhook_app_secret_default")
});

export type WebhookConfig = z.infer<typeof webhookConfigSchema>;

export function loadWebhookConfig(environment: NodeJS.ProcessEnv = process.env): WebhookConfig {
  return webhookConfigSchema.parse(environment);
}
