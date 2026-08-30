import {
  loadAuthConfig,
  loadChannelEncryptionConfig,
  loadHttpConfig,
  loadMediaConfig
} from "@flowdesk/config";
import { createLogger, initializeTelemetry } from "@flowdesk/observability";
import { Pool } from "pg";
import { MetaWhatsAppProvider, S3ObjectStore } from "@flowdesk/providers";
import { createApiApp } from "./app.js";

const config = loadHttpConfig("api", Number(process.env["API_PORT"] ?? 4000));
const stopTelemetry = initializeTelemetry({
  service: config.SERVICE_NAME,
  ...(config.OTEL_EXPORTER_OTLP_ENDPOINT ? { endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT } : {})
});
const logger = createLogger({
  service: config.SERVICE_NAME,
  environment: config.APP_ENV,
  version: config.SERVICE_VERSION,
  level: config.LOG_LEVEL
});

const databaseUrl = process.env["DATABASE_URL"];
const dbPool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : undefined;
const authConfig = loadAuthConfig();
const channelEncryptionConfig = loadChannelEncryptionConfig();
const mediaConfig = loadMediaConfig();
const hasStorageConfig = Boolean(
  mediaConfig.S3_BUCKET &&
  mediaConfig.S3_REGION &&
  mediaConfig.S3_ACCESS_KEY_ID &&
  mediaConfig.S3_SECRET_ACCESS_KEY
);
const storage = hasStorageConfig
  ? new S3ObjectStore({
      ...(mediaConfig.S3_ENDPOINT ? { endpoint: mediaConfig.S3_ENDPOINT } : {}),
      region: mediaConfig.S3_REGION!,
      bucket: mediaConfig.S3_BUCKET!,
      accessKeyId: mediaConfig.S3_ACCESS_KEY_ID!,
      secretAccessKey: mediaConfig.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: mediaConfig.S3_FORCE_PATH_STYLE
    })
  : undefined;

const app = createApiApp({
  service: config.SERVICE_NAME,
  version: config.SERVICE_VERSION,
  gitSha: config.GIT_SHA,
  environment: config.APP_ENV,
  ...(dbPool
    ? {
        auth: {
          db: dbPool,
          config: authConfig,
          encryptionKey: channelEncryptionConfig.ENCRYPTION_KEY,
          whatsappProvider: new MetaWhatsAppProvider()
        }
      }
    : {}),
  ...(storage ? { storage } : {}),
  logRequest: (event) => logger.info(event, "http.request.completed"),
  logError: (event) => logger.error(event, "http.request.failed")
});
const server = app.listen(config.PORT, "0.0.0.0", () =>
  logger.info({ port: config.PORT, host: "0.0.0.0" }, "api.started")
);

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "api.stopping");
  const timer = setTimeout(() => {
    logger.error("api.shutdown_timeout");
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS);
  timer.unref();
  server.close((error) => {
    clearTimeout(timer);
    void dbPool?.end();
    void stopTelemetry().then(() => {
      if (error) {
        logger.error({ error }, "api.shutdown_failed");
        process.exitCode = 1;
      }
    });
  });
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
