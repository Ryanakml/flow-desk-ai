import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";
import type { RealtimeHint, RealtimeReady } from "@flowdesk/contracts";
import { createRealtimeClient, useRealtimeSync } from "./realtime.js";

const listeners = new Map<string, (payload: unknown) => void>();

// Mock socket.io-client
const mockSocket = {
  connected: true,
  on: vi.fn((event: string, handler: (payload: unknown) => void) => {
    listeners.set(event, handler);
  }),
  emit: vi.fn(),
  disconnect: vi.fn()
};

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => mockSocket)
}));

describe("Realtime Client (M3-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
    mockSocket.connected = true;
  });

  it("does not connect when disabled or organizationId is null", () => {
    const client = createRealtimeClient({
      organizationId: null,
      enabled: false
    });
    expect(client.getSocket()).toBeNull();
    expect(mockSocket.on).not.toHaveBeenCalled();
  });

  it("registers listeners and handles realtime.ready with reconciliation", () => {
    const onReconcile = vi.fn();
    const onHint = vi.fn();

    const client = createRealtimeClient({
      organizationId: "org-1",
      enabled: true,
      onReconcile,
      onHint
    });

    expect(mockSocket.on).toHaveBeenCalledWith("realtime.ready", expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith("projection.changed", expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith("access.revoked", expect.any(Function));

    // Simulate realtime.ready with gap
    const readyHandler = listeners.get("realtime.ready");
    expect(readyHandler).toBeDefined();
    const readyPayload: RealtimeReady = {
      schemaVersion: 1,
      organizationId: "org-1",
      currentVersion: 5,
      reconcileRequired: true
    };
    readyHandler!(readyPayload);

    expect(client.getLastVersion()).toBe(5);
    expect(onReconcile).toHaveBeenCalled();
  });

  it("updates lastVersion and dispatches onHint on projection.changed", () => {
    const onHint = vi.fn();

    const client = createRealtimeClient({
      organizationId: "org-1",
      enabled: true,
      onHint
    });

    const hintHandler = listeners.get("projection.changed");
    expect(hintHandler).toBeDefined();

    const hintPayload: RealtimeHint = {
      schemaVersion: 1,
      organizationId: "org-1",
      resourceType: "conversation",
      resourceId: "conv-1",
      version: 8
    };
    hintHandler!(hintPayload);

    expect(client.getLastVersion()).toBe(8);
    expect(onHint).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "conversation",
        resourceId: "conv-1",
        version: 8
      })
    );
  });

  it("authoritatively reconciles a projection version gap instead of applying the hint", () => {
    const onReconcile = vi.fn();
    const onHint = vi.fn();
    createRealtimeClient({ organizationId: "org-1", enabled: true, onReconcile, onHint });

    listeners.get("realtime.ready")?.({
      schemaVersion: 1,
      organizationId: "org-1",
      currentVersion: 5,
      reconcileRequired: false
    });
    listeners.get("projection.changed")?.({
      schemaVersion: 1,
      organizationId: "org-1",
      resourceType: "conversation",
      resourceId: "conv-1",
      version: 8
    });

    expect(onReconcile).toHaveBeenCalledOnce();
    expect(onHint).not.toHaveBeenCalled();
  });

  it("reports connect, reconnect, and offline states", () => {
    const onConnectionState =
      vi.fn<(state: "connecting" | "connected" | "reconnecting" | "offline") => void>();
    createRealtimeClient({ organizationId: "org-1", enabled: true, onConnectionState });
    expect(onConnectionState).toHaveBeenCalledWith("connecting");
    listeners.get("connect")?.(undefined);
    listeners.get("disconnect")?.(undefined);
    listeners.get("connect_error")?.(undefined);
    expect(onConnectionState.mock.calls.map(([state]) => state)).toEqual([
      "connecting",
      "connected",
      "reconnecting",
      "offline"
    ]);
  });

  it("joins conversation room on demand", () => {
    const client = createRealtimeClient({
      organizationId: "org-1",
      enabled: true
    });

    client.joinConversation("conv-456");
    expect(mockSocket.emit).toHaveBeenCalledWith("room.join", {
      type: "conversation",
      id: "conv-456"
    });
  });

  it("disconnects socket cleanly", () => {
    const client = createRealtimeClient({
      organizationId: "org-1",
      enabled: true
    });

    client.disconnect();
    expect(mockSocket.disconnect).toHaveBeenCalled();
    expect(client.getSocket()).toBeNull();
  });

  it("renders without error when hook is invoked inside a component", () => {
    function TestComponent() {
      useRealtimeSync({
        organizationId: "org-1",
        enabled: true
      });
      return <div>Realtime Active</div>;
    }

    const html = renderToString(<TestComponent />);
    expect(html).toContain("Realtime Active");
  });
});
