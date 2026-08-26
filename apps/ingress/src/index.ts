import { loadHttpConfig } from "@flowdesk/config";
import { createLogger, initializeTelemetry } from "@flowdesk/observability";
import { createIngressApp } from "./app.js";

const config = loadHttpConfig("ingress", Number(process.env["INGRESS_PORT"] ?? 4001));
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
const server = createIngressApp().listen(config.PORT, () =>
  logger.info({ port: config.PORT }, "ingress.started")
);

function shutdown(signal: string) {
  logger.info({ signal }, "ingress.stopping");
  server.close((error) => {
    void stopTelemetry().then(() => {
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
