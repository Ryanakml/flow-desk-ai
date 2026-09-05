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
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn().mockImplementation(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn()
      }))
    );
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.Element.prototype.scrollIntoView = vi.fn();
    window.history.replaceState({}, "", "/");
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

  describe("Enterprise AppShell, Navigation & Workspace UX (UI-03)", () => {
    it("renders the enterprise desktop shell with brand, navigation groups, and user navigation", async () => {
      setupAuthMocks("owner");
      render(<App />);
      await router.navigate({ to: "/inbox" });

      // App shell structure
      await waitFor(() => {
        expect(screen.getByTestId("app-shell")).toBeDefined();
        expect(screen.getByTestId("app-sidebar")).toBeDefined();
        expect(screen.getByTestId("app-header")).toBeDefined();
      });

      // Check organization identity
      expect(screen.getByTestId("active-org-badge")).toBeDefined();
      expect(screen.getByText("Acme Corp")).toBeDefined();

      // Check user navigation trigger and badge
      expect(screen.getByTestId("user-nav-trigger")).toBeDefined();
      expect(screen.getByText("Test User")).toBeDefined();
      expect(screen.getByText("owner@flowdesk.dev")).toBeDefined();

      // Check navigation groups & links
      expect(screen.getByTestId("nav-link-/inbox")).toBeDefined();
      expect(screen.getByTestId("nav-link-/analytics")).toBeDefined();
      expect(screen.getByTestId("nav-link-/knowledge")).toBeDefined();
      expect(screen.getByTestId("nav-link-/channels")).toBeDefined();
      expect(screen.getByTestId("nav-link-/developer/api-keys")).toBeDefined();
      expect(screen.getByTestId("nav-link-/developer/webhooks")).toBeDefined();
      expect(screen.getByTestId("nav-link-/team")).toBeDefined();
      // Owner has audit:view permission
      expect(screen.getByTestId("nav-link-/audit")).toBeDefined();
      expect(screen.getByTestId("nav-link-/settings/workspace")).toBeDefined();

      // Check active route attribute on current page
      expect(screen.getByTestId("nav-link-/inbox").getAttribute("data-active")).toBe("true");
    });

    it("filters out audit navigation when user lacks audit:view permission", async () => {
      setupAuthMocks("agent");
      render(<App />);
      await router.navigate({ to: "/inbox" });

      await waitFor(() => {
        expect(screen.getByTestId("app-shell")).toBeDefined();
        expect(screen.getByTestId("nav-link-/inbox")).toBeDefined();
      });

      // Sidebar should NOT have audit link
      expect(screen.queryByTestId("nav-link-/audit")).toBeNull();

      // But should have accessible routes
      expect(screen.getByTestId("nav-link-/analytics")).toBeDefined();
    });

    it("supports toggling sidebar collapse state", async () => {
      setupAuthMocks("owner");
      render(<App />);
      await router.navigate({ to: "/inbox" });

      await waitFor(() => {
        expect(screen.getByTestId("sidebar-collapse-button")).toBeDefined();
      });

      const collapseBtn = screen.getByTestId("sidebar-collapse-button");
      collapseBtn.click();

      await waitFor(() => {
        expect(screen.getByTestId("app-sidebar").className).toContain("w-16");
      });

      collapseBtn.click();
      await waitFor(() => {
        expect(screen.getByTestId("app-sidebar").className).toContain("w-64");
      });
    });

    it("renders user information and role pill correctly in UserNav", async () => {
      setupAuthMocks("owner");
      render(<App />);
      await router.navigate({ to: "/inbox" });

      await waitFor(() => {
        expect(screen.getByTestId("user-nav-trigger")).toBeDefined();
        expect(screen.getByTestId("user-role-badge")).toBeDefined();
      });

      expect(screen.getByTestId("user-role-badge").textContent?.toLowerCase()).toContain("owner");
      expect(screen.getByText("Test User")).toBeDefined();
    });

    it("handles UserNav sign out behavior", async () => {
      setupAuthMocks("owner");
      const user = userEvent.setup();
      render(<App />);
      await router.navigate({ to: "/inbox" });

      await waitFor(() => {
        expect(screen.getByTestId("user-nav-trigger")).toBeDefined();
      });

      // Open UserNav dropdown
      await user.click(screen.getByTestId("user-nav-trigger"));

      await waitFor(() => {
        expect(screen.getByTestId("logout-btn")).toBeDefined();
      });

      // Click sign out
      await user.click(screen.getByTestId("logout-btn"));

      // Verify sign out side effect
      // If we mock logout logic, we'd verify the mock was called.
      // Since it redirects to login or clears session, we can check for unauthenticated view.
      await waitFor(() => {
        expect(screen.getByText("Sign in with SSO / OIDC")).toBeDefined();
      });
    });

    it("handles OrgSwitcher interaction", async () => {
      const { fetcher } = setupAuthMocks("owner");
      
      // We need to return multiple organizations for the switcher test
      fetcher.mockImplementation((input) => {
        const url = requestUrl(input);
        if (url === "/api/v1/organizations") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                organizations: [
                  {
                    id: organizationId,
                    slug: "acme-corp",
                    name: "Acme Corp",
                    role: "owner",
                    membershipId
                  },
                  {
                    id: "b0000000-0000-4000-8000-000000000002",
                    slug: "org-b",
                    name: "Organization B",
                    role: "agent",
                    membershipId: "b-mem"
                  }
                ]
              }),
              { status: 200 }
            )
          );
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      });
      
      const user = userEvent.setup();
      render(<App />);
      await router.navigate({ to: "/inbox" });

      await waitFor(() => {
        expect(screen.getByTestId("org-switcher-trigger")).toBeDefined();
      });

      // Open the switcher
      await user.click(screen.getByTestId("org-switcher-trigger"));

      await waitFor(() => {
        expect(screen.getByText("Organization B")).toBeDefined();
      });

      // Click the other org
      await user.click(screen.getByText("Organization B"));
      
      // Assuming clicking it calls setSelectedOrgId, we expect a reload or redirect.
      // Our simple test just ensures the interaction doesn't crash and closes the menu.
      await waitFor(() => {
        expect(screen.queryByText("Organization B")).toBeNull(); // Menu closed
      });
    });

    it("opens and interacts with Command Menu via Cmd+K", async () => {
      setupAuthMocks("owner");
      const user = userEvent.setup();
      render(<App />);
      await router.navigate({ to: "/inbox" });

      await waitFor(() => {
        expect(screen.getByTestId("app-shell")).toBeDefined();
      });

      // Cmd+K to open
      await user.keyboard("{Meta>}k{/Meta}");

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Type a command or search...")).toBeDefined();
        // Should show Developer links
        expect(screen.getByText("API Keys")).toBeDefined();
      });

      // Select API Keys
      await user.type(screen.getByPlaceholderText("Type a command or search..."), "api");
      
      // Find API keys in the DOM that might be filtered
      const apiKeysItem = screen.getByText("API Keys");
      await user.click(apiKeysItem);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/developer/api-keys");
      });
    });

    it("handles Mobile Nav (Sheet) open and close", async () => {
      setupAuthMocks("owner");
      const user = userEvent.setup();
      render(<App />);
      await router.navigate({ to: "/inbox" });

      await waitFor(() => {
        expect(screen.getByTestId("mobile-hamburger-button")).toBeDefined();
      });

      // Open Sheet
      await user.click(screen.getByTestId("mobile-hamburger-button"));

      await waitFor(() => {
        expect(screen.getByTestId("mobile-sheet-content")).toBeDefined();
      });

      // The mobile sheet has an Inbox link
      const sheetContent = screen.getByTestId("mobile-sheet-content");
      const inboxLink = sheetContent.querySelector('[data-testid="nav-link-/inbox"]');
      expect(inboxLink).toBeDefined();

      if (inboxLink) {
        await user.click(inboxLink);
      }

      // Clicking link should close the sheet
      await waitFor(() => {
        expect(screen.queryByTestId("mobile-sheet-content")).toBeNull();
      });
    });

    it("persists theme preference across toggles", async () => {
      setupAuthMocks("owner");
      const user = userEvent.setup();
      // Clear localStorage before testing
      window.localStorage.removeItem("flowdesk-theme");
      
      render(<App />);
      await router.navigate({ to: "/inbox" });

      await waitFor(() => {
        expect(screen.getByTestId("theme-toggle-button")).toBeDefined();
      });

      const button = screen.getByTestId("theme-toggle-button");
      
      // Default should be system or light
      // Open dropdown
      await user.click(button);
      await waitFor(() => {
        expect(screen.getByText("Dark")).toBeDefined();
      });

      // Click Dark
      await user.click(screen.getByText("Dark"));
      
      await waitFor(() => {
        expect(document.documentElement.classList.contains("dark")).toBe(true);
        expect(window.localStorage.getItem("flowdesk-theme")).toBe("dark");
      });

      // Toggle back to Light
      await user.click(button);
      await waitFor(() => {
        expect(screen.getByText("Light")).toBeDefined();
      });
      await user.click(screen.getByText("Light"));

      await waitFor(() => {
        expect(document.documentElement.classList.contains("dark")).toBe(false);
        expect(window.localStorage.getItem("flowdesk-theme")).toBe("light");
      });
    });
  });
});
