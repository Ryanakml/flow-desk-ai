import { describe, expect, it } from "vitest";
import type { DbClient } from "./auth.js";
import {
  ConversationAccessRevokedError,
  ConversationActionError,
  performConversationOperation,
  type ConversationOperation
} from "./conversation-operations.js";
import { OptimisticConcurrencyError, type ConversationRecord } from "./conversations.js";

const conversation: ConversationRecord = {
  id: "conversation-1",
  organizationId: "org-1",
  channelId: "channel-1",
  customerPhone: "+628111111111",
  customerName: "Customer",
  status: "open",
  priority: "medium",
  assignedToUserId: "actor-1",
  queueId: "queue-1",
  teamId: "team-1",
  waitingReason: null,
  botPaused: false,
  firstResponseDueAt: null,
  resolutionDueAt: null,
  resolvedAt: null,
  firstRespondedAt: null,
  slaPausedAt: null,
  firstResponseRemainingSeconds: null,
  resolutionRemainingSeconds: null,
  version: 2,
  lastMessageAt: new Date("2026-01-01T00:00:00Z"),
  lastInboundAt: null,
  metadata: {},
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z")
};

function mockDb(options?: {
  access?: boolean;
  version?: number;
  roleKey?: string;
  assignedToUserId?: string | null;
  status?: ConversationRecord["status"];
  targetAllowed?: boolean;
  updateCount?: number;
}) {
  const sqlCalls: string[] = [];
  const db = {
    async query(sqlText: string) {
      await Promise.resolve();
      const sql = sqlText.replace(/\s+/g, " ").trim();
      sqlCalls.push(sql);
      if (sql.includes("FOR UPDATE OF conversation")) {
        if (options?.access === false) return { rows: [], rowCount: 0 };
        return {
          rows: [
            {
              status: options?.status ?? "open",
              assignedToUserId:
                options && "assignedToUserId" in options
                  ? (options.assignedToUserId ?? null)
                  : "actor-1",
              queueId: "queue-1",
              version: options?.version ?? 1,
              roleKey: options?.roleKey ?? "supervisor",
              firstResponseSeconds: 300,
              resolutionSeconds: 3600,
              businessTimezone: null,
              weeklySchedule: null,
              holidayDates: null,
              pauseWhileWaiting: true,
              firstResponseRemainingSeconds: 120,
              resolutionRemainingSeconds: 1800,
              canAccess: true
            }
          ],
          rowCount: 1
        };
      }
      if (sql.includes("FOR SHARE OF membership")) {
        return { rows: options?.targetAllowed === false ? [] : [{ "?column?": 1 }], rowCount: 1 };
      }
      if (sql.includes("FROM flowdesk.queue_memberships") && sql.includes("FOR SHARE")) {
        return { rows: [{ id: "queue-member-1" }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE flowdesk.conversations")) {
        return { rows: [], rowCount: options?.updateCount ?? 1 };
      }
      if (sql.includes("RETURNING id") && sql.includes("conversation_notes")) {
        return { rows: [{ id: "note-1" }], rowCount: 1 };
      }
      if (sql.includes("RETURNING id, occurred_at")) {
        return { rows: [{ id: "audit-1", occurred_at: new Date() }], rowCount: 1 };
      }
      if (sql.includes("FROM flowdesk.conversations WHERE organization_id = $1 AND id = $2")) {
        return { rows: [{ ...conversation }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }
  } as unknown as DbClient;
  return { db, sqlCalls };
}

const operations: ConversationOperation[] = [
  { action: "claim" },
  { action: "release" },
  { action: "handoff", targetUserId: "target-1" },
  { action: "note", body: "Internal context" },
  { action: "tag.add", tagId: "tag-1" },
  { action: "tag.remove", tagId: "tag-1" },
  { action: "read", lastReadMessageId: "message-1" },
  { action: "unread" },
  { action: "wait", reason: "Waiting for customer" },
  { action: "resolve" },
  { action: "reopen" },
  { action: "bot.pause" },
  { action: "bot.resume" },
  { action: "priority", priority: "urgent" }
];

describe("race-safe conversation operations", () => {
  for (const operation of operations) {
    it(`atomically performs ${operation.action}`, async () => {
      const { db, sqlCalls } = mockDb({
        assignedToUserId: operation.action === "claim" ? null : "actor-1"
      });
      const result = await performConversationOperation(db, {
        organizationId: "org-1",
        conversationId: "conversation-1",
        actorUserId: "actor-1",
        expectedVersion: 1,
        correlationId: "correlation-1",
        operation
      });
      expect(result).toEqual(conversation);
      expect(sqlCalls.some((sql) => sql.startsWith("UPDATE flowdesk.conversations"))).toBe(true);
      expect(sqlCalls.some((sql) => sql.includes("INSERT INTO flowdesk.audit_logs"))).toBe(true);
    });
  }

  it("fails closed after membership or queue access is revoked", async () => {
    const { db } = mockDb({ access: false });
    await expect(
      performConversationOperation(db, {
        organizationId: "org-1",
        conversationId: "conversation-1",
        actorUserId: "actor-1",
        expectedVersion: 1,
        operation: { action: "claim" }
      })
    ).rejects.toBeInstanceOf(ConversationAccessRevokedError);
  });

  it("returns optimistic conflicts for a stale lock version or lost update", async () => {
    await expect(
      performConversationOperation(mockDb({ version: 2 }).db, {
        organizationId: "org-1",
        conversationId: "conversation-1",
        actorUserId: "actor-1",
        expectedVersion: 1,
        operation: { action: "claim" }
      })
    ).rejects.toBeInstanceOf(OptimisticConcurrencyError);
    await expect(
      performConversationOperation(mockDb({ assignedToUserId: null, updateCount: 0 }).db, {
        organizationId: "org-1",
        conversationId: "conversation-1",
        actorUserId: "actor-1",
        expectedVersion: 1,
        operation: { action: "claim" }
      })
    ).rejects.toBeInstanceOf(OptimisticConcurrencyError);
  });

  it("rejects invalid claims, releases, and handoffs", async () => {
    await expect(
      performConversationOperation(mockDb({ status: "closed" }).db, {
        organizationId: "org-1",
        conversationId: "conversation-1",
        actorUserId: "actor-1",
        expectedVersion: 1,
        operation: { action: "claim" }
      })
    ).rejects.toBeInstanceOf(ConversationActionError);
    await expect(
      performConversationOperation(mockDb({ assignedToUserId: "other-1", roleKey: "agent" }).db, {
        organizationId: "org-1",
        conversationId: "conversation-1",
        actorUserId: "actor-1",
        expectedVersion: 1,
        operation: { action: "release" }
      })
    ).rejects.toBeInstanceOf(ConversationActionError);
    await expect(
      performConversationOperation(mockDb({ roleKey: "agent" }).db, {
        organizationId: "org-1",
        conversationId: "conversation-1",
        actorUserId: "actor-1",
        expectedVersion: 1,
        operation: { action: "handoff", targetUserId: "target-1" }
      })
    ).rejects.toBeInstanceOf(ConversationActionError);
    await expect(
      performConversationOperation(mockDb({ targetAllowed: false }).db, {
        organizationId: "org-1",
        conversationId: "conversation-1",
        actorUserId: "actor-1",
        expectedVersion: 1,
        operation: { action: "handoff", targetUserId: "target-1" }
      })
    ).rejects.toBeInstanceOf(ConversationActionError);
  });
});
