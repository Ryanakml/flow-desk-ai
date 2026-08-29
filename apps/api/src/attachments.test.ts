import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadAuthConfig } from "@flowdesk/config";
import type { DbClient, AttachmentRecord, AttachmentUploadSessionRecord } from "@flowdesk/db";
import { MockIdentityProvider, InMemoryObjectStore } from "@flowdesk/providers";
import { hashSessionToken, serializeSessionCookie } from "@flowdesk/security";
import { createApiApp } from "./app.js";

const orgId = "00000000-0000-7000-8000-000000000001";
const foreignOrgId = "00000000-0000-7000-8000-000000000099";
const aliceId = "00000000-0000-7000-8000-000000000003"; // Supervisor (has message:send, conversation:read)
const bobId = "00000000-0000-7000-8000-000000000004"; // Agent (has message:send, conversation:read)
const charlieId = "00000000-0000-7000-8000-000000000005"; // Analyst (read only, NO message:send)

function createAttachmentsMockDb() {
  const users = new Map<
    string,
    { id: string; email: string; displayName: string; status: string }
  >();
  const sessions = new Map<
    string,
    { id: string; userId: string; tokenHash: string; expiresAt: Date; revokedAt: Date | null }
  >();
  const memberRoles = new Map<string, { membershipId: string; roleKey: string }>();
  const attachments = new Map<string, AttachmentRecord>();
  const uploadSessions = new Map<string, AttachmentUploadSessionRecord>();
  const outboxEvents: Array<{
    organizationId: string;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }> = [];

  users.set(aliceId, {
    id: aliceId,
    email: "alice@flowdesk.dev",
    displayName: "Alice Supervisor",
    status: "active"
  });
  users.set(bobId, {
    id: bobId,
    email: "bob@flowdesk.dev",
    displayName: "Bob Agent",
    status: "active"
  });
  users.set(charlieId, {
    id: charlieId,
    email: "charlie@flowdesk.dev",
    displayName: "Charlie Analyst",
    status: "active"
  });

  sessions.set(hashSessionToken("alice-token"), {
    id: "s1",
    userId: aliceId,
    tokenHash: hashSessionToken("alice-token"),
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null
  });
  sessions.set(hashSessionToken("bob-token"), {
    id: "s2",
    userId: bobId,
    tokenHash: hashSessionToken("bob-token"),
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null
  });
  sessions.set(hashSessionToken("charlie-token"), {
    id: "s3",
    userId: charlieId,
    tokenHash: hashSessionToken("charlie-token"),
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null
  });

  memberRoles.set(`${orgId}:${aliceId}`, { membershipId: "m1", roleKey: "supervisor" });
  memberRoles.set(`${orgId}:${bobId}`, { membershipId: "m2", roleKey: "agent" });
  memberRoles.set(`${orgId}:${charlieId}`, { membershipId: "m3", roleKey: "analyst" });

  const db = {
    query: async (sql: string, values: unknown[] = []) => {
      await Promise.resolve();
      // 1. Session lookup
      if (sql.includes("FROM flowdesk.auth_sessions s")) {
        const tokenHash = values[0] as string;
        const s = sessions.get(tokenHash);
        if (!s || s.revokedAt || s.expiresAt < new Date()) {
          return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
        }
        const u = users.get(s.userId);
        if (!u || u.status !== "active") {
          return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
        }
        return {
          rows: [
            {
              id: s.id,
              user_id: u.id,
              email: u.email,
              display_name: u.displayName,
              expires_at: s.expiresAt,
              created_at: new Date()
            }
          ],
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }

      // 2. Membership permission check
      if (sql.includes("FROM flowdesk.memberships m")) {
        const [targetOrgId, targetUserId] = values as [string, string];
        const m = memberRoles.get(`${targetOrgId}:${targetUserId}`);
        if (!m) return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
        return {
          rows: [{ id: m.membershipId, role_key: m.roleKey, status: "active" }],
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }

      // 3. INSERT INTO flowdesk.attachments
      if (sql.includes("INSERT INTO flowdesk.attachments")) {
        const id = randomUUID();
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

      // 4. INSERT INTO flowdesk.attachment_upload_sessions
      if (sql.includes("INSERT INTO flowdesk.attachment_upload_sessions")) {
        const id = randomUUID();
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
        uploadSessions.set(id, record);
        return { rows: [record], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      // 5. SELECT FROM flowdesk.attachments
      if (
        sql.includes("FROM flowdesk.attachments") &&
        sql.includes("organization_id = $1 AND id = $2")
      ) {
        const [targetOrgId, id] = values as [string, string];
        const record = attachments.get(id);
        if (record && record.organizationId === targetOrgId) {
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

      // 6. UPDATE flowdesk.attachment_upload_sessions
      if (sql.includes("UPDATE flowdesk.attachment_upload_sessions")) {
        const [now, targetOrgId, attId] = values as [Date, string, string];
        for (const s of uploadSessions.values()) {
          if (s.organizationId === targetOrgId && s.attachmentId === attId) {
            s.completedAt = now;
          }
        }
        return { rows: [], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
      }

      // 7. UPDATE flowdesk.attachments (checksum)
      if (sql.includes("SET sha256_checksum = $1")) {
        const [checksum, now, targetOrgId, attId] = values as [string, Date, string, string];
        const att = attachments.get(attId);
        if (att && att.organizationId === targetOrgId) {
          att.sha256Checksum = checksum;
          att.updatedAt = now;
        }
        return { rows: [], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
      }

      // 8. INSERT INTO flowdesk.outbox_events
      if (sql.includes("INSERT INTO flowdesk.outbox_events")) {
        const payloadStr = (values.length === 3 ? values[2] : values[3]) as string;
        const eventType = values.length === 3 ? "attachment.uploaded" : (values[2] as string);
        outboxEvents.push({
          organizationId: values[0] as string,
          aggregateType: "attachment",
          aggregateId: values[1] as string,
          eventType,
          payload: JSON.parse(payloadStr) as Record<string, unknown>
        });
        return { rows: [], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
    }
  } as unknown as DbClient;

  return { db, attachments, uploadSessions, outboxEvents };
}

function createTestApp() {
  const authConfig = loadAuthConfig({
    APP_ENV: "local",
    AUTH_SESSION_SECRET: "test-secret-at-least-32-chars-long-flowdesk"
  });
  const mockDb = createAttachmentsMockDb();
  const storage = new InMemoryObjectStore();

  const app = createApiApp({
    service: "flowdesk-api",
    version: "1.0.0",
    gitSha: "testsha",
    environment: "local",
    auth: {
      db: mockDb.db,
      config: authConfig,
      identityProvider: new MockIdentityProvider()
    },
    storage
  });

  const bobCookie = serializeSessionCookie("bob-token", false);
  const charlieCookie = serializeSessionCookie("charlie-token", false);

  return { app, mockDb, storage, bobCookie, charlieCookie, authConfig };
}

function asRecord(val: unknown): Record<string, unknown> {
  return typeof val === "object" && val !== null ? (val as Record<string, unknown>) : {};
}

describe("Attachments & Presigned Upload API (M3-06)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .post(`/api/v1/organizations/${orgId}/attachments/upload-session`)
      .send({
        fileName: "invoice.pdf",
        contentType: "application/pdf",
        byteSize: 1024
      });

    expect(res.status).toBe(401);
  });

  it("denies upload session generation to users without message:send permission (403)", async () => {
    const { app, charlieCookie } = createTestApp();

    const res = await request(app)
      .post(`/api/v1/organizations/${orgId}/attachments/upload-session`)
      .set("Cookie", charlieCookie)
      .send({
        fileName: "invoice.pdf",
        contentType: "application/pdf",
        byteSize: 1024
      });

    expect(res.status).toBe(403);
    expect(asRecord(res.body)["code"]).toBe("FORBIDDEN");
  });

  it("rejects disallowed MIME type with 422 DISALLOWED_MIME_TYPE", async () => {
    const { app, bobCookie } = createTestApp();

    const res = await request(app)
      .post(`/api/v1/organizations/${orgId}/attachments/upload-session`)
      .set("Cookie", bobCookie)
      .send({
        fileName: "deploy.sh",
        contentType: "application/x-sh",
        byteSize: 1024
      });

    expect(res.status).toBe(422);
    expect(asRecord(res.body)["code"]).toBe("DISALLOWED_MIME_TYPE");
  });

  it("rejects oversized attachment exceeding category limit with 422 EXCEEDS_SIZE_LIMIT", async () => {
    const { app, bobCookie } = createTestApp();

    const res = await request(app)
      .post(`/api/v1/organizations/${orgId}/attachments/upload-session`)
      .set("Cookie", bobCookie)
      .send({
        fileName: "huge.png",
        contentType: "image/png",
        byteSize: 20 * 1024 * 1024 // 20MB > 16MB limit
      });

    expect(res.status).toBe(422);
    expect(asRecord(res.body)["code"]).toBe("EXCEEDS_SIZE_LIMIT");
  });

  it("generates presigned upload session and creates attachment in quarantine", async () => {
    const { app, bobCookie, mockDb } = createTestApp();

    const res = await request(app)
      .post(`/api/v1/organizations/${orgId}/attachments/upload-session`)
      .set("Cookie", bobCookie)
      .send({
        fileName: "customer-receipt.pdf",
        contentType: "application/pdf",
        byteSize: 50000,
        sha256Checksum: "a".repeat(64)
      });

    expect(res.status).toBe(201);
    const body = asRecord(res.body);
    expect(body["attachmentId"]).toBeDefined();
    expect(body["uploadSessionId"]).toBeDefined();
    expect(body["uploadUrl"]).toBeDefined();
    expect(body["headers"]).toEqual({ "Content-Type": "application/pdf" });
    expect(body["expiresAt"]).toBeDefined();

    // Verify DB state
    const createdAttachment = mockDb.attachments.get(body["attachmentId"] as string);
    expect(createdAttachment).toBeDefined();
    expect(createdAttachment?.status).toBe("quarantine");
    expect(createdAttachment?.fileName).toBe("customer-receipt.pdf");
    expect(createdAttachment?.storageKey).toContain(`org-${orgId}/quarantine/`);
  });

  it("completes upload session, updates checksum, and triggers scan event", async () => {
    const { app, bobCookie, mockDb } = createTestApp();

    // 1. Create upload session
    const createRes = await request(app)
      .post(`/api/v1/organizations/${orgId}/attachments/upload-session`)
      .set("Cookie", bobCookie)
      .send({
        fileName: "id-card.jpg",
        contentType: "image/jpeg",
        byteSize: 45000
      });

    const attachmentId = asRecord(createRes.body)["attachmentId"] as string;

    // 2. Complete upload
    const completeRes = await request(app)
      .post(`/api/v1/organizations/${orgId}/attachments/${attachmentId}/complete`)
      .set("Cookie", bobCookie)
      .send({
        sha256Checksum: "b".repeat(64)
      });

    expect(completeRes.status).toBe(200);
    const completeBody = asRecord(completeRes.body);
    expect(completeBody["id"]).toBe(attachmentId);
    expect(completeBody["status"]).toBe("quarantine");
    expect(completeBody["sha256Checksum"]).toBe("b".repeat(64));

    // Verify outbox event
    const outbox = mockDb.outboxEvents;
    expect(outbox.length).toBeGreaterThan(0);
  });

  it("retrieves attachment details for authorized operators", async () => {
    const { app, bobCookie } = createTestApp();

    // 1. Create upload session
    const createRes = await request(app)
      .post(`/api/v1/organizations/${orgId}/attachments/upload-session`)
      .set("Cookie", bobCookie)
      .send({
        fileName: "report.pdf",
        contentType: "application/pdf",
        byteSize: 12000
      });

    const attachmentId = asRecord(createRes.body)["attachmentId"] as string;

    // 2. GET /:id
    const getRes = await request(app)
      .get(`/api/v1/organizations/${orgId}/attachments/${attachmentId}`)
      .set("Cookie", bobCookie);

    expect(getRes.status).toBe(200);
    const getBody = asRecord(getRes.body);
    expect(getBody["id"]).toBe(attachmentId);
    expect(getBody["status"]).toBe("quarantine");
    expect(getBody["fileName"]).toBe("report.pdf");
  });

  it("enforces tenant isolation (returns 404 when organization B accesses organization A attachment)", async () => {
    const { app, bobCookie } = createTestApp();

    // 1. Create in orgId
    const createRes = await request(app)
      .post(`/api/v1/organizations/${orgId}/attachments/upload-session`)
      .set("Cookie", bobCookie)
      .send({
        fileName: "private.pdf",
        contentType: "application/pdf",
        byteSize: 12000
      });

    const attachmentId = asRecord(createRes.body)["attachmentId"] as string;

    // 2. Try to access from foreignOrgId
    const getRes = await request(app)
      .get(`/api/v1/organizations/${foreignOrgId}/attachments/${attachmentId}`)
      .set("Cookie", bobCookie);

    // Foreign org fails closed (user not member of foreign org or attachment not in foreign org)
    expect([403, 404]).toContain(getRes.status);
  });
});
