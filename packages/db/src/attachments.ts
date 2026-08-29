import type { DbClient } from "./auth.js";
import type { ClaimedOutboxEvent } from "./conversations.js";

export type AttachmentStatus = "quarantine" | "clean" | "rejected";

export interface AttachmentRecord {
  id: string;
  organizationId: string;
  uploaderUserId: string | null;
  fileName: string;
  contentType: string;
  detectedMimeType: string | null;
  byteSize: number;
  sha256Checksum: string | null;
  storageKey: string;
  status: AttachmentStatus;
  quarantineReason: string | null;
  scannedAt: Date | null;
  scannerName: string | null;
  scanMetadata: Record<string, unknown>;
  metadata: Record<string, unknown>;
  deletedAt: Date | null;
  deletionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AttachmentUploadSessionRecord {
  id: string;
  organizationId: string;
  attachmentId: string;
  uploaderUserId: string | null;
  uploadUrl: string;
  expiresAt: Date;
  completedAt: Date | null;
  createdAt: Date;
}

export interface CreateAttachmentUploadSessionInput {
  organizationId: string;
  uploaderUserId: string | null;
  fileName: string;
  contentType: string;
  byteSize: number;
  sha256Checksum?: string | null | undefined;
  storageKey: string;
  uploadUrl: string;
  expiresAt: Date;
  metadata?: Record<string, unknown> | undefined;
}

export async function createAttachmentUploadSession(
  client: DbClient,
  input: CreateAttachmentUploadSessionInput
): Promise<{ attachment: AttachmentRecord; uploadSession: AttachmentUploadSessionRecord }> {
  // 1. Insert attachment in 'quarantine' status
  const attachmentRes = await client.query(
    `INSERT INTO flowdesk.attachments
       (organization_id, uploader_user_id, file_name, content_type, byte_size, sha256_checksum, storage_key, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'quarantine', $8)
     RETURNING
       id, organization_id AS "organizationId", uploader_user_id AS "uploaderUserId",
       file_name AS "fileName", content_type AS "contentType", detected_mime_type AS "detectedMimeType",
       byte_size::text AS "byteSize", sha256_checksum AS "sha256Checksum", storage_key AS "storageKey",
       status, quarantine_reason AS "quarantineReason", scanned_at AS "scannedAt",
       scanner_name AS "scannerName", scan_metadata AS "scanMetadata", metadata,
       deleted_at AS "deletedAt", deletion_reason AS "deletionReason",
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      input.organizationId,
      input.uploaderUserId,
      input.fileName,
      input.contentType,
      input.byteSize,
      input.sha256Checksum ?? null,
      input.storageKey,
      JSON.stringify(input.metadata ?? {})
    ]
  );

  const row = attachmentRes.rows[0] as Omit<AttachmentRecord, "byteSize"> & { byteSize: string };
  const attachment: AttachmentRecord = {
    ...row,
    byteSize: Number(row.byteSize)
  };

  // 2. Insert upload session
  const sessionRes = await client.query(
    `INSERT INTO flowdesk.attachment_upload_sessions
       (organization_id, attachment_id, uploader_user_id, upload_url, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING
       id, organization_id AS "organizationId", attachment_id AS "attachmentId",
       uploader_user_id AS "uploaderUserId", upload_url AS "uploadUrl",
       expires_at AS "expiresAt", completed_at AS "completedAt", created_at AS "createdAt"`,
    [input.organizationId, attachment.id, input.uploaderUserId, input.uploadUrl, input.expiresAt]
  );

  const uploadSession = sessionRes.rows[0] as AttachmentUploadSessionRecord;

  return { attachment, uploadSession };
}

export async function getAttachmentById(
  client: DbClient,
  orgId: string,
  id: string
): Promise<AttachmentRecord | null> {
  const res = await client.query(
    `SELECT
       id, organization_id AS "organizationId", uploader_user_id AS "uploaderUserId",
       file_name AS "fileName", content_type AS "contentType", detected_mime_type AS "detectedMimeType",
       byte_size::text AS "byteSize", sha256_checksum AS "sha256Checksum", storage_key AS "storageKey",
       status, quarantine_reason AS "quarantineReason", scanned_at AS "scannedAt",
       scanner_name AS "scannerName", scan_metadata AS "scanMetadata", metadata,
       deleted_at AS "deletedAt", deletion_reason AS "deletionReason",
       created_at AS "createdAt", updated_at AS "updatedAt"
     FROM flowdesk.attachments
     WHERE organization_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [orgId, id]
  );

  if (res.rows.length === 0) return null;
  const row = res.rows[0] as Omit<AttachmentRecord, "byteSize"> & { byteSize: string };
  return {
    ...row,
    byteSize: Number(row.byteSize)
  };
}

export async function getUploadSessionById(
  client: DbClient,
  orgId: string,
  id: string
): Promise<AttachmentUploadSessionRecord | null> {
  const res = await client.query(
    `SELECT
       id, organization_id AS "organizationId", attachment_id AS "attachmentId",
       uploader_user_id AS "uploaderUserId", upload_url AS "uploadUrl",
       expires_at AS "expiresAt", completed_at AS "completedAt", created_at AS "createdAt"
     FROM flowdesk.attachment_upload_sessions
     WHERE organization_id = $1 AND id = $2`,
    [orgId, id]
  );

  if (res.rows.length === 0) return null;
  return res.rows[0] as AttachmentUploadSessionRecord;
}

export async function completeAttachmentUploadSession(
  client: DbClient,
  orgId: string,
  attachmentId: string,
  sha256Checksum?: string | null
): Promise<AttachmentRecord | null> {
  const now = new Date();

  // Mark session completed
  const completed = await client.query(
    `UPDATE flowdesk.attachment_upload_sessions
     SET completed_at = $1
     WHERE organization_id = $2 AND attachment_id = $3 AND completed_at IS NULL`,
    [now, orgId, attachmentId]
  );

  if ((completed.rowCount ?? 0) === 0) {
    return getAttachmentById(client, orgId, attachmentId);
  }

  // Update checksum if supplied
  if (sha256Checksum) {
    await client.query(
      `UPDATE flowdesk.attachments
       SET sha256_checksum = $1, updated_at = $2
       WHERE organization_id = $3 AND id = $4`,
      [sha256Checksum, now, orgId, attachmentId]
    );
  }

  // Record outbox event for scanning
  await client.query(
    `INSERT INTO flowdesk.outbox_events
       (organization_id, aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1, 'attachment', $2, 'attachment.uploaded', $3)`,
    [
      orgId,
      attachmentId,
      JSON.stringify({
        attachmentId,
        organizationId: orgId,
        uploadedAt: now.toISOString()
      })
    ]
  );

  return getAttachmentById(client, orgId, attachmentId);
}

export interface UpdateAttachmentScanResultInput {
  organizationId: string;
  attachmentId: string;
  status: "clean" | "rejected";
  detectedMimeType?: string | null | undefined;
  sha256Checksum?: string | null | undefined;
  quarantineReason?: string | null | undefined;
  scannerName: string;
  scanMetadata?: Record<string, unknown> | undefined;
}

export async function updateAttachmentScanResult(
  client: DbClient,
  input: UpdateAttachmentScanResultInput
): Promise<AttachmentRecord | null> {
  const now = new Date();

  const res = await client.query(
    `UPDATE flowdesk.attachments
     SET status = $1,
         detected_mime_type = COALESCE($2, detected_mime_type),
         sha256_checksum = COALESCE($3, sha256_checksum),
         quarantine_reason = $4,
         scanned_at = $5,
         scanner_name = $6,
         scan_metadata = $7,
         updated_at = $5
     WHERE organization_id = $8 AND id = $9
     RETURNING
       id, organization_id AS "organizationId", uploader_user_id AS "uploaderUserId",
       file_name AS "fileName", content_type AS "contentType", detected_mime_type AS "detectedMimeType",
       byte_size::text AS "byteSize", sha256_checksum AS "sha256Checksum", storage_key AS "storageKey",
       status, quarantine_reason AS "quarantineReason", scanned_at AS "scannedAt",
       scanner_name AS "scannerName", scan_metadata AS "scanMetadata", metadata,
       deleted_at AS "deletedAt", deletion_reason AS "deletionReason",
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      input.status,
      input.detectedMimeType ?? null,
      input.sha256Checksum ?? null,
      input.quarantineReason ?? null,
      now,
      input.scannerName,
      JSON.stringify(input.scanMetadata ?? {}),
      input.organizationId,
      input.attachmentId
    ]
  );

  if (res.rows.length === 0) return null;
  const row = res.rows[0] as Omit<AttachmentRecord, "byteSize"> & { byteSize: string };
  const updated = {
    ...row,
    byteSize: Number(row.byteSize)
  };

  // Record audit outbox event
  await client.query(
    `INSERT INTO flowdesk.outbox_events
       (organization_id, aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1, 'attachment', $2, $3, $4)`,
    [
      input.organizationId,
      input.attachmentId,
      input.status === "clean" ? "attachment.clean" : "attachment.rejected",
      JSON.stringify({
        attachmentId: input.attachmentId,
        status: input.status,
        quarantineReason: input.quarantineReason ?? null,
        scannedAt: now.toISOString(),
        scannerName: input.scannerName
      })
    ]
  );

  return updated;
}

export interface SoftDeleteAttachmentInput {
  organizationId: string;
  attachmentId: string;
  deletionReason: string;
}

export async function softDeleteAttachment(
  client: DbClient,
  input: SoftDeleteAttachmentInput
): Promise<AttachmentRecord | null> {
  const now = new Date();

  const res = await client.query(
    `UPDATE flowdesk.attachments
     SET deleted_at = $1,
         deletion_reason = $2,
         updated_at = $1
     WHERE organization_id = $3 AND id = $4 AND deleted_at IS NULL
     RETURNING
       id, organization_id AS "organizationId", uploader_user_id AS "uploaderUserId",
       file_name AS "fileName", content_type AS "contentType", detected_mime_type AS "detectedMimeType",
       byte_size::text AS "byteSize", sha256_checksum AS "sha256Checksum", storage_key AS "storageKey",
       status, quarantine_reason AS "quarantineReason", scanned_at AS "scannedAt",
       scanner_name AS "scannerName", scan_metadata AS "scanMetadata", metadata,
       deleted_at AS "deletedAt", deletion_reason AS "deletionReason",
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    [now, input.deletionReason, input.organizationId, input.attachmentId]
  );

  if (res.rows.length === 0) return null;
  const row = res.rows[0] as Omit<AttachmentRecord, "byteSize"> & { byteSize: string };
  const deleted = { ...row, byteSize: Number(row.byteSize) };

  // Record audit outbox event
  await client.query(
    `INSERT INTO flowdesk.outbox_events
       (organization_id, aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1, 'attachment', $2, 'attachment.deleted', $3)`,
    [
      input.organizationId,
      input.attachmentId,
      JSON.stringify({
        attachmentId: input.attachmentId,
        deletionReason: input.deletionReason,
        deletedAt: now.toISOString()
      })
    ]
  );

  return deleted;
}

export interface ExpiredAttachmentRow {
  id: string;
  organizationId: string;
  storageKey: string;
  status: AttachmentStatus;
  createdAt: Date;
}

export async function listExpiredAttachments(
  client: DbClient,
  orgId: string,
  olderThan: Date
): Promise<ExpiredAttachmentRow[]> {
  const res = await client.query<{
    id: string;
    organizationId: string;
    storageKey: string;
    status: string;
    createdAt: Date;
  }>(
    `SELECT
       id, organization_id AS "organizationId", storage_key AS "storageKey",
       status, created_at AS "createdAt"
     FROM flowdesk.attachments
     WHERE organization_id = $1
       AND deleted_at IS NULL
       AND created_at < $2
     ORDER BY created_at ASC
     LIMIT 100`,
    [orgId, olderThan]
  );

  return res.rows.map((r) => ({ ...r, status: r.status as AttachmentStatus }));
}

export async function listAttachmentRetentionCandidates(
  client: DbClient,
  cleanBefore: Date,
  rejectedBefore: Date,
  limit = 100
): Promise<ExpiredAttachmentRow[]> {
  const result = await client.query<{
    id: string;
    organization_id: string;
    storage_key: string;
    status: AttachmentStatus;
    created_at: Date;
  }>(
    `SELECT * FROM flowdesk.list_attachment_retention_candidates($1::timestamptz, $2::timestamptz, $3::integer)`,
    [cleanBefore, rejectedBefore, limit]
  );
  return result.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    storageKey: row.storage_key,
    status: row.status,
    createdAt: row.created_at
  }));
}

export async function claimAttachmentScanEvents(
  client: DbClient,
  limit = 10
): Promise<ClaimedOutboxEvent<{ attachmentId: string }>[]> {
  const result = await client.query<{
    id: string;
    organization_id: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    payload: { attachmentId: string };
    correlation_id: string | null;
    causation_id: string | null;
    occurred_at: Date;
    attempts: number;
  }>(`SELECT * FROM flowdesk.claim_attachment_scan_events($1::integer)`, [limit]);
  return result.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    payload: row.payload,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    occurredAt: row.occurred_at,
    attempts: row.attempts
  }));
}
