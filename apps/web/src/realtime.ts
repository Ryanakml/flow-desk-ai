import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import type { RealtimeHint, RealtimeReady } from "@flowdesk/contracts";

export interface RealtimeSyncOptions {
  organizationId: string | null;
  activeConversationId?: string | null;
  serverUrl?: string;
  enabled?: boolean;
  onReconcile?: () => void;
  onHint?: (hint: RealtimeHint) => void;
  onAccessRevoked?: (reason: { code: string; roomType?: string }) => void;
}

export interface RealtimeClient {
  getLastVersion: () => number;
  getSocket: () => Socket | null;
  joinConversation: (conversationId: string) => void;
  disconnect: () => void;
}

export function createRealtimeClient(options: RealtimeSyncOptions): RealtimeClient {
  let socket: Socket | null = null;
  let lastVersion = 0;

  if (options.enabled !== false && options.organizationId) {
    socket = io(options.serverUrl || undefined, {
      path: "/realtime",
      transports: ["websocket", "polling"],
      autoConnect: true,
      withCredentials: true,
      auth: (cb) => {
        cb({
          organizationId: options.organizationId,
          lastVersion
        });
      }
    });

    socket.on("realtime.ready", (ready: RealtimeReady) => {
      lastVersion = ready.currentVersion;
      if (ready.reconcileRequired) {
        options.onReconcile?.();
      }
    });

    socket.on("projection.changed", (hint: RealtimeHint) => {
      lastVersion = Math.max(lastVersion, hint.version);
      options.onHint?.(hint);
    });

    socket.on("access.revoked", (data: { code: string; roomType?: string }) => {
      options.onAccessRevoked?.(data);
    });

    if (options.activeConversationId) {
      socket.emit("room.join", {
        type: "conversation",
        id: options.activeConversationId
      });
    }
  }

  return {
    getLastVersion: () => lastVersion,
    getSocket: () => socket,
    joinConversation: (conversationId: string) => {
      if (socket && socket.connected) {
        socket.emit("room.join", {
          type: "conversation",
          id: conversationId
        });
      }
    },
    disconnect: () => {
      if (socket) {
        socket.disconnect();
        socket = null;
      }
    }
  };
}

export function useRealtimeSync(options: RealtimeSyncOptions) {
  const clientRef = useRef<RealtimeClient | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!options.enabled || !options.organizationId) {
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
      return;
    }

    const client = createRealtimeClient({
      ...options,
      onReconcile: () => optionsRef.current.onReconcile?.(),
      onHint: (hint) => optionsRef.current.onHint?.(hint),
      onAccessRevoked: (data) => optionsRef.current.onAccessRevoked?.(data)
    });

    clientRef.current = client;

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [options.organizationId, options.serverUrl, options.enabled]);

  useEffect(() => {
    if (options.activeConversationId && clientRef.current) {
      clientRef.current.joinConversation(options.activeConversationId);
    }
  }, [options.activeConversationId]);

  return {
    getLastVersion: () => clientRef.current?.getLastVersion() ?? 0,
    getSocket: () => clientRef.current?.getSocket() ?? null
  };
}
