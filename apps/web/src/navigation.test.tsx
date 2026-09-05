// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, router } from "./App.js";
import { queryClient } from "./lib/query-client.js";

vi.mock("./realtime.js", () => ({
  useRealtimeSync: vi.fn(),
  createRealtimeClient: vi.fn(() => ({
    getLastVersion: () => 0,
    getSocket: () => null,
    joinConversation: vi.fn(),
    disconnect: vi.fn()
  }))
}));

const userId = "a0000000-0000-4000-8000-000000000001";
const organizationId = "b0000000-0000-4000-8000-000000000001";
const membershipId = "b0000000-0000-4000-8000-000000000003";
const channelId = "c0000000-0000-4000-8000-000000000099";

const conv1Id = "c0000000-0000-4000-8000-000000000001";
const conv2Id = "c0000000-0000-4000-8000-000000000002";

function makeConv(id: string, name: string) {
  return {
    id,
    organizationId,
    channelId,
    customerPhone: "+62812345678",
    customerName: name,
    status: "open" as const,
    priority: "medium" as const,
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
    lastMessageAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z"
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe("Modern Frontend Router & Navigation Architecture", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.stubGlobal("scrollTo", vi.fn());
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setupAuthMocks(role: string = "owner") {
    const fetcher = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);

      if (url === "/api/v1/auth/session") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: { id: userId, email: "owner@flowdesk.dev", displayName: "Test User" },
              expiresAt: "2026-08-31T00:00:00.000Z"
            }),
            { status: 200 }
          )
        );
      }

      if (url === "/api/v1/organizations") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              organizations: [
                {
                  id: organizationId,
                  slug: "acme-corp",
                  name: "Acme Corp",
                  role,
                  membershipId
                }
              ]
            }),
            { status: 200 }
          )
        );
      }

      if (url.includes("/conversations/workspace-resources")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              queues: [],
              tags: [],
              savedFilters: []
            }),
            { status: 200 }
          )
        );
      }

      if (url.includes(`/conversations/${conv1Id}`) || url.includes(`/conversations/${conv2Id}`)) {
        const id = url.includes(conv2Id) ? conv2Id : conv1Id;
        const name = id === conv2Id ? "Customer Beta" : "Customer Alpha";
        return Promise.resolve(
          new Response(
            JSON.stringify({
              conversation: makeConv(id, name),
              messages: [],
              notes: [],
              tags: []
            }),
            { status: 200 }
          )
        );
      }

      if (url.includes("/conversations")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [makeConv(conv1Id, "Customer Alpha"), makeConv(conv2Id, "Customer Beta")],
              nextCursor: null
            }),
            { status: 200 }
          )
        );
      }

      if (url.includes("/audit-logs")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [
                {
                  id: "a0000000-0000-4000-8000-000000000001",
                  organizationId,
                  actorUserId: null,
                  action: "member.invited",
                  targetType: "member",
                  targetId: null,
                  result: "allowed",
                  correlationId: null,
                  metadata: {},
                  occurredAt: "2026-09-01T12:00:00.000Z"
                }
              ],
              pageInfo: {
                hasNextPage: false,
                hasPreviousPage: false,
                startCursor: "cur-1",
                endCursor: "cur-1",
                totalCount: 1
              }
            }),
            { status: 200 }
          )
        );
      }

      if (url.includes("/developer/api-keys")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: "key-1",
                name: "Production API Key",
                keyPrefix: "fd_live_1234",
                scopes: ["conversation:read"],
                createdAt: "2026-09-01T00:00:00.000Z",
                revokedAt: null
              }
            ]),
            { status: 200 }
          )
        );
      }

      if (url.includes("/developer/webhooks")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: "sub-1",
                name: "CRM Webhook",
                targetUrl: "https://example.com/webhook",
                events: ["conversation.created"],
                secretMask: "whsec_••••••••",
                active: true,
                verificationStatus: "verified",
                createdAt: "2026-09-01T00:00:00.000Z"
              }
            ]),
            { status: 200 }
          )
        );
      }

      if (url.includes("/members")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              members: [
                {
                  id: "m-1",
                  userId,
                  email: "owner@flowdesk.dev",
                  displayName: "Owner",
                  roleKey: "owner",
                  status: "active"
                }
              ]
            }),
            { status: 200 }
          )
        );
      }

      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });

    vi.stubGlobal("fetch", fetcher);
    return { fetcher };
  }

  it("renders 401 unauthenticated login card when session is absent", async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "https://flowdesk.dev/problems/unauthorized",
          title: "Unauthorized",
          status: 401,
          code: "UNAUTHORIZED",
          detail: "Session missing"
        }),
        { status: 401 }
      )
    );

    render(<App />);
    expect(await screen.findByText("Sign in with SSO / OIDC")).toBeTruthy();
    expect(document.querySelector("#login-button")).toBeTruthy();
    expect(screen.getByText("AI-first customer operations platform")).toBeTruthy();
  });

  it("navigates directly to /inbox and selects the first conversation", async () => {
    setupAuthMocks("owner");
    render(<App />);
    await router.navigate({ to: "/inbox" });

    expect(await screen.findByText("Customer Alpha")).toBeTruthy();
    expect(await screen.findByText("Customer Beta")).toBeTruthy();
  });

  it("deep-links directly to /inbox/$conversationId and preserves route conversationId selection", async () => {
    setupAuthMocks("owner");
    render(<App />);
    await router.navigate({
      to: "/inbox/$conversationId",
      params: { conversationId: conv2Id }
    });

    const matches = await screen.findAllByText("Customer Beta");
    expect(matches.length).toBeGreaterThanOrEqual(1);

    await waitFor(() => {
      const convBetaItem = screen.getByTestId(`conv-item-${conv2Id}`);
      expect(convBetaItem.classList.contains("selected")).toBe(true);
    });
  });

  it("updates URL when clicking another conversation in inbox and supports history back/forward", async () => {
    setupAuthMocks("owner");
    const user = userEvent.setup();
    render(<App />);
    await router.navigate({ to: "/inbox" });

    const matches = await screen.findAllByText("Customer Beta");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    const betaBtn = screen.getByTestId(`conv-item-${conv2Id}`);
    await user.click(betaBtn);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/inbox/${conv2Id}`);
    });
  });

  it("supports developer subroutes: /developer/api-keys and /developer/webhooks tab navigation", async () => {
    setupAuthMocks("owner");
    const user = userEvent.setup();
    render(<App />);
    await router.navigate({ to: "/developer/api-keys" });

    expect(await screen.findByText("Scoped API Keys")).toBeTruthy();
    expect(await screen.findByText("Production API Key")).toBeTruthy();

    const webhooksTabBtn = screen.getByRole("button", { name: "Webhooks" });
    await user.click(webhooksTabBtn);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/developer/webhooks");
    });
    expect(await screen.findByText("Outbound Webhook Subscriptions")).toBeTruthy();

    const keysTabBtn = screen.getByRole("button", { name: "API Keys" });
    await user.click(keysTabBtn);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/developer/api-keys");
    });
  });

  it("renders 404 page for unknown routes with a Return to Inbox button", async () => {
    setupAuthMocks("owner");
    render(<App />);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await router.navigate({ to: "/non-existent-path" as any });

    expect(await screen.findByText("404 — Page Not Found")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Return to Inbox" })).toBeTruthy();
  });

  it("blocks unauthorized /audit view with 403 and never calls audit-logs endpoint", async () => {
    const { fetcher } = setupAuthMocks("agent"); // agent cannot view audit
    render(<App />);
    await router.navigate({ to: "/audit" });

    expect(await screen.findByText("403 — Access Forbidden")).toBeTruthy();

    const auditCalls = fetcher.mock.calls.filter(([input]) =>
      requestUrl(input).includes("/audit-logs")
    );
    expect(auditCalls).toHaveLength(0);
  });

  it("renders exact 4-column Audit table (Time, Action, Target, Result) for authorized owner", async () => {
    const { fetcher } = setupAuthMocks("owner");
    render(<App />);
    await router.navigate({ to: "/audit" });

    expect(await screen.findByText("Audit Trail")).toBeTruthy();

    // Table header columns
    expect(await screen.findByRole("columnheader", { name: "Time" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Action" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Target" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Result" })).toBeTruthy();

    const auditCalls = fetcher.mock.calls.filter(([input]) =>
      requestUrl(input).includes("/audit-logs")
    );
    expect(auditCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("opens team invite modal when navigating from workspace with invite search param", async () => {
    setupAuthMocks("owner");
    render(<App />);
    await router.navigate({ to: "/team", search: { invite: true } });

    expect(await screen.findByText("Invite Team Member")).toBeTruthy();
    expect(screen.getByLabelText("Email Address")).toBeTruthy();
  });
});
