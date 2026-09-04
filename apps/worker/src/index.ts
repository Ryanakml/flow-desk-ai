import {
  loadAiRuntimeConfig,
  loadChannelEncryptionConfig,
  loadHttpConfig,
  loadMediaConfig,
  loadWhatsAppGraphApiConfig
} from "@flowdesk/config";
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
import { processOutboxWebhookDispatchBatch } from "./webhook-dispatch.js";
import {
  ClamAvScanner,
  createAiProviderRuntime,
  FakeMalwareScanner,
  MetaWhatsAppProvider,
  S3ObjectStore
} from "@flowdesk/providers";
import { processAttachmentScanBatch } from "./media-scanner.js";
import { processAttachmentRetentionBatch } from "./media-retention.js";
import { processKnowledgeIngestionBatch } from "./knowledge-ingestion.js";
import { processBotDraftBatch } from "./bot-drafts.js";

export { processOutboxOutboundBatch, dispatchOutboundMessage };

const config = loadHttpConfig("worker", Number(process.env["WORKER_HEALTH_PORT"] ?? 4002));
const channelEncryptionConfig = loadChannelEncryptionConfig();
const whatsAppGraphApiConfig = loadWhatsAppGraphApiConfig();
const aiRuntime = createAiProviderRuntime(loadAiRuntimeConfig());
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
const scanner = mediaConfig.CLAMAV_HOST
  ? new ClamAvScanner({
      host: mediaConfig.CLAMAV_HOST,
      port: mediaConfig.CLAMAV_PORT
    })
  : new FakeMalwareScanner();
const provider = new MetaWhatsAppProvider({
  graphApiBaseUrl: whatsAppGraphApiConfig.META_GRAPH_API_BASE_URL
});
const mediaLogger = {
  info: (message: string, context?: Record<string, unknown>) => logger.info(context ?? {}, message),
  warn: (message: string, context?: Record<string, unknown>) => logger.warn(context ?? {}, message),
  error: (message: string, context?: Record<string, unknown>) =>
    logger.error(context ?? {}, message)
};

let pollingTimer: NodeJS.Timeout | undefined;
let isPolling = false;
let lastRetentionRun = 0;

if (dbPool) {
  pollingTimer = setInterval(() => {
    if (isPolling) return;
    isPolling = true;
    const retentionDue = Date.now() - lastRetentionRun >= 60 * 60 * 1000;
    void Promise.all([
      processOutboxWebhookBatch(dbPool, 10),
      processOutboxOutboundBatch(
        dbPool,
        {
          provider,
          encryptionKey: channelEncryptionConfig.ENCRYPTION_KEY,
          ...(storage ? { storage } : {})
        },
        10
      ),
      processOutboxWebhookDispatchBatch(
        dbPool,
        {
          encryptionKey: channelEncryptionConfig.ENCRYPTION_KEY
        },
        10
      ),
      ...(aiRuntime
        ? [
            processKnowledgeIngestionBatch(
              dbPool,
              {
                embeddingProvider: aiRuntime.embeddingProvider,
                logger: {
                  error: (context, msg) => logger.error(context, msg),
                  info: (context, msg) => logger.info(context, msg),
                  warn: (context, msg) => logger.warn(context, msg)
                }
              },
              5
            ),
            processBotDraftBatch(
              dbPool,
              {
                chatProvider: aiRuntime.chatProvider,
                embeddingProvider: aiRuntime.embeddingProvider,
                chatModel: aiRuntime.chatModel,
                logger: {
                  error: (context, msg) => logger.error(context, msg),
                  info: (context, msg) => logger.info(context, msg),
                  warn: (context, msg) => logger.warn(context, msg)
                }
              },
              5
            )
          ]
        : []),
      ...(storage
        ? [
            processAttachmentScanBatch(dbPool, { storage, scanner, logger: mediaLogger }, 10),
            ...(retentionDue
              ? [
                  processAttachmentRetentionBatch(
                    dbPool,
                    { storage, logger: mediaLogger },
                    {
                      cleanRetentionDays: mediaConfig.MEDIA_CLEAN_RETENTION_DAYS,
                      rejectedRetentionDays: mediaConfig.MEDIA_REJECTED_RETENTION_DAYS
                    }
                  ).then((result) => {
                    lastRetentionRun = Date.now();
                    return result.processed;
                  })
                ]
              : [])
          ]
        : [])
    ])
      .then((counts) => {
        const [webhookCount = 0, outboundCount = 0, devWebhookCount = 0] = counts;
        const knowledgeCount = aiRuntime ? (counts[3] ?? 0) : 0;
        const botDraftCount = aiRuntime ? (counts[4] ?? 0) : 0;
        const mediaOffset = aiRuntime ? 5 : 3;
        const scanCount = counts[mediaOffset] ?? 0;
        const retentionCount = counts[mediaOffset + 1] ?? 0;
        if (
          webhookCount > 0 ||
          outboundCount > 0 ||
          devWebhookCount > 0 ||
          knowledgeCount > 0 ||
          botDraftCount > 0 ||
          scanCount > 0 ||
          retentionCount > 0
        ) {
          logger.info(
            {
              webhookProcessed: webhookCount,
              outboundProcessed: outboundCount,
              devWebhookProcessed: devWebhookCount,
              knowledgeProcessed: knowledgeCount,
              botDraftProcessed: botDraftCount,
              attachmentScanned: scanCount,
              attachmentRetained: retentionCount
            },
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

server.listen(config.PORT, "0.0.0.0", () =>
  logger.info(
    {
      port: config.PORT,
      host: "0.0.0.0",
      claimsJobs: Boolean(dbPool),
      aiProvider: aiRuntime?.providerType ?? "disabled",
      aiEmbeddingModel: aiRuntime?.embeddingModel ?? null
    },
    "worker.started"
  )
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
