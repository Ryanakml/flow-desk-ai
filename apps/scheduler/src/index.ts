import { loadHttpConfig } from "@flowdesk/config";
import {
  createLogger,
  createProcessHealthServer,
  initializeTelemetry
} from "@flowdesk/observability";

import { Pool } from "pg";
import { runAnalyticsAggregationJob } from "./process.js";

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

const databaseUrl = process.env["DATABASE_URL"];
const dbPool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : undefined;

let aggregationTimer: NodeJS.Timeout | undefined;
let isAggregating = false;

if (dbPool) {
  aggregationTimer = setInterval(() => {
    if (isAggregating) return;
    isAggregating = true;
    runAnalyticsAggregationJob(dbPool)
      .then((res) => {
        if (res.totalBucketsAggregated > 0) {
          logger.info(res, "scheduler.analytics_aggregation.processed");
        }
      })
      .catch((err: unknown) => {
        logger.error({ err }, "scheduler.analytics_aggregation.error");
      })
      .finally(() => {
        isAggregating = false;
      });
  }, 60000);
}

const server = createProcessHealthServer({
  service: config.SERVICE_NAME,
  version: config.SERVICE_VERSION,
  gitSha: config.GIT_SHA,
  environment: config.APP_ENV
});
server.listen(config.PORT, "0.0.0.0", () =>
  logger.info(
    { port: config.PORT, host: "0.0.0.0", schedulesJobs: Boolean(dbPool) },
    "scheduler.started"
  )
);
function shutdown(signal: string) {
  logger.info({ signal }, "scheduler.stopping");
  if (aggregationTimer) clearInterval(aggregationTimer);
  server.close(() => {
    void Promise.all([
      dbPool?.end().catch((err: unknown) => logger.error({ err }, "scheduler.db_close_error")),
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
