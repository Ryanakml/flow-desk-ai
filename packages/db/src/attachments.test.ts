import { describe, expect, it } from "vitest";
import type { DbClient } from "./auth.js";
import {
  createAttachmentUploadSession,
  completeAttachmentUploadSession,
  updateAttachmentScanResult,
  type AttachmentRecord,
  type AttachmentUploadSessionRecord
} from "./attachments.js";

function createMockAttachmentsDb() {
  const attachments = new Map<string, AttachmentRecord>();
  const sessions = new Map<string, AttachmentUploadSessionRecord>();
  const outboxEvents: Array<{
    organizationId: string;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }> = [];

  const db = {
    query: async (sql: string, values: unknown[] = []) => {
      await Promise.resolve();
      // INSERT INTO flowdesk.attachments
      if (sql.includes("INSERT INTO flowdesk.attachments")) {
        const id = `att-${attachments.size + 1}`;
        const record: AttachmentRecord = {
          id,
          organizationId: values[0] as string,
          uploaderUserId: (values[1] as string | null) ?? null,
          fileName: values[2] as string,
          contentType: values[3] as string,
          detectedMimeType: null,
          byteSize: Number(values[4]),
          sha256Checksum: (values[5] as string | null) ?? null,
          storageKey: values[6] as string,
          status: "quarantine",
          quarantineReason: null,
          scannedAt: null,
          scannerName: null,
          scanMetadata: {},
          metadata: JSON.parse((values[7] as string) || "{}") as Record<string, unknown>,
          deletedAt: null,
          deletionReason: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        attachments.set(id, record);
        return {
          rows: [{ ...record, byteSize: String(record.byteSize) }],
          rowCount: 1,
          command: "INSERT",
          oid: 0,
          fields: []
        };
      }

      // INSERT INTO flowdesk.attachment_upload_sessions
      if (sql.includes("INSERT INTO flowdesk.attachment_upload_sessions")) {
        const id = `sess-${sessions.size + 1}`;
        const record: AttachmentUploadSessionRecord = {
          id,
          organizationId: values[0] as string,
          attachmentId: values[1] as string,
          uploaderUserId: (values[2] as string | null) ?? null,
          uploadUrl: values[3] as string,
          expiresAt: values[4] as Date,
          completedAt: null,
          createdAt: new Date()
        };
        sessions.set(id, record);
        return {
          rows: [record],
          rowCount: 1,
          command: "INSERT",
          oid: 0,
          fields: []
        };
      }

      // SELECT FROM flowdesk.attachments
      if (
        sql.includes("FROM flowdesk.attachments") &&
        sql.includes("organization_id = $1 AND id = $2")
      ) {
        const [orgId, id] = values as [string, string];
        const record = attachments.get(id);
        if (record && record.organizationId === orgId) {
          return {
            rows: [{ ...record, byteSize: String(record.byteSize) }],
            rowCount: 1,
            command: "SELECT",
            oid: 0,
            fields: []
          };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      // SELECT FROM flowdesk.attachment_upload_sessions
      if (
        sql.includes("FROM flowdesk.attachment_upload_sessions") &&
        sql.includes("organization_id = $1 AND id = $2")
      ) {
        const [orgId, id] = values as [string, string];
        const record = sessions.get(id);
        if (record && record.organizationId === orgId) {
          return {
            rows: [record],
            rowCount: 1,
            command: "SELECT",
            oid: 0,
            fields: []
          };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      // UPDATE attachment_upload_sessions
      if (sql.includes("UPDATE flowdesk.attachment_upload_sessions")) {
        const [now, orgId, attId] = values as [Date, string, string];
        let updated = 0;
        for (const s of sessions.values()) {
          if (s.organizationId === orgId && s.attachmentId === attId && !s.completedAt) {
            s.completedAt = now;
            updated += 1;
          }
        }
        return { rows: [], rowCount: updated, command: "UPDATE", oid: 0, fields: [] };
      }

      // UPDATE attachments SET sha256_checksum
      if (sql.includes("SET sha256_checksum = $1")) {
        const [checksum, now, orgId, attId] = values as [string, Date, string, string];
        const att = attachments.get(attId);
        if (att && att.organizationId === orgId) {
          att.sha256Checksum = checksum;
          att.updatedAt = now;
        }
        return { rows: [], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
      }

      // UPDATE flowdesk.attachments SET status = $1 (Scan result)
      if (sql.includes("SET status = $1")) {
        const [
          status,
          detectedMime,
          checksum,
          quarantineReason,
          now,
          scannerName,
          scanMetadataStr,
          orgId,
          attId
        ] = values as [
          "clean" | "rejected",
          string | null,
          string | null,
          string | null,
          Date,
          string,
          string,
          string,
          string
        ];

        const att = attachments.get(attId);
        if (att && att.organizationId === orgId) {
          att.status = status;
          if (detectedMime) att.detectedMimeType = detectedMime;
          if (checksum) att.sha256Checksum = checksum;
          att.quarantineReason = quarantineReason;
          att.scannedAt = now;
          att.scannerName = scannerName;
          att.scanMetadata = JSON.parse(scanMetadataStr) as Record<string, unknown>;
          att.updatedAt = now;
          return {
            rows: [{ ...att, byteSize: String(att.byteSize) }],
            rowCount: 1,
            command: "UPDATE",
            oid: 0,
            fields: []
          };
        }
        return { rows: [], rowCount: 0, command: "UPDATE", oid: 0, fields: [] };
      }

      // INSERT INTO flowdesk.outbox_events
      if (sql.includes("INSERT INTO flowdesk.outbox_events")) {
        let eventType = "";
        let payloadStr = "";
        let aggregateId = "";
        if (values.length === 3) {
          aggregateId = values[1] as string;
          eventType = "attachment.uploaded";
          payloadStr = values[2] as string;
        } else if (values.length >= 4) {
          aggregateId = values[1] as string;
          eventType = values[2] as string;
          payloadStr = values[3] as string;
        }
        outboxEvents.push({
          organizationId: values[0] as string,
          aggregateType: "attachment",
          aggregateId,
          eventType,
          payload: JSON.parse(payloadStr) as Record<string, unknown>
        });
        return { rows: [], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
    }
  } as unknown as DbClient;

  return { db, attachments, sessions, outboxEvents };
}

describe("Attachments & Quarantine Storage DB (M3-06)", () => {
  const orgId = "00000000-0000-7000-8000-000000000001";
  const userId = "00000000-0000-7000-8000-000000000002";

  it("creates attachment in quarantine status and initiates upload session", async () => {
    const { db } = createMockAttachmentsDb();

    const result = await createAttachmentUploadSession(db, {
      organizationId: orgId,
      uploaderUserId: userId,
      fileName: "invoice.pdf",
      contentType: "application/pdf",
      byteSize: 1024 * 1024,
      storageKey: `org-${orgId}/quarantine/att-1/token123`,
      uploadUrl: "https://s3.local/bucket/org-1/invoice.pdf?signed=1",
      expiresAt: new Date(Date.now() + 900000)
    });

    expect(result.attachment.id).toBe("att-1");
    expect(result.attachment.status).toBe("quarantine");
    expect(result.attachment.fileName).toBe("invoice.pdf");
    expect(result.attachment.byteSize).toBe(1024 * 1024);
    expect(result.uploadSession.uploadUrl).toContain("signed=1");
  });

  it("completes upload session and enqueues attachment.uploaded outbox event", async () => {
    const { db, outboxEvents } = createMockAttachmentsDb();

    await createAttachmentUploadSession(db, {
      organizationId: orgId,
      uploaderUserId: userId,
      fileName: "photo.jpg",
      contentType: "image/jpeg",
      byteSize: 50000,
      storageKey: `org-${orgId}/quarantine/att-1/token123`,
      uploadUrl: "https://s3.local/bucket/org-1/photo.jpg?signed=1",
      expiresAt: new Date(Date.now() + 900000)
    });

    const updated = await completeAttachmentUploadSession(
      db,
      orgId,
      "att-1",
      "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
    );

    expect(updated?.sha256Checksum).toBe(
      "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
    );
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]?.eventType).toBe("attachment.uploaded");
    expect(outboxEvents[0]?.aggregateId).toBe("att-1");

    await completeAttachmentUploadSession(db, orgId, "att-1");
    expect(outboxEvents).toHaveLength(1);
  });

  it("updates scan result to clean when verified", async () => {
    const { db, outboxEvents } = createMockAttachmentsDb();

    await createAttachmentUploadSession(db, {
      organizationId: orgId,
      uploaderUserId: userId,
      fileName: "clean.png",
      contentType: "image/png",
      byteSize: 12000,
      storageKey: `org-${orgId}/quarantine/att-1/token123`,
      uploadUrl: "https://s3.local/bucket/org-1/clean.png?signed=1",
      expiresAt: new Date(Date.now() + 900000)
    });

    const cleanResult = await updateAttachmentScanResult(db, {
      organizationId: orgId,
      attachmentId: "att-1",
      status: "clean",
      detectedMimeType: "image/png",
      scannerName: "clamav-fake-1.0",
      scanMetadata: { signaturesChecked: 1000 }
    });

    expect(cleanResult?.status).toBe("clean");
    expect(cleanResult?.detectedMimeType).toBe("image/png");
    expect(cleanResult?.scannedAt).toBeInstanceOf(Date);
    expect(cleanResult?.quarantineReason).toBeNull();

    const lastOutbox = outboxEvents[outboxEvents.length - 1];
    expect(lastOutbox?.eventType).toBe("attachment.clean");
  });

  it("updates scan result to rejected with reason when threat or spoof detected", async () => {
    const { db, outboxEvents } = createMockAttachmentsDb();

    await createAttachmentUploadSession(db, {
      organizationId: orgId,
      uploaderUserId: userId,
      fileName: "malware.exe",
      contentType: "image/jpeg",
      byteSize: 12000,
      storageKey: `org-${orgId}/quarantine/att-1/token123`,
      uploadUrl: "https://s3.local/bucket/org-1/malware.exe?signed=1",
      expiresAt: new Date(Date.now() + 900000)
    });

    const rejectedResult = await updateAttachmentScanResult(db, {
      organizationId: orgId,
      attachmentId: "att-1",
      status: "rejected",
      detectedMimeType: "application/x-dosexec",
      quarantineReason: "MIME_SPOOFED: Expected image/jpeg but detected application/x-dosexec",
      scannerName: "clamav-fake-1.0"
    });

    expect(rejectedResult?.status).toBe("rejected");
    expect(rejectedResult?.quarantineReason).toContain("MIME_SPOOFED");

    const lastOutbox = outboxEvents[outboxEvents.length - 1];
    expect(lastOutbox?.eventType).toBe("attachment.rejected");
  });
});
