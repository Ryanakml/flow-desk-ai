import { loadHttpConfig } from "@flowdesk/config";
import {
  createLogger,
  createProcessHealthServer,
  initializeTelemetry
} from "@flowdesk/observability";
import { Pool } from "pg";
import { processOutboxWebhookBatch } from "./normalization.js";

const config = loadHttpConfig("worker", Number(process.env["WORKER_HEALTH_PORT"] ?? 4002));
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

const databaseUrl = process.env["DATABASE_URL"];
const dbPool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : undefined;

let pollingTimer: NodeJS.Timeout | undefined;
let isPolling = false;

if (dbPool) {
  pollingTimer = setInterval(() => {
    if (isPolling) return;
    isPolling = true;
    void processOutboxWebhookBatch(dbPool, 10)
      .then((count) => {
        if (count > 0) {
          logger.info({ processedCount: count }, "worker.outbox_batch.processed");
        }
      })
      .catch((error: unknown) => {
        logger.error({ error }, "worker.outbox_batch.error");
      })
      .finally(() => {
        isPolling = false;
      });
  }, 1000);
}

const server = createProcessHealthServer({
  service: config.SERVICE_NAME,
  version: config.SERVICE_VERSION,
  gitSha: config.GIT_SHA,
  environment: config.APP_ENV
});

server.listen(config.PORT, () =>
  logger.info({ port: config.PORT, claimsJobs: Boolean(dbPool) }, "worker.started")
);

function shutdown(signal: string) {
  logger.info({ signal }, "worker.stopping");
  if (pollingTimer) clearInterval(pollingTimer);
  server.close(() => {
    void Promise.all([
      dbPool?.end().catch((err: unknown) => logger.error({ err }, "worker.db_close_error")),
      stopTelemetry()
    ]);
  });
}

process.once("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.once("SIGINT", () => {
  shutdown("SIGINT");
});
