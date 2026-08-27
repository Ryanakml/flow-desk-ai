import { describe, expect, it } from "vitest";
import {
  AuditLogEntrySchema,
  BuildInfoSchema,
  CursorPageQuerySchema,
  decodeCursor,
  encodeCursor,
  IdempotencyHeaderSchema,
  ListAuditLogsResponseSchema
} from "./index.js";

describe("Contracts & Primitives (M1-06)", () => {
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
  });
});
