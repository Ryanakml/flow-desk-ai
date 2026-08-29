import {
  type DbClient,
  listAttachmentRetentionCandidates,
  listExpiredAttachments,
  runInTenantTransaction,
  softDeleteAttachment
} from "@flowdesk/db";
import type { ObjectStore } from "@flowdesk/providers";
import { recordMediaLifecycle } from "@flowdesk/observability";

/** Default retention periods in days */
const DEFAULT_CLEAN_RETENTION_DAYS = 90;
const DEFAULT_REJECTED_RETENTION_DAYS = 7;

export interface RetentionConfig {
  /** Days before a clean attachment is expired (default: 90) */
  cleanRetentionDays?: number | undefined;
  /** Days before a rejected attachment is expired (default: 7) */
  rejectedRetentionDays?: number | undefined;
}

export interface RunRetentionJobParams {
  /** Organization ID to run expiry for */
  organizationId: string;
  config?: RetentionConfig | undefined;
}

export interface RetentionJobDeps {
  db: DbClient;
  storage: ObjectStore;
  logger?: {
    info: (msg: string, ctx?: Record<string, unknown>) => void;
    warn: (msg: string, ctx?: Record<string, unknown>) => void;
    error: (msg: string, ctx?: Record<string, unknown>) => void;
  };
}

export interface RetentionJobResult {
  processed: number;
  deleted: number;
  errors: number;
}

/**
 * Expires attachments that have exceeded their retention window.
 *
 * - Fetches up to 100 non-deleted attachments older than the cutoff date.
 * - For each: deletes the storage object, then soft-deletes the DB record.
 * - Idempotent: already-deleted attachments are skipped by `listExpiredAttachments`.
 * - Storage deletion is attempted first; if it fails the DB record is NOT tombstoned
 *   (fail-safe: prevents serving a deleted attachment URL).
 * - cleanRetentionDays defaults to 90; rejectedRetentionDays defaults to 7.
 */
export async function runRetentionJob(
  params: RunRetentionJobParams,
  deps: RetentionJobDeps
): Promise<RetentionJobResult> {
  const { organizationId, config } = params;
  const { db, storage, logger } = deps;

  const cleanDays = config?.cleanRetentionDays ?? DEFAULT_CLEAN_RETENTION_DAYS;
  const rejectedDays = config?.rejectedRetentionDays ?? DEFAULT_REJECTED_RETENTION_DAYS;

  // Use the smaller of the two retention windows for the DB query cutoff,
  // then filter per status in-process.
  const shortestWindowMs = Math.min(cleanDays, rejectedDays) * 24 * 60 * 60 * 1000;
  const olderThan = new Date(Date.now() - shortestWindowMs);

  logger?.info("retention: starting expiry job", {
    organizationId,
    cleanDays,
    rejectedDays,
    olderThan: olderThan.toISOString()
  });

  const candidates = await listExpiredAttachments(db, organizationId, olderThan);

  logger?.info("retention: found candidates", { organizationId, count: candidates.length });

  let deleted = 0;
  let errors = 0;

  for (const candidate of candidates) {
    const retentionDays = candidate.status === "rejected" ? rejectedDays : cleanDays;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    if (candidate.createdAt >= cutoff) {
      // This candidate hasn't reached its own retention window yet
      continue;
    }

    try {
      // 1. Delete object bytes from storage (fail-safe: do this before tombstoning)
      await storage.deleteObject(candidate.storageKey);

      // 2. Soft-delete DB record with audit trail
      await softDeleteAttachment(db, {
        organizationId,
        attachmentId: candidate.id,
        deletionReason: "retention_expiry"
      });

      logger?.info("retention: expired attachment", {
        organizationId,
        attachmentId: candidate.id,
        status: candidate.status,
        storageKey: candidate.storageKey
      });

      deleted++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger?.error("retention: failed to expire attachment", {
        organizationId,
        attachmentId: candidate.id,
        error: msg
      });
      errors++;
    }
  }

  logger?.info("retention: job complete", {
    organizationId,
    processed: candidates.length,
    deleted,
    errors
  });

  return { processed: candidates.length, deleted, errors };
}

export async function processAttachmentRetentionBatch(
  client: DbClient,
  deps: Omit<RetentionJobDeps, "db">,
  config: RetentionConfig = {},
  batchSize = 100
): Promise<RetentionJobResult> {
  const cleanDays = config.cleanRetentionDays ?? DEFAULT_CLEAN_RETENTION_DAYS;
  const rejectedDays = config.rejectedRetentionDays ?? DEFAULT_REJECTED_RETENTION_DAYS;
  const candidates = await listAttachmentRetentionCandidates(
    client,
    new Date(Date.now() - cleanDays * 86_400_000),
    new Date(Date.now() - rejectedDays * 86_400_000),
    batchSize
  );
  let deleted = 0;
  let errors = 0;
  for (const candidate of candidates) {
    try {
      await deps.storage.deleteObject(candidate.storageKey);
      const tombstone = await runInTenantTransaction(
        client,
        { organizationId: candidate.organizationId },
        async (db) => {
          return softDeleteAttachment(db, {
            organizationId: candidate.organizationId,
            attachmentId: candidate.id,
            deletionReason: "retention_expiry"
          });
        }
      );
      if (tombstone) {
        deleted += 1;
        recordMediaLifecycle("retention", "deleted");
      } else {
        recordMediaLifecycle("retention", "already_deleted");
      }
    } catch (error) {
      errors += 1;
      recordMediaLifecycle("retention", "failed");
      deps.logger?.error("retention: failed to expire attachment", {
        organizationId: candidate.organizationId,
        attachmentId: candidate.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { processed: candidates.length, deleted, errors };
}
