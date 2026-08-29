import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { DbClient, AttachmentRecord } from "@flowdesk/db";
import { FakeMalwareScanner, InMemoryObjectStore, EICAR_TEST_SIGNATURE } from "@flowdesk/providers";
import { scanQuarantinedAttachment } from "./media-scanner.js";

function createMockWorkerDb(initialAttachment?: AttachmentRecord) {
  const attachment: AttachmentRecord | null = initialAttachment ?? null;
  const scanUpdates: Array<{
    status: "clean" | "rejected";
    quarantineReason?: string | null | undefined;
    detectedMimeType?: string | null | undefined;
  }> = [];

  const db = {
    query: async (sql: string, values: unknown[] = []) => {
      await Promise.resolve();
      // SELECT FROM flowdesk.attachments
      if (
        sql.includes("FROM flowdesk.attachments") &&
        sql.includes("organization_id = $1 AND id = $2")
      ) {
        if (!attachment) {
          return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
        }
        return {
          rows: [{ ...attachment, byteSize: String(attachment.byteSize) }],
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }

      // UPDATE flowdesk.attachments SET status = $1
      if (sql.includes("SET status = $1")) {
        const [status, detectedMime, checksum, quarantineReason, now, scannerName] = values as [
          "clean" | "rejected",
          string | null,
          string | null,
          string | null,
          Date,
          string
        ];

        if (attachment) {
          attachment.status = status;
          if (detectedMime) attachment.detectedMimeType = detectedMime;
          if (checksum) attachment.sha256Checksum = checksum;
          attachment.quarantineReason = quarantineReason;
          attachment.scannedAt = now;
          attachment.scannerName = scannerName;
          attachment.updatedAt = now;
        }

        scanUpdates.push({
          status,
          quarantineReason,
          detectedMimeType: detectedMime
        });

        return {
          rows: attachment ? [{ ...attachment, byteSize: String(attachment.byteSize) }] : [],
          rowCount: 1,
          command: "UPDATE",
          oid: 0,
          fields: []
        };
      }

      // INSERT INTO flowdesk.outbox_events
      if (sql.includes("INSERT INTO flowdesk.outbox_events")) {
        return { rows: [], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
    }
  } as unknown as DbClient;

  return { db, getAttachment: () => attachment, scanUpdates };
}

describe("Media Quarantine Scanner Worker (M3-06)", () => {
  const orgId = "00000000-0000-7000-8000-000000000001";
  const attId = "00000000-0000-7000-8000-000000000002";
  const storageKey = `org-${orgId}/quarantine/${attId}/token-123`;

  const validJpegBytes = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01
  ]);
  const validJpegHash = createHash("sha256").update(validJpegBytes).digest("hex");

  it("transitions clean attachment to clean status after passing all checks", async () => {
    const initial: AttachmentRecord = {
      id: attId,
      organizationId: orgId,
      uploaderUserId: null,
      fileName: "photo.jpg",
      contentType: "image/jpeg",
      detectedMimeType: null,
      byteSize: validJpegBytes.length,
      sha256Checksum: validJpegHash,
      storageKey,
      status: "quarantine",
      quarantineReason: null,
      scannedAt: null,
      scannerName: null,
      scanMetadata: {},
      metadata: {},
      createdAt: new Date(),
      deletedAt: null,
      deletionReason: null,
      updatedAt: new Date()
    };

    const { db, getAttachment } = createMockWorkerDb(initial);
    const storage = new InMemoryObjectStore();
    await storage.putObject(storageKey, validJpegBytes, "image/jpeg");
    const scanner = new FakeMalwareScanner();

    const result = await scanQuarantinedAttachment(
      { organizationId: orgId, attachmentId: attId },
      { db, storage, scanner }
    );

    expect(result.outcome).toBe("clean");
    expect(result.status).toBe("clean");
    expect(result.detectedMimeType).toBe("image/jpeg");

    const updated = getAttachment();
    expect(updated?.status).toBe("clean");
    expect(updated?.detectedMimeType).toBe("image/jpeg");
    expect(updated?.quarantineReason).toBeNull();
  });

  it("rejects attachment if object is missing from storage", async () => {
    const initial: AttachmentRecord = {
      id: attId,
      organizationId: orgId,
      uploaderUserId: null,
      fileName: "missing.jpg",
      contentType: "image/jpeg",
      detectedMimeType: null,
      byteSize: 1000,
      sha256Checksum: null,
      storageKey,
      status: "quarantine",
      quarantineReason: null,
      scannedAt: null,
      scannerName: null,
      scanMetadata: {},
      metadata: {},
      createdAt: new Date(),
      deletedAt: null,
      deletionReason: null,
      updatedAt: new Date()
    };

    const { db, getAttachment } = createMockWorkerDb(initial);
    const storage = new InMemoryObjectStore(); // empty
    const scanner = new FakeMalwareScanner();

    const result = await scanQuarantinedAttachment(
      { organizationId: orgId, attachmentId: attId },
      { db, storage, scanner }
    );

    expect(result.outcome).toBe("rejected");
    expect(result.quarantineReason).toContain("STORAGE_OBJECT_NOT_FOUND");
    expect(getAttachment()?.status).toBe("rejected");
  });

  it("rejects attachment if actual byte size does not match declared size", async () => {
    const initial: AttachmentRecord = {
      id: attId,
      organizationId: orgId,
      uploaderUserId: null,
      fileName: "photo.jpg",
      contentType: "image/jpeg",
      detectedMimeType: null,
      byteSize: 99999, // Mismatched
      sha256Checksum: null,
      storageKey,
      status: "quarantine",
      quarantineReason: null,
      scannedAt: null,
      scannerName: null,
      scanMetadata: {},
      metadata: {},
      createdAt: new Date(),
      deletedAt: null,
      deletionReason: null,
      updatedAt: new Date()
    };

    const { db, getAttachment } = createMockWorkerDb(initial);
    const storage = new InMemoryObjectStore();
    await storage.putObject(storageKey, validJpegBytes, "image/jpeg");
    const scanner = new FakeMalwareScanner();

    const result = await scanQuarantinedAttachment(
      { organizationId: orgId, attachmentId: attId },
      { db, storage, scanner }
    );

    expect(result.outcome).toBe("rejected");
    expect(result.quarantineReason).toContain("SIZE_MISMATCH");
    expect(getAttachment()?.status).toBe("rejected");
  });

  it("rejects attachment if checksum does not match declared hash", async () => {
    const initial: AttachmentRecord = {
      id: attId,
      organizationId: orgId,
      uploaderUserId: null,
      fileName: "photo.jpg",
      contentType: "image/jpeg",
      detectedMimeType: null,
      byteSize: validJpegBytes.length,
      sha256Checksum: "0".repeat(64), // Incorrect checksum
      storageKey,
      status: "quarantine",
      quarantineReason: null,
      scannedAt: null,
      scannerName: null,
      scanMetadata: {},
      metadata: {},
      createdAt: new Date(),
      deletedAt: null,
      deletionReason: null,
      updatedAt: new Date()
    };

    const { db, getAttachment } = createMockWorkerDb(initial);
    const storage = new InMemoryObjectStore();
    await storage.putObject(storageKey, validJpegBytes, "image/jpeg");
    const scanner = new FakeMalwareScanner();

    const result = await scanQuarantinedAttachment(
      { organizationId: orgId, attachmentId: attId },
      { db, storage, scanner }
    );

    expect(result.outcome).toBe("rejected");
    expect(result.quarantineReason).toContain("CHECKSUM_MISMATCH");
    expect(getAttachment()?.status).toBe("rejected");
  });

  it("rejects spoofed MIME attachment (e.g. script masquerading as image/jpeg)", async () => {
    const spoofedScript = Buffer.from("#!/bin/bash\necho 'malicious'");
    const initial: AttachmentRecord = {
      id: attId,
      organizationId: orgId,
      uploaderUserId: null,
      fileName: "script.jpg",
      contentType: "image/jpeg", // Spoofed!
      detectedMimeType: null,
      byteSize: spoofedScript.length,
      sha256Checksum: null,
      storageKey,
      status: "quarantine",
      quarantineReason: null,
      scannedAt: null,
      scannerName: null,
      scanMetadata: {},
      metadata: {},
      createdAt: new Date(),
      deletedAt: null,
      deletionReason: null,
      updatedAt: new Date()
    };

    const { db, getAttachment } = createMockWorkerDb(initial);
    const storage = new InMemoryObjectStore();
    await storage.putObject(storageKey, spoofedScript, "image/jpeg");
    const scanner = new FakeMalwareScanner();

    const result = await scanQuarantinedAttachment(
      { organizationId: orgId, attachmentId: attId },
      { db, storage, scanner }
    );

    expect(result.outcome).toBe("rejected");
    expect(result.quarantineReason).toContain("UNKNOWN_MAGIC_BYTES");
    expect(getAttachment()?.status).toBe("rejected");
  });

  it("rejects attachment containing EICAR malware test string", async () => {
    // A valid PDF containing the EICAR string
    const maliciousPdf = Buffer.concat([
      Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n"),
      Buffer.from(EICAR_TEST_SIGNATURE),
      Buffer.from("\n%%EOF\n")
    ]);

    const initial: AttachmentRecord = {
      id: attId,
      organizationId: orgId,
      uploaderUserId: null,
      fileName: "infected.pdf",
      contentType: "application/pdf",
      detectedMimeType: null,
      byteSize: maliciousPdf.length,
      sha256Checksum: null,
      storageKey,
      status: "quarantine",
      quarantineReason: null,
      scannedAt: null,
      scannerName: null,
      scanMetadata: {},
      metadata: {},
      createdAt: new Date(),
      deletedAt: null,
      deletionReason: null,
      updatedAt: new Date()
    };

    const { db, getAttachment } = createMockWorkerDb(initial);
    const storage = new InMemoryObjectStore();
    await storage.putObject(storageKey, maliciousPdf, "application/pdf");
    const scanner = new FakeMalwareScanner();

    const result = await scanQuarantinedAttachment(
      { organizationId: orgId, attachmentId: attId },
      { db, storage, scanner }
    );

    expect(result.outcome).toBe("rejected");
    expect(result.quarantineReason).toContain("MALWARE_DETECTED");
    expect(result.quarantineReason).toContain("EICAR");
    expect(getAttachment()?.status).toBe("rejected");
  });

  it("skips scan idempotently if attachment is already clean or rejected", async () => {
    const cleanAttachment: AttachmentRecord = {
      id: attId,
      organizationId: orgId,
      uploaderUserId: null,
      fileName: "photo.jpg",
      contentType: "image/jpeg",
      detectedMimeType: "image/jpeg",
      byteSize: 100,
      sha256Checksum: null,
      storageKey,
      status: "clean",
      quarantineReason: null,
      scannedAt: new Date(),
      scannerName: "clamav",
      scanMetadata: {},
      metadata: {},
      createdAt: new Date(),
      deletedAt: null,
      deletionReason: null,
      updatedAt: new Date()
    };

    const { db } = createMockWorkerDb(cleanAttachment);
    const storage = new InMemoryObjectStore();
    const scanner = new FakeMalwareScanner();

    const result = await scanQuarantinedAttachment(
      { organizationId: orgId, attachmentId: attId },
      { db, storage, scanner }
    );

    expect(result.outcome).toBe("already_processed");
    expect(result.status).toBe("clean");
  });
});
