import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io as ClientSocket, type Socket as ClientSocketType } from "socket.io-client";
import { type RealtimeHint, type RealtimeReady } from "@flowdesk/contracts";
import type { DbClient } from "@flowdesk/db";
import { serializeSessionCookie } from "@flowdesk/security";
import { createRealtimeServer } from "./realtime.js";

const mockOrgId = "00000000-0000-7000-8000-000000000001";
const foreignOrgId = "00000000-0000-7000-8000-000000000099";
const mockUserId = "00000000-0000-7000-8000-000000000002";
const mockTeamId = "00000000-0000-7000-8000-000000000003";
const mockConversationId = "00000000-0000-7000-8000-000000000004";
const deniedConversationId = "00000000-0000-7000-8000-000000000005";
const validToken = "valid-session-token-xyz-12345";

function createMockDb(
  options: {
    sessionActive?: boolean;
    authorizedOrgs?: Set<string>;
    authorizedTeams?: Set<string>;
    authorizedConversations?: Set<string>;
    version?: number;
  } = {}
) {
  const {
    sessionActive = true,
    authorizedOrgs = new Set([mockOrgId]),
    authorizedTeams = new Set([mockTeamId]),
    authorizedConversations = new Set([mockConversationId]),
    version = 3
  } = options;

  const db = {
    async query(queryText: string, values: unknown[] = []) {
      await Promise.resolve();
      const sql = queryText.replace(/\s+/g, " ").trim();

      // Transaction / RLS
      if (sql.startsWith("BEGIN") || sql.startsWith("COMMIT") || sql.startsWith("ROLLBACK")) {
        return { rows: [], rowCount: 0, command: sql, oid: 0, fields: [] };
      }
      if (sql.includes("set_config('app.current_organization_id'")) {
        return { rows: [], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
      }

      // Session lookup
      if (sql.includes("flowdesk.auth_sessions") && sql.includes("token_hash = $1")) {
        if (!sessionActive) return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
        const session = {
          id: "session-1",
          user_id: mockUserId,
          email: "agent@flowdesk.test",
          display_name: "Agent Test",
          expires_at: new Date(Date.now() + 3600_000),
          created_at: new Date()
        };
        return { rows: [session], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
      }

      // Realtime versions
      if (sql.includes("flowdesk.realtime_versions")) {
        return { rows: [{ version }], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
      }

      // Organization access check
      if (sql.includes("FROM flowdesk.memberships WHERE organization_id = $1 AND user_id = $2")) {
        const targetOrg = values[0] as string;
        if (authorizedOrgs.has(targetOrg)) {
          return { rows: [{ id: "mem-1" }], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      // Team access check
      if (
        sql.includes("FROM flowdesk.memberships AS membership") &&
        sql.includes("team_member.team_id = $3")
      ) {
        const teamId = values[2] as string;
        if (authorizedTeams.has(teamId)) {
          return { rows: [{ id: "tmem-1" }], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      // Conversation access check
      if (
        sql.includes("FROM flowdesk.conversations AS conversation") &&
        sql.includes("conversation.id = $3")
      ) {
        const convId = values[2] as string;
        if (authorizedConversations.has(convId)) {
          return { rows: [{ id: "qmem-1" }], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
    }
  } as unknown as DbClient;

  return db;
}

describe("Socket.IO Realtime Server (M3-03)", () => {
  let httpServer: ReturnType<typeof createServer>;
  let realtimeServer: ReturnType<typeof createRealtimeServer>;
  let port: number;
  let clientSockets: ClientSocketType[] = [];

  beforeEach(async () => {
    httpServer = createServer();
    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => {
        port = (httpServer.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    for (const socket of clientSockets) {
      if (socket.connected) socket.disconnect();
    }
    clientSockets = [];
    if (realtimeServer) await realtimeServer.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  function createClient(options: {
    auth?: Record<string, unknown>;
    cookie?: string;
  }): ClientSocketType {
    const { auth, cookie } = options;
    const socketOptions: Parameters<typeof ClientSocket>[1] = {
      path: "/realtime",
      transports: ["websocket"],
      autoConnect: false
    };
    if (auth) socketOptions.auth = auth;
    if (cookie) socketOptions.extraHeaders = { cookie };
    const socket = ClientSocket(`http://127.0.0.1:${port}`, socketOptions);
    clientSockets.push(socket);
    return socket;
  }

  it("authenticates connection and emits realtime.ready with projection version", async () => {
    const db = createMockDb({ version: 7 });
    realtimeServer = createRealtimeServer(httpServer, { db });

    const cookie = serializeSessionCookie(validToken, false);
    const client = createClient({
      auth: { organizationId: mockOrgId, lastVersion: 7 },
      cookie
    });

    const readyPromise = new Promise<RealtimeReady>((resolve) => {
      client.on("realtime.ready", (data: RealtimeReady) => resolve(data));
    });

    client.connect();
    const ready = await readyPromise;

    expect(ready.schemaVersion).toBe(1);
    expect(ready.organizationId).toBe(mockOrgId);
    expect(ready.currentVersion).toBe(7);
    expect(ready.reconcileRequired).toBe(false);
  });

  it("signals reconcileRequired when client reconnects with a version gap", async () => {
    const db = createMockDb({ version: 12 });
    realtimeServer = createRealtimeServer(httpServer, { db });

    const cookie = serializeSessionCookie(validToken, false);
    const client = createClient({
      auth: { organizationId: mockOrgId, lastVersion: 5 }, // Client has version 5, server has 12
      cookie
    });

    const readyPromise = new Promise<RealtimeReady>((resolve) => {
      client.on("realtime.ready", (data: RealtimeReady) => resolve(data));
    });

    client.connect();
    const ready = await readyPromise;

    expect(ready.currentVersion).toBe(12);
    expect(ready.reconcileRequired).toBe(true);
  });

  it("rejects connection when handshake auth payload is missing or invalid", async () => {
    const db = createMockDb();
    realtimeServer = createRealtimeServer(httpServer, { db });

    const cookie = serializeSessionCookie(validToken, false);
    const client = createClient({
      auth: { invalidField: true },
      cookie
    });

    const errorPromise = new Promise<string>((resolve) => {
      client.on("connect_error", (err) => resolve(err.message));
    });

    client.connect();
    const errorMsg = await errorPromise;
    expect(errorMsg).toBe("INVALID_REALTIME_AUTH");
  });

  it("rejects connection when session cookie is absent", async () => {
    const db = createMockDb();
    realtimeServer = createRealtimeServer(httpServer, { db });

    const client = createClient({
      auth: { organizationId: mockOrgId }
      // No cookie
    });

    const errorPromise = new Promise<string>((resolve) => {
      client.on("connect_error", (err) => resolve(err.message));
    });

    client.connect();
    const errorMsg = await errorPromise;
    expect(errorMsg).toBe("UNAUTHORIZED");
  });

  it("rejects connection when session is expired or revoked", async () => {
    const db = createMockDb({ sessionActive: false });
    realtimeServer = createRealtimeServer(httpServer, { db });

    const cookie = serializeSessionCookie(validToken, false);
    const client = createClient({
      auth: { organizationId: mockOrgId },
      cookie
    });

    const errorPromise = new Promise<string>((resolve) => {
      client.on("connect_error", (err) => resolve(err.message));
    });

    client.connect();
    const errorMsg = await errorPromise;
    expect(errorMsg).toBe("SESSION_EXPIRED");
  });

  it("rejects connection when user lacks access to the organization", async () => {
    const db = createMockDb({ authorizedOrgs: new Set([mockOrgId]) });
    realtimeServer = createRealtimeServer(httpServer, { db });

    const cookie = serializeSessionCookie(validToken, false);
    const client = createClient({
      auth: { organizationId: foreignOrgId },
      cookie
    });

    const errorPromise = new Promise<string>((resolve) => {
      client.on("connect_error", (err) => resolve(err.message));
    });

    client.connect();
    const errorMsg = await errorPromise;
    expect(errorMsg).toBe("ORGANIZATION_ACCESS_DENIED");
  });

  it("authorizes team and conversation room join requests server-side", async () => {
    const db = createMockDb();
    realtimeServer = createRealtimeServer(httpServer, { db });

    const cookie = serializeSessionCookie(validToken, false);
    const client = createClient({
      auth: { organizationId: mockOrgId },
      cookie
    });

    await new Promise<void>((resolve) => {
      client.on("realtime.ready", () => resolve());
      client.connect();
    });

    // 1. Join valid team room
    const teamJoinAck = await new Promise<{ ok: boolean; code?: string }>((resolve) => {
      client.emit("room.join", { type: "team", id: mockTeamId }, resolve);
    });
    expect(teamJoinAck.ok).toBe(true);

    // 2. Join valid conversation room
    const convJoinAck = await new Promise<{ ok: boolean; code?: string }>((resolve) => {
      client.emit("room.join", { type: "conversation", id: mockConversationId }, resolve);
    });
    expect(convJoinAck.ok).toBe(true);

    // 3. Deny foreign/unauthorized conversation room
    const deniedConvAck = await new Promise<{ ok: boolean; code?: string }>((resolve) => {
      client.emit("room.join", { type: "conversation", id: deniedConversationId }, resolve);
    });
    expect(deniedConvAck.ok).toBe(false);
    expect(deniedConvAck.code).toBe("ROOM_ACCESS_DENIED");

    // 4. Reject invalid room request payload (e.g. organization room join attempt)
    const invalidRoomAck = await new Promise<{ ok: boolean; code?: string }>((resolve) => {
      client.emit("room.join", { type: "organization" }, resolve);
    });
    expect(invalidRoomAck.ok).toBe(false);
    expect(invalidRoomAck.code).toBe("INVALID_ROOM");
  });

  it("publishes schema-versioned hints without customer PII or message bodies", async () => {
    const db = createMockDb({ version: 9 });
    realtimeServer = createRealtimeServer(httpServer, { db });

    const cookie = serializeSessionCookie(validToken, false);
    const client = createClient({
      auth: { organizationId: mockOrgId },
      cookie
    });

    await new Promise<void>((resolve) => {
      client.on("realtime.ready", () => resolve());
      client.connect();
    });

    // Join conversation room
    const joinAck = await new Promise<{ ok: boolean; code?: string }>((resolve) => {
      client.emit(
        "room.join",
        { type: "conversation", id: mockConversationId },
        (res: { ok: boolean; code?: string }) => resolve(res)
      );
    });
    expect(joinAck.ok).toBe(true);

    const receivedHints: RealtimeHint[] = [];
    client.on("projection.changed", (hint: RealtimeHint) => {
      receivedHints.push(hint);
    });

    // Server publishes hint
    await realtimeServer.publishHint({
      organizationId: mockOrgId,
      resourceType: "conversation",
      resourceId: mockConversationId,
      conversationId: mockConversationId
    });

    // Wait for event delivery
    await new Promise((r) => setTimeout(r, 100));

    expect(receivedHints.length).toBeGreaterThanOrEqual(1);
    const convHint = receivedHints.find((h) => h.resourceType === "conversation");
    expect(convHint).toBeDefined();
    expect(convHint!.schemaVersion).toBe(1);
    expect(convHint!.resourceId).toBe(mockConversationId);
    expect(convHint!.version).toBe(9);

    // Verify hint strictly contains NO payload content or message body
    expect(convHint).not.toHaveProperty("content");
    expect(convHint).not.toHaveProperty("body");
    expect(convHint).not.toHaveProperty("customerPhone");
    expect(convHint).not.toHaveProperty("text");
  });

  it("disconnects active socket when session is revoked during periodic recheck", async () => {
    let sessionValid = true;
    const db = {
      async query(queryText: string) {
        await Promise.resolve();
        const sql = queryText.replace(/\s+/g, " ").trim();

        if (sql.includes("set_config('app.current_organization_id'")) {
          return { rows: [], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
        }
        if (sql.includes("flowdesk.auth_sessions") && sql.includes("token_hash = $1")) {
          if (!sessionValid)
            return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
          return {
            rows: [
              {
                id: "session-1",
                user_id: mockUserId,
                email: "agent@flowdesk.test",
                display_name: "Agent Test",
                expires_at: new Date(Date.now() + 3600_000),
                created_at: new Date()
              }
            ],
            rowCount: 1,
            command: "SELECT",
            oid: 0,
            fields: []
          };
        }
        if (sql.includes("flowdesk.realtime_versions")) {
          return { rows: [{ version: 1 }], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
        }
        if (sql.includes("FROM flowdesk.memberships WHERE organization_id = $1 AND user_id = $2")) {
          return { rows: [{ id: "mem-1" }], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }
    } as unknown as DbClient;

    realtimeServer = createRealtimeServer(httpServer, {
      db,
      authorizationRecheckMs: 50 // fast re-check interval for testing
    });

    const cookie = serializeSessionCookie(validToken, false);
    const client = createClient({
      auth: { organizationId: mockOrgId },
      cookie
    });

    await new Promise<void>((resolve) => {
      client.on("realtime.ready", () => resolve());
      client.connect();
    });

    const revokedPromise = new Promise<{ code: string }>((resolve) => {
      client.on("access.revoked", (data: { code: string }) => resolve(data));
    });

    // Simulate session revocation
    sessionValid = false;

    const revoked = await revokedPromise;
    expect(revoked.code).toBe("SESSION_REVOKED");

    await new Promise((r) => setTimeout(r, 50));
    expect(client.connected).toBe(false);
  });

  it("throws when redisRequired is set but redisUrl is omitted", async () => {
    const db = createMockDb();
    const server = createRealtimeServer(httpServer, {
      db,
      redisRequired: true
    });
    await expect(server.ready).rejects.toThrow("REDIS_URL is required for realtime fan-out.");
    await server.close();
  });

  it("connects to Redis adapter when redisUrl is provided", async () => {
    const db = createMockDb();
    const server = createRealtimeServer(httpServer, {
      db,
      redisUrl: "redis://localhost:6379"
    });
    await expect(server.ready).resolves.toBeUndefined();
    await server.close();
  });
});
