import { describe, expect, it } from "vitest";
import type { DbClient, ExpiredAttachmentRow } from "@flowdesk/db";
import { InMemoryObjectStore } from "@flowdesk/providers";
import { runRetentionJob } from "./media-retention.js";

const orgId = "org-retention-001";

function makeCandidateRow(overrides?: Partial<ExpiredAttachmentRow>): ExpiredAttachmentRow {
  return {
    id: "att-old-001",
    organizationId: orgId,
    storageKey: `org-${orgId}/clean/att-old-001`,
    status: "clean",
    createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000), // 100 days ago
    ...overrides
  };
}

function makeMockDb(candidates: ExpiredAttachmentRow[]) {
  return {
    query: async (sql: string) => {
      await Promise.resolve();
      // listExpiredAttachments SELECT
      if (sql.includes("FROM flowdesk.attachments") && sql.includes("deleted_at IS NULL")) {
        return {
          rows: candidates,
          rowCount: candidates.length,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }
      // softDeleteAttachment UPDATE
      if (sql.includes("SET deleted_at = $1")) {
        return {
          rows: [
            {
              id: "att-old-001",
              organizationId: orgId,
              uploaderUserId: null,
              fileName: "photo.png",
              contentType: "image/png",
              detectedMimeType: null,
              byteSize: "1000",
              sha256Checksum: null,
              storageKey: "key",
              status: "clean",
              quarantineReason: null,
              scannedAt: null,
              scannerName: null,
              scanMetadata: {},
              metadata: {},
              deletedAt: new Date(),
              deletionReason: "retention_expiry",
              createdAt: new Date(),
              updatedAt: new Date()
            }
          ],
          rowCount: 1,
          command: "UPDATE",
          oid: 0,
          fields: []
        };
      }
      // outbox INSERT
      return { rows: [], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
    }
  } as unknown as DbClient;
}

describe("runRetentionJob (M3-07)", () => {
  it("returns processed=0 when there are no expired candidates", async () => {
    const db = makeMockDb([]);
    const storage = new InMemoryObjectStore();
    const result = await runRetentionJob({ organizationId: orgId }, { db, storage });

    expect(result.processed).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("deletes storage object and soft-deletes DB record for expired clean attachment", async () => {
    const candidate = makeCandidateRow({ status: "clean" });
    const db = makeMockDb([candidate]);
    const storage = new InMemoryObjectStore();

    // Pre-seed storage so deleteObject doesn't throw
    await storage.putObject(candidate.storageKey, Buffer.from("data"), "image/png");

    const result = await runRetentionJob(
      { organizationId: orgId, config: { cleanRetentionDays: 90 } },
      { db, storage }
    );

    expect(result.processed).toBe(1);
    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(0);

    // Storage object should be gone
    const head = await storage.headObject(candidate.storageKey);
    expect(head.exists).toBe(false);
  });

  it("skips attachment that has not reached its retention window", async () => {
    // Created 5 days ago, clean retention is 90 days — should be skipped
    const candidate = makeCandidateRow({
      status: "clean",
      createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    });
    const db = makeMockDb([candidate]);
    const storage = new InMemoryObjectStore();

    const result = await runRetentionJob(
      { organizationId: orgId, config: { cleanRetentionDays: 90 } },
      { db, storage }
    );

    expect(result.processed).toBe(1);
    expect(result.deleted).toBe(0); // skipped — not past retention window
    expect(result.errors).toBe(0);
  });

  it("expires rejected attachments after shorter retention window (7 days)", async () => {
    const candidate = makeCandidateRow({
      status: "rejected",
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) // 10 days ago
    });
    const db = makeMockDb([candidate]);
    const storage = new InMemoryObjectStore();
    await storage.putObject(candidate.storageKey, Buffer.from("rejected"), "application/pdf");

    const result = await runRetentionJob(
      { organizationId: orgId, config: { cleanRetentionDays: 90, rejectedRetentionDays: 7 } },
      { db, storage }
    );

    expect(result.deleted).toBe(1);
    const head = await storage.headObject(candidate.storageKey);
    expect(head.exists).toBe(false);
  });

  it("records an error and continues for storage deletion failures", async () => {
    const candidate1 = makeCandidateRow({
      id: "att-bad",
      storageKey: "org/clean/att-bad",
      status: "clean"
    });
    const candidate2 = makeCandidateRow({
      id: "att-good",
      storageKey: "org/clean/att-good",
      status: "clean"
    });

    const db = makeMockDb([candidate1, candidate2]);

    // Storage that throws on att-bad but not att-good
    const storage = new InMemoryObjectStore();
    // Only pre-seed att-good
    await storage.putObject(candidate2.storageKey, Buffer.from("good"), "image/png");
    // att-bad is NOT seeded, but InMemoryObjectStore.deleteObject() doesn't throw on missing keys
    // So let's override deleteObject to throw for att-bad
    const originalDelete = storage.deleteObject.bind(storage);
    storage.deleteObject = async (key: string) => {
      if (key === candidate1.storageKey) {
        throw new Error("Simulated storage failure");
      }
      return originalDelete(key);
    };

    const result = await runRetentionJob(
      { organizationId: orgId, config: { cleanRetentionDays: 90 } },
      { db, storage }
    );

    expect(result.processed).toBe(2);
    // att-good deleted, att-bad errored
    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(1);
  });

  it("is idempotent — running twice with same candidates is safe", async () => {
    const candidate = makeCandidateRow({ status: "clean" });
    const db = makeMockDb([candidate]);
    const storage = new InMemoryObjectStore();
    await storage.putObject(candidate.storageKey, Buffer.from("data"), "image/png");

    const r1 = await runRetentionJob({ organizationId: orgId }, { db, storage });
    // Second run: candidate still in mock DB (we don't filter in mock), but storage already deleted
    // InMemoryObjectStore.deleteObject on missing key should not throw
    const r2 = await runRetentionJob({ organizationId: orgId }, { db, storage });

    expect(r1.deleted).toBe(1);
    // Second run: storage already gone, deleteObject is a no-op in InMemoryObjectStore
    expect(r2.errors).toBe(0);
  });
});
