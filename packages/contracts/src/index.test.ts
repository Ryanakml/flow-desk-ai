import { describe, expect, it } from "vitest";
import {
  AuditLogEntrySchema,
  BuildInfoSchema,
  ConversationOperationRequestSchema,
  RealtimeConnectAuthSchema,
  RealtimeHintSchema,
  CursorPageQuerySchema,
  decodeCursor,
  encodeCursor,
  IdempotencyHeaderSchema,
  ListAuditLogsResponseSchema,
  WhatsAppTemplateSchema,
  WhatsAppTemplateVersionSchema,
  CreateOutboundMessageRequestSchema,
  ServiceWindowStatusSchema,
  TemplatePreviewRequestSchema,
  TemplatePreviewResponseSchema,
  CreateUploadSessionRequestSchema,
  CreateUploadSessionResponseSchema,
  CompleteUploadRequestSchema,
  AttachmentDetailResponseSchema
} from "./index.js";

describe("Contracts & Primitives (M1-06)", () => {
  describe("M3 conversation operations", () => {
    it("validates discriminated, versioned operations", () => {
      expect(
        ConversationOperationRequestSchema.parse({
          version: 3,
          action: "handoff",
          targetUserId: "00000000-0000-7000-8000-000000000001"
        }).action
      ).toBe("handoff");
      expect(() =>
        ConversationOperationRequestSchema.parse({ version: 0, action: "claim" })
      ).toThrow();
      expect(() =>
        ConversationOperationRequestSchema.parse({ version: 1, action: "note", body: " " })
      ).toThrow();
    });
  });

  describe("M3 realtime envelopes", () => {
    it("keeps connect state and hints versioned and free of payload content", () => {
      expect(
        RealtimeConnectAuthSchema.parse({
          organizationId: "00000000-0000-7000-8000-000000000001",
          lastVersion: 4
        }).lastVersion
      ).toBe(4);
      const hint = RealtimeHintSchema.parse({
        schemaVersion: 1,
        organizationId: "00000000-0000-7000-8000-000000000001",
        resourceType: "conversation",
        resourceId: "00000000-0000-7000-8000-000000000002",
        version: 5,
        content: "must be stripped"
      });
      expect(hint).not.toHaveProperty("content");
    });
  });

  describe("BuildInfoSchema", () => {
    it("rejects an unknown environment", () => {
      expect(() =>
        BuildInfoSchema.parse({ service: "api", version: "dev", gitSha: "x", environment: "qa" })
      ).toThrow();
    });
  });

  describe("Cursor Primitives", () => {
    it("encodes and decodes a valid cursor", () => {
      const cursor = encodeCursor({
        id: "rec-123",
        sortValue: "2026-08-27T12:00:00.000Z",
        organizationId: "org-1"
      });

      expect(typeof cursor).toBe("string");
      const decoded = decodeCursor(cursor);
      expect(decoded).toEqual({
        id: "rec-123",
        sortValue: "2026-08-27T12:00:00.000Z",
        organizationId: "org-1"
      });
    });

    it("encodes Date sort values to ISO string", () => {
      const now = new Date();
      const cursor = encodeCursor({
        id: "rec-456",
        sortValue: now
      });

      const decoded = decodeCursor(cursor);
      expect(decoded?.sortValue).toBe(now.toISOString());
    });

    it("enforces cross-organization cursor protection", () => {
      const cursorOrgA = encodeCursor({
        id: "rec-789",
        sortValue: "val-1",
        organizationId: "org-a"
      });

      // Same org succeeds
      expect(decodeCursor(cursorOrgA, "org-a")).not.toBeNull();

      // Foreign org fails closed by returning null
      expect(decodeCursor(cursorOrgA, "org-b")).toBeNull();
    });

    it("handles invalid or tampered cursors gracefully", () => {
      expect(decodeCursor("not-base64-json")).toBeNull();
      expect(decodeCursor(Buffer.from('{"invalid":"json"}').toString("base64url"))).toBeNull();
    });

    it("validates CursorPageQuerySchema with defaults and bounds", () => {
      const parsedDefault = CursorPageQuerySchema.parse({});
      expect(parsedDefault.limit).toBe(50);
      expect(parsedDefault.cursor).toBeUndefined();

      const parsedExplicit = CursorPageQuerySchema.parse({ limit: "25", cursor: "abc" });
      expect(parsedExplicit.limit).toBe(25);
      expect(parsedExplicit.cursor).toBe("abc");

      // Limit capped at 100
      expect(() => CursorPageQuerySchema.parse({ limit: 101 })).toThrow();
      expect(() => CursorPageQuerySchema.parse({ limit: 0 })).toThrow();
    });
  });

  describe("Audit & Idempotency Schemas", () => {
    it("validates valid AuditLogEntry", () => {
      const entry = {
        id: "a0000000-0000-4000-8000-000000000001",
        organizationId: "a0000000-0000-4000-8000-000000000002",
        actorUserId: "a0000000-0000-4000-8000-000000000003",
        action: "org:bootstrap",
        targetType: "organization",
        targetId: "a0000000-0000-4000-8000-000000000002",
        result: "allowed",
        correlationId: "a0000000-0000-4000-8000-000000000004",
        metadata: { clientIp: "127.0.0.1" },
        occurredAt: new Date().toISOString()
      };

      const parsed = AuditLogEntrySchema.parse(entry);
      expect(parsed.action).toBe("org:bootstrap");
      expect(parsed.result).toBe("allowed");
    });

    it("validates ListAuditLogsResponseSchema enveloped structure", () => {
      const response = {
        items: [
          {
            id: "a0000000-0000-4000-8000-000000000001",
            organizationId: "a0000000-0000-4000-8000-000000000002",
            actorUserId: null,
            action: "system:alert",
            targetType: "system",
            targetId: null,
            result: "denied",
            correlationId: null,
            metadata: {},
            occurredAt: new Date().toISOString()
          }
        ],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: "cur-1",
          endCursor: "cur-1",
          totalCount: 1
        }
      };

      const parsed = ListAuditLogsResponseSchema.parse(response);
      expect(parsed.items.length).toBe(1);
      expect(parsed.pageInfo.hasNextPage).toBe(false);
    });

    it("validates IdempotencyHeaderSchema", () => {
      expect(IdempotencyHeaderSchema.parse("req-12345")).toBe("req-12345");
      expect(() => IdempotencyHeaderSchema.parse("")).toThrow();
      expect(() => IdempotencyHeaderSchema.parse("   ")).toThrow();
      expect(() => IdempotencyHeaderSchema.parse("a".repeat(257))).toThrow();
    });

    it("validates WhatsAppTemplateVersionSchema and WhatsAppTemplateSchema", () => {
      const template = {
        id: "a0000000-0000-4000-8000-000000000001",
        organizationId: "a0000000-0000-4000-8000-000000000002",
        channelId: "a0000000-0000-4000-8000-000000000003",
        name: "order_confirmation",
        category: "UTILITY" as const,
        versions: [
          {
            id: "a0000000-0000-4000-8000-000000000004",
            templateId: "a0000000-0000-4000-8000-000000000001",
            organizationId: "a0000000-0000-4000-8000-000000000002",
            providerTemplateId: "meta-tpl-123",
            language: "id",
            status: "APPROVED" as const,
            components: [
              {
                type: "BODY" as const,
                text: "Pesanan {{1}} Anda telah dikonfirmasi."
              }
            ],
            variableCount: 1,
            payloadHash: "hash-xyz-123",
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const parsed = WhatsAppTemplateSchema.parse(template);
      expect(parsed.name).toBe("order_confirmation");
      expect(parsed.category).toBe("UTILITY");
      expect(parsed.versions?.[0]?.status).toBe("APPROVED");
      expect(parsed.versions?.[0]?.components[0]?.type).toBe("BODY");
      expect(WhatsAppTemplateVersionSchema.parse(template.versions[0])).toBeDefined();
    });

    it("validates outbound message request union (text, template, and media)", () => {
      // Text outbound message
      const textMsg = CreateOutboundMessageRequestSchema.parse({
        content: "Halo dari customer support!"
      });
      expect(textMsg).toEqual({ content: "Halo dari customer support!" });

      // Explicit text outbound message
      const explicitText = CreateOutboundMessageRequestSchema.parse({
        type: "text",
        content: "Halo lagi!"
      });
      expect(explicitText).toEqual({ type: "text", content: "Halo lagi!" });

      // Template outbound message
      const tplMsg = CreateOutboundMessageRequestSchema.parse({
        type: "template",
        templateName: "order_confirmation",
        language: "id",
        variables: { "1": "ORD-12345" }
      });
      expect(tplMsg).toMatchObject({
        type: "template",
        templateName: "order_confirmation",
        language: "id",
        variables: { "1": "ORD-12345" }
      });

      const mediaMsg = CreateOutboundMessageRequestSchema.parse({
        type: "media",
        attachmentId: "00000000-0000-7000-8000-000000000030",
        caption: "Invoice Anda"
      });
      expect(mediaMsg.type).toBe("media");
    });

    it("validates service window status and template preview schemas", () => {
      const windowStatus = ServiceWindowStatusSchema.parse({
        isOpen: true,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        remainingSeconds: 3600
      });
      expect(windowStatus.isOpen).toBe(true);
      expect(windowStatus.remainingSeconds).toBe(3600);

      const previewReq = TemplatePreviewRequestSchema.parse({
        templateName: "shipping_update",
        language: "id",
        variables: { "1": "Budi", "2": "JNE-998877" }
      });
      expect(previewReq.templateName).toBe("shipping_update");

      const previewRes = TemplatePreviewResponseSchema.parse({
        templateName: "shipping_update",
        language: "id",
        status: "APPROVED",
        isEligible: true,
        ineligibilityReason: null,
        renderedBody: "Halo Budi, paket Anda dengan resi JNE-998877 telah dikirim.",
        renderedHeader: null,
        renderedComponents: [
          {
            type: "BODY",
            text: "Halo Budi, paket Anda dengan resi JNE-998877 telah dikirim."
          }
        ],
        renderedPayloadHash: "hash-rendered-abc"
      });
      expect(previewRes.isEligible).toBe(true);
      expect(previewRes.renderedBody).toContain("Budi");
    });
  });

  describe("Attachment & Media Quarantine Schemas (M3-06)", () => {
    it("validates valid upload session request and enforces 100MB size limit", () => {
      const valid = CreateUploadSessionRequestSchema.parse({
        fileName: "report.pdf",
        contentType: "application/pdf",
        byteSize: 10 * 1024 * 1024,
        sha256Checksum: "a".repeat(64)
      });
      expect(valid.fileName).toBe("report.pdf");
      expect(valid.byteSize).toBe(10485760);

      // Rejects oversized file (> 100MB)
      expect(() =>
        CreateUploadSessionRequestSchema.parse({
          fileName: "huge.mp4",
          contentType: "video/mp4",
          byteSize: 100 * 1024 * 1024 + 1
        })
      ).toThrow();

      // Rejects invalid checksum format
      expect(() =>
        CreateUploadSessionRequestSchema.parse({
          fileName: "file.jpg",
          contentType: "image/jpeg",
          byteSize: 1000,
          sha256Checksum: "invalid-not-64-hex"
        })
      ).toThrow();
    });

    it("validates upload session response and attachment detail", () => {
      const sessionRes = CreateUploadSessionResponseSchema.parse({
        attachmentId: "00000000-0000-7000-8000-000000000001",
        uploadSessionId: "00000000-0000-7000-8000-000000000002",
        uploadUrl: "https://s3.local/bucket/key?signed=true",
        headers: { "x-amz-acl": "private" },
        expiresAt: new Date().toISOString()
      });
      expect(sessionRes.attachmentId).toBe("00000000-0000-7000-8000-000000000001");

      const attachment = AttachmentDetailResponseSchema.parse({
        id: "00000000-0000-7000-8000-000000000001",
        organizationId: "00000000-0000-7000-8000-000000000003",
        uploaderUserId: "00000000-0000-7000-8000-000000000004",
        fileName: "scan.png",
        contentType: "image/png",
        detectedMimeType: "image/png",
        byteSize: 50000,
        sha256Checksum: "b".repeat(64),
        status: "quarantine",
        quarantineReason: null,
        scannedAt: null,
        scannerName: null,
        deletedAt: null,
        deletionReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      expect(attachment.status).toBe("quarantine");
      expect(attachment.byteSize).toBe(50000);
    });

    it("validates CompleteUploadRequestSchema", () => {
      const valid = CompleteUploadRequestSchema.parse({
        sha256Checksum: "c".repeat(64)
      });
      expect(valid.sha256Checksum).toBe("c".repeat(64));

      const empty = CompleteUploadRequestSchema.parse({});
      expect(empty.sha256Checksum).toBeUndefined();
    });
  });
});
