import type { Server as HttpServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import {
  RealtimeConnectAuthSchema,
  RealtimeHintSchema,
  RealtimeReadySchema,
  RealtimeRoomRequestSchema,
  type RealtimeHint,
  type RealtimeRoomRequest
} from "@flowdesk/contracts";
import {
  canAccessRealtimeRoom,
  getActiveSessionByTokenHash,
  getRealtimeVersion,
  runInTenantTransaction,
  type DbClient,
  type RealtimeRoom
} from "@flowdesk/db";
import {
  recordRealtimeAuthorizationDenial,
  recordRealtimeConnection,
  recordRealtimeDroppedHint,
  recordRealtimeReconnectGap
} from "@flowdesk/observability";
import { hashSessionToken, parseSessionCookie } from "@flowdesk/security";
import { createClient, type RedisClientType } from "redis";
import { Server as SocketIOServer, type Socket } from "socket.io";

interface RealtimeSocketData {
  organizationId: string;
  userId: string;
  tokenHash: string;
  authorizedRooms: Map<string, RealtimeRoom>;
}

export interface RealtimeServerOptions {
  db: DbClient;
  redisUrl?: string | undefined;
  redisRequired?: boolean | undefined;
  authorizationRecheckMs?: number | undefined;
}

export interface PublishRealtimeHintInput {
  organizationId: string;
  resourceType: RealtimeHint["resourceType"];
  resourceId: string;
  conversationId?: string | undefined;
  teamId?: string | null | undefined;
}

function roomName(organizationId: string, room: RealtimeRoom): string {
  if (room.type === "organization") return `organization:${organizationId}`;
  return `${room.type}:${organizationId}:${room.id}`;
}

async function isAuthorized(
  db: DbClient,
  organizationId: string,
  userId: string,
  room: RealtimeRoom
): Promise<boolean> {
  return runInTenantTransaction(db, { organizationId }, (client) =>
    canAccessRealtimeRoom(client, { organizationId, userId, room })
  );
}

export function createRealtimeServer(httpServer: HttpServer, options: RealtimeServerOptions) {
  const io = new SocketIOServer(httpServer, {
    path: "/realtime",
    serveClient: false,
    maxHttpBufferSize: 16 * 1024,
    perMessageDeflate: false,
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60_000,
      skipMiddlewares: false
    }
  });
  let publisher: RedisClientType | undefined;
  let subscriber: RedisClientType | undefined;

  const ready = (async () => {
    if (!options.redisUrl) {
      if (options.redisRequired) throw new Error("REDIS_URL is required for realtime fan-out.");
      return;
    }
    publisher = createClient({ url: options.redisUrl });
    subscriber = publisher.duplicate();
    await Promise.all([publisher.connect(), subscriber.connect()]);
    io.adapter(createAdapter(publisher, subscriber));
  })();

  io.use((socket, next) => {
    void (async () => {
      try {
        const connect = RealtimeConnectAuthSchema.safeParse(socket.handshake.auth);
        if (!connect.success) {
          recordRealtimeAuthorizationDenial("handshake");
          return next(new Error("INVALID_REALTIME_AUTH"));
        }
        const token = parseSessionCookie(socket.handshake.headers.cookie);
        if (!token) {
          recordRealtimeAuthorizationDenial("session");
          return next(new Error("UNAUTHORIZED"));
        }
        const tokenHash = hashSessionToken(token);
        const session = await getActiveSessionByTokenHash(options.db, tokenHash);
        if (!session) {
          recordRealtimeAuthorizationDenial("session");
          return next(new Error("SESSION_EXPIRED"));
        }
        const organizationRoom: RealtimeRoom = { type: "organization" };
        if (
          !(await isAuthorized(
            options.db,
            connect.data.organizationId,
            session.userId,
            organizationRoom
          ))
        ) {
          recordRealtimeAuthorizationDenial("organization");
          return next(new Error("ORGANIZATION_ACCESS_DENIED"));
        }
        socket.data = {
          organizationId: connect.data.organizationId,
          userId: session.userId,
          tokenHash,
          authorizedRooms: new Map([
            [roomName(connect.data.organizationId, organizationRoom), organizationRoom]
          ])
        } satisfies RealtimeSocketData;
        next();
      } catch {
        recordRealtimeAuthorizationDenial("handshake");
        next(new Error("REALTIME_AUTH_FAILED"));
      }
    })();
  });

  io.on("connection", (socket: Socket) => {
    const data = socket.data as RealtimeSocketData;
    const connect = RealtimeConnectAuthSchema.parse(socket.handshake.auth);
    recordRealtimeConnection(1);
    void socket.join(roomName(data.organizationId, { type: "organization" }));

    void runInTenantTransaction(options.db, { organizationId: data.organizationId }, (client) =>
      getRealtimeVersion(client, data.organizationId)
    ).then((currentVersion) => {
      const reconcileRequired =
        connect.lastVersion !== undefined && connect.lastVersion !== currentVersion;
      if (reconcileRequired) recordRealtimeReconnectGap();
      socket.emit(
        "realtime.ready",
        RealtimeReadySchema.parse({
          schemaVersion: 1,
          organizationId: data.organizationId,
          currentVersion,
          reconcileRequired
        })
      );
    });

    socket.on(
      "room.join",
      async (raw: unknown, acknowledge?: (result: { ok: boolean; code?: string }) => void) => {
        const parsed = RealtimeRoomRequestSchema.safeParse(raw);
        if (!parsed.success || parsed.data.type === "organization") {
          recordRealtimeAuthorizationDenial("invalid_room");
          acknowledge?.({ ok: false, code: "INVALID_ROOM" });
          return;
        }
        const room = parsed.data satisfies RealtimeRoomRequest;
        if (!(await isAuthorized(options.db, data.organizationId, data.userId, room))) {
          recordRealtimeAuthorizationDenial(room.type);
          acknowledge?.({ ok: false, code: "ROOM_ACCESS_DENIED" });
          return;
        }
        if (data.authorizedRooms.size >= 100) {
          recordRealtimeAuthorizationDenial("room_limit");
          acknowledge?.({ ok: false, code: "ROOM_LIMIT_EXCEEDED" });
          return;
        }
        const name = roomName(data.organizationId, room);
        data.authorizedRooms.set(name, room);
        await socket.join(name);
        acknowledge?.({ ok: true });
      }
    );

    const recheck = setInterval(() => {
      void (async () => {
        const session = await getActiveSessionByTokenHash(options.db, data.tokenHash);
        if (!session) {
          socket.emit("access.revoked", { code: "SESSION_REVOKED" });
          socket.disconnect(true);
          return;
        }
        for (const room of data.authorizedRooms.values()) {
          if (!(await isAuthorized(options.db, data.organizationId, data.userId, room))) {
            recordRealtimeAuthorizationDenial(room.type);
            socket.emit("access.revoked", { code: "ROOM_ACCESS_REVOKED", roomType: room.type });
            socket.disconnect(true);
            return;
          }
        }
      })().catch(() => socket.disconnect(true));
    }, options.authorizationRecheckMs ?? 5_000);
    recheck.unref();

    socket.once("disconnect", () => {
      clearInterval(recheck);
      recordRealtimeConnection(-1);
    });
  });

  async function emitToRoom(name: string, hint: RealtimeHint): Promise<void> {
    const sockets = await io.in(name).fetchSockets();
    for (const socket of sockets) {
      const localSocket = io.sockets.sockets.get(socket.id);
      if (localSocket) {
        if (localSocket.conn.readyState !== "open") {
          continue;
        }
        const writeBuffer = (localSocket.conn as unknown as { writeBuffer?: unknown[] })
          ?.writeBuffer;
        if (writeBuffer && writeBuffer.length > 50) {
          recordRealtimeDroppedHint("backpressure");
          continue;
        }
      }
      socket.emit("projection.changed", hint);
    }
  }

  return {
    io,
    ready,
    async publishHint(input: PublishRealtimeHintInput): Promise<RealtimeHint> {
      const version = await runInTenantTransaction(
        options.db,
        { organizationId: input.organizationId },
        (client) => getRealtimeVersion(client, input.organizationId)
      );
      const organizationHint = RealtimeHintSchema.parse({
        schemaVersion: 1,
        organizationId: input.organizationId,
        resourceType: "organization",
        resourceId: input.organizationId,
        version
      });
      await emitToRoom(`organization:${input.organizationId}`, organizationHint);
      const hint = RealtimeHintSchema.parse({ ...input, schemaVersion: 1, version });
      if (input.conversationId) {
        await emitToRoom(`conversation:${input.organizationId}:${input.conversationId}`, hint);
      }
      if (input.teamId) await emitToRoom(`team:${input.organizationId}:${input.teamId}`, hint);
      return hint;
    },
    async close(): Promise<void> {
      await io.close();
      await Promise.all([publisher?.quit(), subscriber?.quit()]);
    }
  };
}
