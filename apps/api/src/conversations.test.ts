import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadAuthConfig } from "@flowdesk/config";
import type { DbClient } from "@flowdesk/db";
import { MockIdentityProvider } from "@flowdesk/providers";
import { hashSessionToken, serializeSessionCookie } from "@flowdesk/security";
import { createApiApp } from "./app.js";

const orgId = "00000000-0000-7000-8000-000000000001";
const channelId = "00000000-0000-7000-8000-000000000002";
const aliceId = "00000000-0000-7000-8000-000000000003"; // Supervisor
const bobId = "00000000-0000-7000-8000-000000000004"; // Agent
const charlieId = "00000000-0000-7000-8000-000000000005"; // Analyst

interface MockConversation {
  id: string;
  organizationId: string;
  channelId: string;
  customerPhone: string;
  customerName: string | null;
  status: string;
  priority: string;
  assignedToUserId: string | null;
  version: number;
  lastMessageAt: Date;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface MockMessage {
  id: string;
  organizationId: string;
  conversationId: string;
  channelId: string;
  direction: string;
  senderType: string;
  senderUserId: string | null;
  providerMessageId: string | null;
  content: string;
  status: string;
  errorDetail: string | null;
  metadata: Record<string, unknown>;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function createConversationsMockDb() {
  const users = new Map<
    string,
    { id: string; email: string; displayName: string; status: string }
  >();
  const sessions = new Map<
    string,
    { id: string; userId: string; tokenHash: string; expiresAt: Date; revokedAt: Date | null }
  >();
  const memberRoles = new Map<string, { membershipId: string; roleKey: string }>();
  const conversations = new Map<string, MockConversation>();
  const messages = new Map<string, MockMessage>();
  const outboxEvents: Array<{
    id: string;
    eventType: string;
    aggregateId: string;
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

  // Initial mock conversation
  const convId = "00000000-0000-7000-8000-000000000010";
  conversations.set(convId, {
    id: convId,
    organizationId: orgId,
    channelId,
    customerPhone: "628123456789",
    customerName: "Budi Santoso",
    status: "open",
    priority: "medium",
    assignedToUserId: null,
    version: 1,
    lastMessageAt: new Date(),
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date()
  });

  // Initial mock message
  const msgId = "00000000-0000-7000-8000-000000000020";
  messages.set(msgId, {
    id: msgId,
    organizationId: orgId,
    conversationId: convId,
    channelId,
    direction: "inbound",
    senderType: "customer",
    senderUserId: null,
    providerMessageId: "wamid.test.1",
    content: "Halo admin, butuh bantuan.",
    status: "delivered",
    errorDetail: null,
    metadata: {},
    sentAt: new Date(),
    deliveredAt: new Date(),
    readAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const db = {
    async query(queryText: string, values: unknown[] = []) {
      await Promise.resolve();
      const sql = queryText.replace(/\s+/g, " ").trim();

      // Auth Session lookup
      if (sql.includes("FROM flowdesk.auth_sessions s JOIN flowdesk.users u")) {
        const [tokenHash] = values as [string];
        const session = sessions.get(tokenHash);
        if (!session || session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) {
          return { rows: [] };
        }
        const user = users.get(session.userId);
        if (!user || user.status !== "active") {
          return { rows: [] };
        }
        return {
          rows: [
            {
              id: session.id,
              user_id: session.userId,
              email: user.email,
              display_name: user.displayName,
              expires_at: session.expiresAt,
              created_at: new Date()
            }
          ]
        };
      }

      // Member role lookup
      if (sql.includes("FROM flowdesk.memberships m") && sql.includes("JOIN flowdesk.roles r")) {
        const [targetOrgId, targetUserId] = values as [string, string];
        const member = memberRoles.get(`${targetOrgId}:${targetUserId}`);
        if (!member) return { rows: [] };
        return {
          rows: [{ id: member.membershipId, role_key: member.roleKey, status: "active" }]
        };
      }

      // List conversations
      if (
        sql.includes("FROM flowdesk.conversations WHERE") &&
        sql.includes("ORDER BY last_message_at DESC, id DESC")
      ) {
        let matching = Array.from(conversations.values()).filter(
          (c) => c.organizationId === values[0]
        );

        if (sql.includes("status = $2")) {
          const targetStatus = values[1] as string;
          matching = matching.filter((c) => c.status === targetStatus);
        }

        if (sql.includes("assigned_to_user_id IS NULL")) {
          matching = matching.filter((c) => c.assignedToUserId === null);
        } else if (sql.includes("assigned_to_user_id = $")) {
          const targetUser = values.find(
            (v) => typeof v === "string" && v.startsWith("00000000-0000-7000-8000-")
          );
          matching = matching.filter((c) => c.assignedToUserId === targetUser);
        }

        const limitVal = values[values.length - 1] as number;
        const rows = matching.slice(0, limitVal).map((c) => ({
          id: c.id,
          organizationId: c.organizationId,
          channelId: c.channelId,
          customerPhone: c.customerPhone,
          customerName: c.customerName,
          status: c.status,
          priority: c.priority,
          assignedToUserId: c.assignedToUserId,
          version: c.version,
          lastMessageAt: c.lastMessageAt,
          metadata: c.metadata,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt
        }));

        return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
      }

      // Get conversation by ID
      if (
        sql.includes("SELECT") &&
        sql.includes("FROM flowdesk.conversations WHERE organization_id = $1 AND id = $2")
      ) {
        const [targetOrg, targetId] = values as [string, string];
        const c = conversations.get(targetId);
        if (c && c.organizationId === targetOrg) {
          return {
            rows: [
              {
                id: c.id,
                organizationId: c.organizationId,
                channelId: c.channelId,
                customerPhone: c.customerPhone,
                customerName: c.customerName,
                status: c.status,
                priority: c.priority,
                assignedToUserId: c.assignedToUserId,
                version: c.version,
                lastMessageAt: c.lastMessageAt,
                metadata: c.metadata,
                createdAt: c.createdAt,
                updatedAt: c.updatedAt
              }
            ],
            rowCount: 1,
            command: "SELECT",
            oid: 0,
            fields: []
          };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      // List messages by conversation
      if (
        sql.includes("FROM flowdesk.messages WHERE organization_id = $1 AND conversation_id = $2")
      ) {
        const [targetOrg, targetConv] = values as [string, string];
        const matching = Array.from(messages.values())
          .filter((m) => m.organizationId === targetOrg && m.conversationId === targetConv)
          .map((m) => ({
            id: m.id,
            organizationId: m.organizationId,
            conversationId: m.conversationId,
            channelId: m.channelId,
            direction: m.direction,
            senderType: m.senderType,
            senderUserId: m.senderUserId,
            providerMessageId: m.providerMessageId,
            content: m.content,
            status: m.status,
            errorDetail: m.errorDetail,
            metadata: m.metadata,
            sentAt: m.sentAt,
            deliveredAt: m.deliveredAt,
            readAt: m.readAt,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt
          }));

        return { rows: matching, rowCount: matching.length, command: "SELECT", oid: 0, fields: [] };
      }

      // Update conversation
      if (sql.includes("UPDATE flowdesk.conversations")) {
        const id = values[values.length - 3] as string;
        const targetOrg = values[values.length - 2] as string;
        const expectedVer = values[values.length - 1] as number;

        const c = conversations.get(id);
        if (c && c.organizationId === targetOrg && c.version === expectedVer) {
          if (sql.includes("status = $1")) {
            c.status = values[0] as string;
          }
          if (sql.includes("assigned_to_user_id = $")) {
            const assignIdx = sql.includes("status = $1") ? 1 : 0;
            c.assignedToUserId = (values[assignIdx] as string | null) ?? null;
          }
          c.version += 1;
          c.updatedAt = new Date();

          return {
            rows: [
              {
                id: c.id,
                organizationId: c.organizationId,
                channelId: c.channelId,
                customerPhone: c.customerPhone,
                customerName: c.customerName,
                status: c.status,
                priority: c.priority,
                assignedToUserId: c.assignedToUserId,
                version: c.version,
                lastMessageAt: c.lastMessageAt,
                metadata: c.metadata,
                createdAt: c.createdAt,
                updatedAt: c.updatedAt
              }
            ],
            rowCount: 1,
            command: "UPDATE",
            oid: 0,
            fields: []
          };
        }
        return { rows: [], rowCount: 0, command: "UPDATE", oid: 0, fields: [] };
      }

      // Insert message
      if (sql.includes("INSERT INTO flowdesk.messages")) {
        const newMsgId = `00000000-0000-7000-8000-${String(messages.size + 21).padStart(12, "0")}`;
        const newMsg: MockMessage = {
          id: newMsgId,
          organizationId: values[0] as string,
          conversationId: values[1] as string,
          channelId: values[2] as string,
          direction: values[3] as string,
          senderType: values[4] as string,
          senderUserId: (values[5] as string | null) ?? null,
          providerMessageId: (values[6] as string | null) ?? null,
          content: values[7] as string,
          status: values[8] as string,
          errorDetail: null,
          metadata: JSON.parse(values[9] as string) as Record<string, unknown>,
          sentAt: (values[10] as Date | null) ?? new Date(),
          deliveredAt: null,
          readAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        messages.set(newMsgId, newMsg);

        return {
          rows: [
            {
              id: newMsg.id,
              organizationId: newMsg.organizationId,
              conversationId: newMsg.conversationId,
              channelId: newMsg.channelId,
              direction: newMsg.direction,
              senderType: newMsg.senderType,
              senderUserId: newMsg.senderUserId,
              providerMessageId: newMsg.providerMessageId,
              content: newMsg.content,
              status: newMsg.status,
              errorDetail: newMsg.errorDetail,
              metadata: newMsg.metadata,
              sentAt: newMsg.sentAt,
              deliveredAt: newMsg.deliveredAt,
              readAt: newMsg.readAt,
              createdAt: newMsg.createdAt,
              updatedAt: newMsg.updatedAt
            }
          ],
          rowCount: 1,
          command: "INSERT",
          oid: 0,
          fields: []
        };
      }

      // Insert outbox event
      if (sql.includes("INSERT INTO flowdesk.outbox_events")) {
        outboxEvents.push({
          id: `outbox-${outboxEvents.length + 1}`,
          eventType: "message.outbound.created",
          aggregateId: values[1] as string,
          payload: JSON.parse(values[2] as string) as Record<string, unknown>
        });
        return { rows: [], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
    }
  } as unknown as DbClient;

  return { db, conversations, messages, outboxEvents };
}

describe("Conversations & Messages API (M2-07)", () => {
  const { db, outboxEvents } = createConversationsMockDb();
  const config = loadAuthConfig();
  const idp = new MockIdentityProvider();
  const app = createApiApp({
    service: "api",
    version: "1.0.0",
    gitSha: "test",
    environment: "local",
    auth: { db, config, identityProvider: idp }
  });

  const aliceCookie = serializeSessionCookie("alice-token", false);
  const bobCookie = serializeSessionCookie("bob-token", false);
  const charlieCookie = serializeSessionCookie("charlie-token", false);

  const convId = "00000000-0000-7000-8000-000000000010";

  describe("GET /api/v1/organizations/:orgId/conversations", () => {
    it("returns 401 when no session cookie is provided", async () => {
      const response = await request(app).get(`/api/v1/organizations/${orgId}/conversations`);
      expect(response.status).toBe(401);
      const body = response.body as { code: string };
      expect(body.code).toBe("UNAUTHORIZED");
    });

    it("returns 403 when user is not a member of the organization", async () => {
      const otherOrg = "00000000-0000-7000-8000-999999999999";
      const response = await request(app)
        .get(`/api/v1/organizations/${otherOrg}/conversations`)
        .set("Cookie", aliceCookie);
      expect(response.status).toBe(403);
      const body = response.body as { code: string };
      expect(body.code).toBe("NOT_A_MEMBER");
    });

    it("returns 200 with list of conversations and nextCursor", async () => {
      const response = await request(app)
        .get(`/api/v1/organizations/${orgId}/conversations`)
        .set("Cookie", aliceCookie);

      expect(response.status).toBe(200);
      const body = response.body as { items: Array<{ id: string; customerPhone: string }> };
      expect(body.items).toBeInstanceOf(Array);
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.items[0]?.id).toBe(convId);
      expect(body.items[0]?.customerPhone).toBe("628123456789");
    });

    it("filters conversations by status and assignee", async () => {
      const response = await request(app)
        .get(`/api/v1/organizations/${orgId}/conversations?status=open&assignedTo=unassigned`)
        .set("Cookie", bobCookie);

      expect(response.status).toBe(200);
      const body = response.body as { items: Array<{ id: string }> };
      expect(body.items.length).toBe(1);
    });
  });

  describe("GET /api/v1/organizations/:orgId/conversations/:id", () => {
    it("returns 404 when conversation does not exist", async () => {
      const nonExistent = "00000000-0000-7000-8000-000000000099";
      const response = await request(app)
        .get(`/api/v1/organizations/${orgId}/conversations/${nonExistent}`)
        .set("Cookie", aliceCookie);

      expect(response.status).toBe(404);
      const body = response.body as { code: string };
      expect(body.code).toBe("CONVERSATION_NOT_FOUND");
    });

    it("returns 200 with conversation details and full message timeline", async () => {
      const response = await request(app)
        .get(`/api/v1/organizations/${orgId}/conversations/${convId}`)
        .set("Cookie", bobCookie);

      expect(response.status).toBe(200);
      const body = response.body as {
        conversation: { id: string };
        messages: Array<{ content: string; direction: string }>;
      };
      expect(body.conversation.id).toBe(convId);
      expect(body.messages).toBeInstanceOf(Array);
      expect(body.messages.length).toBe(1);
      expect(body.messages[0]?.content).toBe("Halo admin, butuh bantuan.");
      expect(body.messages[0]?.direction).toBe("inbound");
    });
  });

  describe("PATCH /api/v1/organizations/:orgId/conversations/:id", () => {
    it("returns 400 on invalid status progression", async () => {
      // open cannot jump directly to 'new'
      const response = await request(app)
        .patch(`/api/v1/organizations/${orgId}/conversations/${convId}`)
        .set("Cookie", aliceCookie)
        .send({
          version: 1,
          status: "new"
        });

      expect(response.status).toBe(400);
      const body = response.body as { code: string };
      expect(body.code).toBe("INVALID_STATUS_TRANSITION");
    });

    it("returns 409 Conflict when optimistic concurrency version does not match", async () => {
      const response = await request(app)
        .patch(`/api/v1/organizations/${orgId}/conversations/${convId}`)
        .set("Cookie", aliceCookie)
        .send({
          version: 999, // Stale version
          status: "resolved"
        });

      expect(response.status).toBe(409);
      const body = response.body as { code: string };
      expect(body.code).toBe("OPTIMISTIC_CONCURRENCY_CONFLICT");
    });

    it("returns 403 when agent without conversation:resolve tries to resolve", async () => {
      const response = await request(app)
        .patch(`/api/v1/organizations/${orgId}/conversations/${convId}`)
        .set("Cookie", bobCookie) // Bob is agent
        .send({
          version: 1,
          status: "resolved"
        });

      expect(response.status).toBe(403);
      const body = response.body as { code: string };
      expect(body.code).toBe("FORBIDDEN");
    });

    it("returns 200 when supervisor resolves conversation and increments version", async () => {
      const response = await request(app)
        .patch(`/api/v1/organizations/${orgId}/conversations/${convId}`)
        .set("Cookie", aliceCookie) // Alice is supervisor
        .send({
          version: 1,
          status: "resolved"
        });

      expect(response.status).toBe(200);
      const body = response.body as { status: string; version: number };
      expect(body.status).toBe("resolved");
      expect(body.version).toBe(2);
    });
  });

  describe("POST /api/v1/organizations/:orgId/conversations/:id/messages", () => {
    it("requires an Idempotency-Key for outbound sends", async () => {
      const response = await request(app)
        .post(`/api/v1/organizations/${orgId}/conversations/${convId}/messages`)
        .set("Cookie", bobCookie)
        .send({ content: "This must not be queued twice" });

      expect(response.status).toBe(400);
      expect((response.body as { code: string }).code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    });

    it("returns 400 on empty message content", async () => {
      const response = await request(app)
        .post(`/api/v1/organizations/${orgId}/conversations/${convId}/messages`)
        .set("Cookie", bobCookie)
        .send({ content: "   " });

      expect(response.status).toBe(400);
      const body = response.body as { code: string };
      expect(body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 403 when analyst tries to send message (no message:send)", async () => {
      const response = await request(app)
        .post(`/api/v1/organizations/${orgId}/conversations/${convId}/messages`)
        .set("Cookie", charlieCookie) // Charlie is analyst
        .send({ content: "Unauthorized message" });

      expect(response.status).toBe(403);
      const body = response.body as { code: string };
      expect(body.code).toBe("FORBIDDEN");
    });

    it("returns 201 when agent posts outbound reply, creating outbox event", async () => {
      const initialOutboxCount = outboxEvents.length;

      const response = await request(app)
        .post(`/api/v1/organizations/${orgId}/conversations/${convId}/messages`)
        .set("Cookie", bobCookie)
        .set("Idempotency-Key", "reply-001")
        .send({ content: "Selamat siang! Ada yang bisa kami bantu?" });

      expect(response.status).toBe(201);
      const body = response.body as {
        id: string;
        direction: string;
        senderType: string;
        senderUserId: string | null;
        status: string;
        content: string;
      };
      expect(body.direction).toBe("outbound");
      expect(body.senderType).toBe("agent");
      expect(body.senderUserId).toBe(bobId);
      expect(body.status).toBe("queued");
      expect(body.content).toBe("Selamat siang! Ada yang bisa kami bantu?");

      // Verify transactional outbox event was created
      expect(outboxEvents.length).toBe(initialOutboxCount + 1);
      const createdEvent = outboxEvents[outboxEvents.length - 1]!;
      expect(createdEvent.eventType).toBe("message.outbound.created");
      expect(createdEvent.aggregateId).toBe(body.id);
    });
  });
});
