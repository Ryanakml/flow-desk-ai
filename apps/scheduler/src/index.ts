import { loadHttpConfig } from "@flowdesk/config";
import {
  createLogger,
  createProcessHealthServer,
  initializeTelemetry
} from "@flowdesk/observability";

const config = loadHttpConfig("scheduler", Number(process.env["SCHEDULER_HEALTH_PORT"] ?? 4003));
const logger = createLogger({
  service: config.SERVICE_NAME,
  environment: config.APP_ENV,
  version: config.SERVICE_VERSION,
  level: config.LOG_LEVEL
});
const stopTelemetry = initializeTelemetry({
  service: config.SERVICE_NAME,
  ...(config.OTEL_EXPORTER_OTLP_ENDPOINT ? { endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT } : {})
});
const server = createProcessHealthServer({
  service: config.SERVICE_NAME,
  version: config.SERVICE_VERSION,
  gitSha: config.GIT_SHA,
  environment: config.APP_ENV
});
server.listen(config.PORT, () =>
  logger.info({ port: config.PORT, schedulesJobs: false }, "scheduler.started")
);
function shutdown(signal: string) {
  logger.info({ signal }, "scheduler.stopping");
  server.close(() => {
    void stopTelemetry();
  });
}
process.once("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.once("SIGINT", () => {
  shutdown("SIGINT");
});
