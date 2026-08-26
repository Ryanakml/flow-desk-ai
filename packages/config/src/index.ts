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
