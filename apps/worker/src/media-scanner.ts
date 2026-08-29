import { createHash } from "node:crypto";
import {
  type DbClient,
  claimAttachmentScanEvents,
  getAttachmentById,
  markOutboxEventPublished,
  recordOutboxEventFailure,
  runInTenantTransaction,
  updateAttachmentScanResult
} from "@flowdesk/db";
import { validateMediaAttachment } from "@flowdesk/domain";
import type { MalwareScanner, ObjectStore } from "@flowdesk/providers";
import { recordMediaLifecycle } from "@flowdesk/observability";

export interface ScanAttachmentParams {
  organizationId: string;
  attachmentId: string;
}

export interface ScanAttachmentDeps {
  db: DbClient;
  storage: ObjectStore;
  scanner: MalwareScanner;
  logger?: {
    info: (msg: string, ctx?: Record<string, unknown>) => void;
    warn: (msg: string, ctx?: Record<string, unknown>) => void;
    error: (msg: string, ctx?: Record<string, unknown>) => void;
  };
}

export interface ScanAttachmentResult {
  outcome: "clean" | "rejected" | "already_processed" | "not_found";
  attachmentId: string;
  status?: "quarantine" | "clean" | "rejected" | undefined;
  quarantineReason?: string | null | undefined;
  detectedMimeType?: string | null | undefined;
}

/**
 * Scans an attachment in quarantine:
 * 1. Checks storage presence and byte length.
 * 2. Computes and verifies SHA-256 checksum.
 * 3. Inspects header magic-bytes against declared MIME.
 * 4. Executes anti-malware scan via scanner adapter.
 * 5. Fails closed (rejects) on any anomaly; updates to clean on success.
 */
