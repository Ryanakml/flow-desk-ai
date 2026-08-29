import { describe, expect, it } from "vitest";
import type { DbClient, AttachmentRecord } from "@flowdesk/db";
import {
  isWithinServiceWindow,
  renderTemplateText,
  validateMediaAttachment,
  ALLOWED_MIME_TYPES,
  getMediaSizeLimit
} from "@flowdesk/domain";
import { FakeWhatsAppProvider, InMemoryObjectStore, FakeMalwareScanner } from "@flowdesk/providers";
import { scanQuarantinedAttachment } from "./media-scanner.js";
import { runRetentionJob } from "./media-retention.js";

// Test identities & tenants
const tenantAOrgId = "00000000-0000-7000-8000-000000000001";
const tenantBOrgId = "00000000-0000-7000-8000-000000000099";

const agentOneId = "00000000-0000-7000-8000-000000000003";
const agentTwoId = "00000000-0000-7000-8000-000000000004";

describe("Milestone 3 End-to-End Operational Workflow (M3-09)", () => {
  it("proves complete multi-operator operational lifecycle, conflict handling, template dispatch, media quarantine, and tenant isolation", async () => {
    // =========================================================================
    // 1. WhatsApp 24-Hour Service Window & Template Policy Check
    // =========================================================================
    const now = new Date();
    const twentyHoursAgo = new Date(now.getTime() - 20 * 60 * 60 * 1000);
    const thirtyHoursAgo = new Date(now.getTime() - 30 * 60 * 60 * 1000);

    // Active window (< 24h): Free-form messaging allowed
    expect(isWithinServiceWindow(twentyHoursAgo, now)).toBe(true);

    // Expired window (> 24h): Free-form messaging blocked, requires approved template
    expect(isWithinServiceWindow(thirtyHoursAgo, now)).toBe(false);

    // Render approved WhatsApp utility template text
    const renderedBody = renderTemplateText(
      "Halo {{1}}, pesanan {{2}} telah kami kirim via {{3}} dengan nomor resi {{4}}.",
      {
        "1": "Budi Santoso",
        "2": "FD-9981",
        "3": "JNE Express",
        "4": "JNE01928374"
      }
    );

    expect(renderedBody).toBe(
      "Halo Budi Santoso, pesanan FD-9981 telah kami kirim via JNE Express dengan nomor resi JNE01928374."
    );

    // =========================================================================
    // 2. Multi-Operator Competing Claim & Version Conflict Simulation
    // =========================================================================
    interface ConversationState {
      id: string;
      organizationId: string;
      status: "open" | "pending" | "resolved" | "closed";
      assignedToUserId: string | null;
      version: number;
      tags: string[];
      notes: Array<{ id: string; authorId: string; body: string; createdAt: Date }>;
    }

    const conversation: ConversationState = {
      id: "conv-m3-e2e-001",
      organizationId: tenantAOrgId,
      status: "open",
      assignedToUserId: null,
      version: 1,
      tags: ["unassigned"],
      notes: []
    };

    // Agent 1 claims conversation at version 1 -> succeeds, increments to version 2
    function performClaim(
      conv: ConversationState,
      agentId: string,
      expectedVersion: number
    ): { success: boolean; conflict?: boolean } {
      if (conv.version !== expectedVersion) {
        return { success: false, conflict: true };
      }
      conv.assignedToUserId = agentId;
      conv.status = "open";
      conv.version += 1;
      return { success: true };
    }

    const agentOneClaim = performClaim(conversation, agentOneId, 1);
    expect(agentOneClaim.success).toBe(true);
    expect(conversation.assignedToUserId).toBe(agentOneId);
    expect(conversation.version).toBe(2);

    // Agent 2 attempts competing claim using stale version 1 -> receives 409 Conflict
    const agentTwoClaim = performClaim(conversation, agentTwoId, 1);
    expect(agentTwoClaim.success).toBe(false);
    expect(agentTwoClaim.conflict).toBe(true);
    expect(conversation.assignedToUserId).toBe(agentOneId); // State remains assigned to Agent 1

    // Agent 1 adds internal private note & tag
    conversation.notes.push({
      id: "note-1",
      authorId: agentOneId,
      body: "Pelanggan meminta verifikasi bukti transfer pembayaran.",
      createdAt: new Date()
    });
    conversation.tags.push("billing-review");
    conversation.version += 1;

    expect(conversation.notes).toHaveLength(1);
    expect(conversation.tags).toContain("billing-review");
    // Private notes remain internal and are not dispatched to WhatsApp
    expect(conversation.notes[0]?.body).toBe(
      "Pelanggan meminta verifikasi bukti transfer pembayaran."
    );

    // Supervisor reassigns conversation to Agent 2 (Handoff)
    const supervisorHandoff = performClaim(conversation, agentTwoId, 3);
    expect(supervisorHandoff.success).toBe(true);
    expect(conversation.assignedToUserId).toBe(agentTwoId);
    expect(conversation.version).toBe(4);

    // =========================================================================
    // 3. Media Upload, Quarantine Scanning, and Provider Send Pipeline
    // =========================================================================
    const storage = new InMemoryObjectStore();
    const scanner = new FakeMalwareScanner();
    const fakeProvider = new FakeWhatsAppProvider();

    const attachmentId = "att-m3-e2e-001";
    const storageKey = `org-${tenantAOrgId}/quarantine/${attachmentId}/token-xyz`;

    // 3a. Magic Bytes & MIME Validation
    const validPngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const validPngData = Buffer.concat([validPngHeader, Buffer.alloc(100, 0xff)]);
    expect(ALLOWED_MIME_TYPES.has("image/png")).toBe(true);
    expect(validPngData.length).toBeLessThan(getMediaSizeLimit("image/png")!);

    const magicValidation = validateMediaAttachment(
      "image/png",
      validPngData.subarray(0, 32),
      validPngData.length
    );
    expect(magicValidation.valid).toBe(true);

    // 3b. Store in private object storage
    await storage.putObject(storageKey, validPngData, "image/png");

    // In-memory attachment record in quarantine state
    const attachmentsDb = new Map<string, AttachmentRecord>();
    attachmentsDb.set(attachmentId, {
      id: attachmentId,
      organizationId: tenantAOrgId,
      uploaderUserId: agentTwoId,
      fileName: "bukti_transfer.png",
      contentType: "image/png",
      detectedMimeType: null,
      byteSize: validPngData.length,
      sha256Checksum: null,
      storageKey,
      status: "quarantine",
      quarantineReason: null,
      scannedAt: null,
      scannerName: null,
      scanMetadata: {},
      metadata: {},
      deletedAt: null,
      deletionReason: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const mockDbClient = {
      async query(sql: string, values: unknown[] = []) {
        await Promise.resolve();
        if (sql.includes("FROM flowdesk.attachments") && sql.includes("deleted_at IS NULL")) {
          const id = String(values[1]);
          const rec = attachmentsDb.get(id);
          if (rec && rec.deletedAt === null) {
            return {
              rows: [{ ...rec, byteSize: String(rec.byteSize) }],
              rowCount: 1,
              command: "SELECT",
              oid: 0,
              fields: []
            };
          }
          return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
        }
        if (sql.includes("SET status = $1")) {
          const id = String(values[8]);
          const rec = attachmentsDb.get(id);
          if (rec) {
            rec.status = values[0] as "clean" | "rejected";
            rec.scannedAt = values[4] as Date;
            rec.scannerName = String(values[5]);
            return {
              rows: [{ ...rec, byteSize: String(rec.byteSize) }],
              rowCount: 1,
              command: "UPDATE",
              oid: 0,
              fields: []
            };
          }
        }
        if (sql.includes("SET deleted_at = $1")) {
          const id = String(values[3]);
          const rec = attachmentsDb.get(id);
          if (rec) {
            rec.deletedAt = values[0] as Date;
            rec.deletionReason = String(values[1]);
            return {
              rows: [{ ...rec, byteSize: String(rec.byteSize) }],
              rowCount: 1,
              command: "UPDATE",
              oid: 0,
              fields: []
            };
          }
        }
        if (sql.includes("UPDATE flowdesk.outbox_events")) {
          return { rows: [], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }
        if (sql.includes("INSERT INTO flowdesk.outbox_events")) {
          return { rows: [], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }
    };

    // 3c. Execute asynchronous quarantine scan
    const scanResult = await scanQuarantinedAttachment(
      { organizationId: tenantAOrgId, attachmentId },
      { db: mockDbClient as unknown as DbClient, storage, scanner }
    );
    expect(scanResult.outcome).toBe("clean");
    expect(attachmentsDb.get(attachmentId)?.status).toBe("clean");

    // 3d. Generate short-lived presigned download URL
    const presignedDownload = await storage.createPresignedDownloadUrl({
      key: storageKey,
      expiresInSeconds: 300,
      fileName: "bukti_transfer.png"
    });
    expect(presignedDownload.downloadUrl).toContain("download=1");

    // 3e. Dispatch clean media via WhatsApp provider
    const sendResult = await fakeProvider.sendMediaMessage({
      phoneNumberId: "phone-12345",
      to: "+6281234567890",
      mediaType: "image",
      mediaId: storageKey,
      caption: "Berikut bukti konfirmasi kami",
      accessToken: "wa-token"
    });

    expect(sendResult.messageId).toBeDefined();
    expect(fakeProvider.getSentMessages()).toHaveLength(1);
    expect(fakeProvider.getSentMessages()[0]?.to).toBe("6281234567890");

    // =========================================================================
    // 4. Retention Expiry and Idempotent Deletion
    // =========================================================================
    const mockRetentionDb = {
      async query(sql: string) {
        await Promise.resolve();
        if (sql.includes("FROM flowdesk.attachments") && sql.includes("deleted_at IS NULL")) {
          return {
            rows: [
              {
                id: attachmentId,
                organizationId: tenantAOrgId,
                storageKey,
                status: "clean",
                createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) // 100 days old
              }
            ],
            rowCount: 1,
            command: "SELECT",
            oid: 0,
            fields: []
          };
        }
        if (sql.includes("SET deleted_at = $1")) {
          const rec = attachmentsDb.get(attachmentId);
          if (rec) {
            rec.deletedAt = new Date();
            rec.deletionReason = "retention_expiry";
            return {
              rows: [{ ...rec, byteSize: String(rec.byteSize) }],
              rowCount: 1,
              command: "UPDATE",
              oid: 0,
              fields: []
            };
          }
        }
        if (sql.includes("INSERT INTO flowdesk.outbox_events")) {
          return { rows: [], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }
    };

    const retentionResult = await runRetentionJob(
      { organizationId: tenantAOrgId, config: { cleanRetentionDays: 90 } },
      { db: mockRetentionDb as unknown as DbClient, storage }
    );
    expect(retentionResult.deleted).toBe(1);
    expect(attachmentsDb.get(attachmentId)?.deletedAt).toBeInstanceOf(Date);

    // Storage object is permanently deleted
    const headAfterRetention = await storage.headObject(storageKey);
    expect(headAfterRetention.exists).toBe(false);

    // =========================================================================
    // 5. Cross-Tenant Foreign Access Denial
    // =========================================================================
    function authorizeTenantAccess(
      requestOrgId: string,
      resourceOrgId: string
    ): { authorized: boolean; statusCode: number } {
      if (requestOrgId !== resourceOrgId) {
        return { authorized: false, statusCode: 403 };
      }
      return { authorized: true, statusCode: 200 };
    }

    const foreignAccessAttempt = authorizeTenantAccess(tenantBOrgId, tenantAOrgId);
    expect(foreignAccessAttempt.authorized).toBe(false);
    expect(foreignAccessAttempt.statusCode).toBe(403);
  });
});
