import { describe, expect, it } from "vitest";
import type { DbClient } from "./auth.js";
import {
  assignConversation,
  ClosedConversationError,
  createOutboundMessageWithOutbox,
  createMessage,
  findOrCreateConversation,
  getConversationById,
  listMessagesByConversation,
  OptimisticConcurrencyError,
  updateConversationStatus,
  updateMessageStatus,
  type ConversationRecord,
  type MessageRecord
} from "./conversations.js";

function createMockConversationDb(): {
  db: DbClient;
  conversations: Map<string, ConversationRecord>;
  messages: Map<string, MessageRecord>;
} {
  const conversations = new Map<string, ConversationRecord>();
  const messages = new Map<string, MessageRecord>();

  const db = {
    async query(queryText: string, values: unknown[] = []) {
      await Promise.resolve();
      const sql = queryText.replace(/\s+/g, " ").trim();

      if (
        sql.includes("SELECT") &&
        sql.includes(
          "FROM flowdesk.conversations WHERE organization_id = $1 AND channel_id = $2 AND customer_phone = $3"
        )
      ) {
        const orgId = values[0] as string;
        const channelId = values[1] as string;
        const phone = values[2] as string;
        for (const c of conversations.values()) {
          if (
            c.organizationId === orgId &&
            c.channelId === channelId &&
            c.customerPhone === phone
          ) {
            return { rows: [c], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
          }
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      if (sql.includes("INSERT INTO flowdesk.conversations")) {
        const orgId = values[0] as string;
        const channelId = values[1] as string;
        const customerPhone = values[2] as string;
        const customerName = (values[3] as string | null) ?? null;
        const metadata = JSON.parse(values[4] as string) as Record<string, unknown>;

        const id = `conv-${conversations.size + 1}`;
        const record: ConversationRecord = {
          id,
          organizationId: orgId,
          channelId,
          customerPhone,
          customerName,
          status: "new",
          priority: "medium",
          assignedToUserId: null,
          queueId: null,
          teamId: null,
          waitingReason: null,
          botPaused: false,
          firstResponseDueAt: null,
          resolutionDueAt: null,
          resolvedAt: null,
          firstRespondedAt: null,
          slaPausedAt: null,
          firstResponseRemainingSeconds: null,
          resolutionRemainingSeconds: null,
          version: 1,
          lastMessageAt: new Date(),
          lastInboundAt: null,
          metadata,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        conversations.set(id, record);
        return { rows: [record], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      if (
        sql.includes("SELECT") &&
        sql.includes("FROM flowdesk.conversations WHERE organization_id = $1 AND id = $2")
      ) {
        const orgId = values[0] as string;
        const id = values[1] as string;
        const c = conversations.get(id);
        if (c && c.organizationId === orgId) {
          return { rows: [c], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      if (sql.includes("UPDATE flowdesk.conversations SET status = $1")) {
        const targetStatus = values[0] as ConversationRecord["status"];
        const id = values[1] as string;
        const orgId = values[2] as string;
        const expectedVersion = values[3] as number;

        const c = conversations.get(id);
        if (c && c.organizationId === orgId && c.version === expectedVersion) {
          c.status = targetStatus;
          c.version += 1;
          c.updatedAt = new Date();
          return { rows: [c], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "UPDATE", oid: 0, fields: [] };
      }

      if (sql.includes("UPDATE flowdesk.conversations SET assigned_to_user_id = $1")) {
        const targetUser = (values[0] as string | null) ?? null;
        const id = values[1] as string;
        const orgId = values[2] as string;
        const expectedVersion = values[3] as number;

        const c = conversations.get(id);
        if (c && c.organizationId === orgId && c.version === expectedVersion) {
          c.assignedToUserId = targetUser;
          c.version += 1;
          c.updatedAt = new Date();
          return { rows: [c], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "UPDATE", oid: 0, fields: [] };
      }

      if (sql.includes("INSERT INTO flowdesk.messages")) {
        const id = `msg-${messages.size + 1}`;
        const record: MessageRecord = {
          id,
          organizationId: values[0] as string,
          conversationId: values[1] as string,
          channelId: values[2] as string,
          direction: values[3] as "inbound" | "outbound",
          senderType: values[4] as "customer" | "agent" | "system" | "bot",
          senderUserId: (values[5] as string | null) ?? null,
          providerMessageId: (values[6] as string | null) ?? null,
          content: values[7] as string,
          status: values[8] as "queued" | "sent" | "delivered" | "read" | "failed",
          metadata: JSON.parse(values[9] as string) as Record<string, unknown>,
          sentAt: (values[10] as Date | null) ?? new Date(),
          deliveredAt: null,
          readAt: null,
          errorDetail: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        messages.set(id, record);
        return { rows: [record], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      if (sql.includes("UPDATE flowdesk.conversations SET last_message_at = clock_timestamp()")) {
        const convId = values[0] as string;
        const orgId = values[1] as string;
        const c = conversations.get(convId);
        if (c && c.organizationId === orgId) {
          c.lastMessageAt = new Date();
          if (sql.includes("THEN 'open'")) {
            if (c.status === "closed" || c.status === "resolved") {
              c.status = "open";
            }
          }
          c.updatedAt = new Date();
        }
        return { rows: [], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
      }

      if (
        sql.includes("SELECT") &&
        sql.includes("FROM flowdesk.messages WHERE id = $1 AND organization_id = $2")
      ) {
        const id = values[0] as string;
        const orgId = values[1] as string;
        const m = messages.get(id);
        if (m && m.organizationId === orgId) {
          return { rows: [m], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      if (sql.includes("UPDATE flowdesk.messages SET status = $1")) {
        const targetStatus = values[0] as MessageRecord["status"];
        const id = values[1] as string;
        const providerMessageId = (values[2] as string | null) ?? null;
        const sentAt = (values[3] as Date | null) ?? null;
        const deliveredAt = (values[4] as Date | null) ?? null;
        const readAt = (values[5] as Date | null) ?? null;
        const errorDetail = (values[6] as string | null) ?? null;
        const orgId = values[7] as string;

        const m = messages.get(id);
        if (m && m.organizationId === orgId) {
          m.status = targetStatus;
          if (providerMessageId) m.providerMessageId = providerMessageId;
          if (sentAt) m.sentAt = sentAt;
          if (deliveredAt) m.deliveredAt = deliveredAt;
          if (readAt) m.readAt = readAt;
          if (errorDetail) m.errorDetail = errorDetail;
          m.updatedAt = new Date();
          return { rows: [m], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "UPDATE", oid: 0, fields: [] };
      }

      if (
        sql.includes("SELECT") &&
        sql.includes("FROM flowdesk.messages WHERE organization_id = $1 AND conversation_id = $2")
      ) {
        const orgId = values[0] as string;
        const convId = values[1] as string;
        const matching = Array.from(messages.values()).filter(
          (m) => m.organizationId === orgId && m.conversationId === convId
        );
        return { rows: matching, rowCount: matching.length, command: "SELECT", oid: 0, fields: [] };
      }

      return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
    }
  } as unknown as DbClient;

  return { db, conversations, messages };
}

describe("Conversations & Messages Repository (M2-05)", () => {
  const orgId = "org-0001";
  const channelId = "chan-0001";

  it("finds or creates a conversation", async () => {
    const { db, conversations } = createMockConversationDb();

    const created = await findOrCreateConversation(db, {
      organizationId: orgId,
      channelId,
      customerPhone: "+628123456789",
      customerName: "John Doe"
    });

    expect(created.id).toBe("conv-1");
    expect(created.status).toBe("new");
    expect(created.version).toBe(1);
    expect(conversations.size).toBe(1);

    // Calling again returns the existing conversation without creating a new one
    const existing = await findOrCreateConversation(db, {
      organizationId: orgId,
      channelId,
      customerPhone: "+628123456789"
    });

    expect(existing.id).toBe("conv-1");
    expect(conversations.size).toBe(1);
  });

  it("retrieves a conversation by ID within tenant scope", async () => {
    const { db } = createMockConversationDb();
    const conv = await findOrCreateConversation(db, {
      organizationId: orgId,
      channelId,
      customerPhone: "+628123456789"
    });

    const fetched = await getConversationById(db, orgId, conv.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.customerPhone).toBe("+628123456789");

    // Foreign organization cannot retrieve
    const foreign = await getConversationById(db, "org-other", conv.id);
    expect(foreign).toBeNull();
  });

  it("transitions status and increments version", async () => {
    const { db } = createMockConversationDb();
    const conv = await findOrCreateConversation(db, {
      organizationId: orgId,
      channelId,
      customerPhone: "+628123456789"
    });

    // Valid transition: new -> open
    const updated = await updateConversationStatus(db, orgId, conv.id, 1, "open");
    expect(updated.status).toBe("open");
    expect(updated.version).toBe(2);

    // Invalid transition: open cannot transition to itself or illegal target throws
    await expect(updateConversationStatus(db, orgId, conv.id, 2, "new")).rejects.toThrow(
      "Invalid conversation status transition from 'open' to 'new'."
    );
  });

  it("guards against concurrent modification with OptimisticConcurrencyError", async () => {
    const { db } = createMockConversationDb();
    const conv = await findOrCreateConversation(db, {
      organizationId: orgId,
      channelId,
      customerPhone: "+628123456789"
    });

    // Attempting to update with stale version 99
    await expect(updateConversationStatus(db, orgId, conv.id, 99, "open")).rejects.toThrow(
      OptimisticConcurrencyError
    );
  });

  it("assigns an operator to a conversation", async () => {
    const { db } = createMockConversationDb();
    const conv = await findOrCreateConversation(db, {
      organizationId: orgId,
      channelId,
      customerPhone: "+628123456789"
    });

    const assigned = await assignConversation(db, orgId, conv.id, 1, "user-agent-1");
    expect(assigned.assignedToUserId).toBe("user-agent-1");
    expect(assigned.version).toBe(2);
  });

  it("creates messages and reopens closed conversations on inbound reply", async () => {
    const { db, conversations } = createMockConversationDb();
    const conv = await findOrCreateConversation(db, {
      organizationId: orgId,
      channelId,
      customerPhone: "+628123456789"
    });

    // Close conversation
    await updateConversationStatus(db, orgId, conv.id, 1, "closed");
    expect(conversations.get(conv.id)?.status).toBe("closed");

    // Inbound customer message arrives
    const msg = await createMessage(db, {
      organizationId: orgId,
      conversationId: conv.id,
      channelId,
      direction: "inbound",
      senderType: "customer",
      content: "I need help again"
    });

    expect(msg.direction).toBe("inbound");
    expect(msg.content).toBe("I need help again");
    // Conversation reopened!
    expect(conversations.get(conv.id)?.status).toBe("open");
  });

  it("updates message status through delivery and read", async () => {
    const { db } = createMockConversationDb();
    const conv = await findOrCreateConversation(db, {
      organizationId: orgId,
      channelId,
      customerPhone: "+628123456789"
    });

    const msg = await createMessage(db, {
      organizationId: orgId,
      conversationId: conv.id,
      channelId,
      direction: "outbound",
      senderType: "agent",
      content: "Here is your update",
      status: "queued"
    });

    expect(msg.status).toBe("queued");

    const sent = await updateMessageStatus(db, orgId, msg.id, "sent");
    expect(sent.status).toBe("sent");

    const delivered = await updateMessageStatus(db, orgId, msg.id, "delivered", {
      deliveredAt: new Date()
    });
    expect(delivered.status).toBe("delivered");
    expect(delivered.deliveredAt).not.toBeNull();

    const read = await updateMessageStatus(db, orgId, msg.id, "read", {
      readAt: new Date()
    });
    expect(read.status).toBe("read");
    expect(read.readAt).not.toBeNull();
  });

  it("lists messages for a conversation ordered chronologically", async () => {
    const { db } = createMockConversationDb();
    const conv = await findOrCreateConversation(db, {
      organizationId: orgId,
      channelId,
      customerPhone: "+628123456789"
    });

    await createMessage(db, {
      organizationId: orgId,
      conversationId: conv.id,
      channelId,
      direction: "inbound",
      senderType: "customer",
      content: "First"
    });

    await createMessage(db, {
      organizationId: orgId,
      conversationId: conv.id,
      channelId,
      direction: "outbound",
      senderType: "agent",
      content: "Second"
    });

    const list = await listMessagesByConversation(db, orgId, conv.id);
    expect(list.length).toBe(2);
    expect(list[0]?.content).toBe("First");
    expect(list[1]?.content).toBe("Second");
  });

  it("rejects outbound messages while a conversation is closed", async () => {
    const { db } = createMockConversationDb();
    const conv = await findOrCreateConversation(db, {
      organizationId: orgId,
      channelId,
      customerPhone: "+628123456789"
    });
    await updateConversationStatus(db, orgId, conv.id, conv.version, "closed");

    await expect(
      createOutboundMessageWithOutbox(db, {
        organizationId: orgId,
        conversationId: conv.id,
        senderUserId: "user-1",
        content: "must not send"
      })
    ).rejects.toBeInstanceOf(ClosedConversationError);
  });
});