export async function scanQuarantinedAttachment(
  params: ScanAttachmentParams,
  deps: ScanAttachmentDeps
): Promise<ScanAttachmentResult> {
  const { organizationId, attachmentId } = params;
  const { db, storage, scanner, logger } = deps;

  logger?.info("Starting quarantine scan for attachment", { organizationId, attachmentId });

  // 1. Retrieve attachment record
  const attachment = await getAttachmentById(db, organizationId, attachmentId);
  if (!attachment) {
    logger?.warn("Attachment not found for scanning", { organizationId, attachmentId });
    return { outcome: "not_found", attachmentId };
  }

  // Idempotency: skip if already transitioned
  if (attachment.status !== "quarantine") {
    logger?.info("Attachment already processed", {
      organizationId,
      attachmentId,
      status: attachment.status
    });
    return {
      outcome: "already_processed",
      attachmentId,
      status: attachment.status,
      quarantineReason: attachment.quarantineReason
    };
  }

  // 2. Fetch object bytes from storage
  let data: Buffer;
  try {
    const obj = await storage.getObject(attachment.storageKey);
    data = obj.data;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger?.error("Failed to retrieve attachment from storage", {
      organizationId,
      attachmentId,
      error: errorMsg
    });

    await updateAttachmentScanResult(db, {
      organizationId,
      attachmentId,
      status: "rejected",
      quarantineReason: `STORAGE_OBJECT_NOT_FOUND: ${errorMsg}`,
      scannerName: "flowdesk-media-scanner"
    });

    return {
      outcome: "rejected",
      attachmentId,
      status: "rejected",
      quarantineReason: `STORAGE_OBJECT_NOT_FOUND: ${errorMsg}`
    };
  }

  // 3. Size verification
  if (data.length !== attachment.byteSize) {
    const reason = `SIZE_MISMATCH: Declared size was ${attachment.byteSize} bytes, but actual storage object is ${data.length} bytes.`;
    logger?.warn("Attachment rejected due to size mismatch", {
      organizationId,
      attachmentId,
      reason
    });

    await updateAttachmentScanResult(db, {
      organizationId,
      attachmentId,
      status: "rejected",
      quarantineReason: reason,
      scannerName: "flowdesk-media-scanner"
    });

    return {
      outcome: "rejected",
      attachmentId,
      status: "rejected",
      quarantineReason: reason
    };
  }

  // 4. SHA-256 Checksum computation & verification
  const computedHash = createHash("sha256").update(data).digest("hex");
  if (
    attachment.sha256Checksum &&
    attachment.sha256Checksum.toLowerCase() !== computedHash.toLowerCase()
  ) {
    const reason = `CHECKSUM_MISMATCH: Declared checksum '${attachment.sha256Checksum}' did not match computed hash '${computedHash}'.`;
    logger?.warn("Attachment rejected due to checksum mismatch", {
      organizationId,
      attachmentId,
      reason
    });

    await updateAttachmentScanResult(db, {
      organizationId,
      attachmentId,
      status: "rejected",
      sha256Checksum: computedHash,
      quarantineReason: reason,
      scannerName: "flowdesk-media-scanner"
    });

    return {
      outcome: "rejected",
      attachmentId,
      status: "rejected",
      quarantineReason: reason
    };
  }

  // 5. Magic-Byte Validation
  const headerBytes = new Uint8Array(data.buffer, data.byteOffset, Math.min(data.length, 64));
  const validation = validateMediaAttachment(attachment.contentType, headerBytes, data.length);

  if (!validation.valid) {
    const reason = validation.error ?? "MIME_VALIDATION_FAILED";
    logger?.warn("Attachment rejected due to MIME/magic-byte violation", {
      organizationId,
      attachmentId,
      reason,
      detectedMime: validation.detectedMime
    });

    await updateAttachmentScanResult(db, {
      organizationId,
      attachmentId,
      status: "rejected",
      detectedMimeType: validation.detectedMime ?? undefined,
      sha256Checksum: computedHash,
      quarantineReason: reason,
      scannerName: "flowdesk-media-scanner"
    });

    return {
      outcome: "rejected",
      attachmentId,
      status: "rejected",
      quarantineReason: reason,
      detectedMimeType: validation.detectedMime
    };
  }

  // 6. Anti-malware scan
  const scanResult = await scanner.scan(data);
  if (!scanResult.isClean) {
    const reason = `MALWARE_DETECTED: Threat '${scanResult.threatName ?? "Unknown"}' detected by ${scanResult.scannerVersion}.`;
    logger?.error("Malware detected in quarantined attachment", {
      organizationId,
      attachmentId,
      threatName: scanResult.threatName,
      scannerVersion: scanResult.scannerVersion
    });

    await updateAttachmentScanResult(db, {
      organizationId,
      attachmentId,
      status: "rejected",
      detectedMimeType: validation.detectedMime ?? undefined,
      sha256Checksum: computedHash,
      quarantineReason: reason,
      scannerName: scanResult.scannerVersion,
      scanMetadata: { threatName: scanResult.threatName }
    });

    return {
      outcome: "rejected",
      attachmentId,
      status: "rejected",
      quarantineReason: reason,
      detectedMimeType: validation.detectedMime
    };
  }

  // 7. Success - transition to clean
  logger?.info("Attachment passed all quarantine checks; transitioning to clean", {
    organizationId,
    attachmentId,
    detectedMime: validation.detectedMime
  });

  await updateAttachmentScanResult(db, {
    organizationId,
    attachmentId,
    status: "clean",
    detectedMimeType: validation.detectedMime ?? undefined,
    sha256Checksum: computedHash,
    quarantineReason: null,
    scannerName: scanResult.scannerVersion
  });

  return {
    outcome: "clean",
    attachmentId,
    status: "clean",
    detectedMimeType: validation.detectedMime
  };
}

export async function processAttachmentScanBatch(
  client: DbClient,
  deps: Omit<ScanAttachmentDeps, "db">,
  batchSize = 10
): Promise<number> {
  const events = await claimAttachmentScanEvents(client, batchSize);
  for (const event of events) {
    await runInTenantTransaction(client, { organizationId: event.organizationId }, async (db) => {
      try {
        const result = await scanQuarantinedAttachment(
          { organizationId: event.organizationId, attachmentId: event.payload.attachmentId },
          { ...deps, db }
        );
        recordMediaLifecycle("scan", result.outcome);
        await markOutboxEventPublished(db, event.id);
        return result;
      } catch (error) {
        recordMediaLifecycle("scan", "failed");
        await recordOutboxEventFailure(
          db,
          event.id,
          error instanceof Error ? error.message : String(error),
          event.attempts >= 4
        );
      }
    });
  }
  return events.length;
}
