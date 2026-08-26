import { loadHttpConfig } from "@flowdesk/config";
import { createLogger, initializeTelemetry } from "@flowdesk/observability";
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
const app = createApiApp({
  service: config.SERVICE_NAME,
  version: config.SERVICE_VERSION,
  gitSha: config.GIT_SHA,
  environment: config.APP_ENV,
  logRequest: (event) => logger.info(event, "http.request.completed")
});
const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, "api.started"));

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
