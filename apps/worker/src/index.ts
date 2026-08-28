import { loadHttpConfig } from "@flowdesk/config";
import {
  createLogger,
  createProcessHealthServer,
  initializeTelemetry,
  recordOutboxSnapshot,
  recordWorkerBatchFailure
} from "@flowdesk/observability";
import { Pool } from "pg";
import { processOutboxWebhookBatch } from "./normalization.js";
import { processOutboxOutboundBatch, dispatchOutboundMessage } from "./dispatch.js";

export { processOutboxOutboundBatch, dispatchOutboundMessage };

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
    void Promise.all([
      processOutboxWebhookBatch(dbPool, 10),
      processOutboxOutboundBatch(dbPool, {}, 10)
    ])
      .then(([webhookCount, outboundCount]) => {
        if (webhookCount > 0 || outboundCount > 0) {
          logger.info(
            { webhookProcessed: webhookCount, outboundProcessed: outboundCount },
            "worker.outbox_batch.processed"
          );
        }
        return dbPool.query<{
          pending_events: string;
          oldest_age_seconds: number;
          dead_letter_events: string;
        }>(`SELECT pending_events::text,
                   oldest_event_age_seconds AS oldest_age_seconds,
                   dead_letter_events::text
            FROM flowdesk.messaging_operational_snapshot()`);
      })
      .then((snapshot) => {
        const row = snapshot.rows[0];
        if (row) {
          recordOutboxSnapshot({
            pendingEvents: Number(row.pending_events),
            oldestEventAgeSeconds: row.oldest_age_seconds,
            deadLetterEvents: Number(row.dead_letter_events)
          });
        }
      })
      .catch((error: unknown) => {
        recordWorkerBatchFailure("outbound");
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
