import { loadHttpConfig, loadWebhookConfig } from "@flowdesk/config";
import { createLogger, initializeTelemetry } from "@flowdesk/observability";
import { Pool } from "pg";
import { createIngressApp } from "./app.js";

const config = loadHttpConfig("ingress", Number(process.env["INGRESS_PORT"] ?? 4001));
const webhookConfig = loadWebhookConfig();
const databaseUrl = process.env["DATABASE_URL"];
const dbPool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : undefined;

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
const server = createIngressApp({
  webhookVerifyToken: webhookConfig.WEBHOOK_VERIFY_TOKEN,
  webhookAppSecret: webhookConfig.WEBHOOK_APP_SECRET,
  ...(dbPool ? { dbClient: dbPool } : {})
}).listen(config.PORT, "0.0.0.0", () =>
  logger.info({ port: config.PORT, host: "0.0.0.0" }, "ingress.started")
);

function shutdown(signal: string) {
  logger.info({ signal }, "ingress.stopping");
  server.close((error) => {
    void Promise.all([
      dbPool?.end().catch((err: unknown) => logger.error({ err }, "ingress.db_close_error")),
      stopTelemetry()
    ]).then(() => {
      if (error) process.exitCode = 1;
    });
  });
}
process.once("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.once("SIGINT", () => {
  shutdown("SIGINT");
});
