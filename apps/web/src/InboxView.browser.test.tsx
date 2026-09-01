// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import type { Conversation } from "@flowdesk/contracts";
import { InboxView } from "./InboxView.js";

vi.mock("./realtime.js", () => ({ useRealtimeSync: vi.fn() }));

const orgId = "a0000000-0000-4000-8000-000000000001";
const userId = "a0000000-0000-4000-8000-000000000012";

function conversation(id: string, name: string): Conversation {
  return {
    id,
    organizationId: orgId,
    channelId: "c0000000-0000-7000-8000-000000000001",
    customerPhone: "6281234567890",
    customerName: name,
    status: "open",
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
    lastMessageAt: "2026-08-28T10:00:00.000Z",
    createdAt: "2026-08-28T09:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z"
  };
}

const first = conversation("b0000000-0000-7000-8000-000000000001", "Budi");
const second = conversation("b0000000-0000-7000-8000-000000000002", "Sari");
const pendingFetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => cleanup());

describe("InboxView operational browser states (M3-08)", () => {
  it("supports keyboard list navigation and a bilingual UI", async () => {
    const user = userEvent.setup();
    render(
      <InboxView
        organizationId={orgId}
        userRole="agent"
        sessionUserId={userId}
        fetcher={pendingFetcher}
        initialConversations={[first, second]}
        initialActiveConversation={first}
        initialMessages={[]}
      />
    );

    const budi = screen.getByRole("option", { name: /Budi/i });
    const sari = screen.getByRole("option", { name: /Sari/i });
    budi.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(sari);

    await user.click(screen.getByTestId("locale-toggle"));
    expect(screen.getByRole("heading", { name: "Kotak Masuk" })).toBeTruthy();
    expect(screen.getByPlaceholderText("Cari nomor atau nama...")).toBeTruthy();
  });

  it("makes offline state explicit and recoverable", () => {
    render(
      <InboxView
        organizationId={orgId}
        userRole="agent"
        sessionUserId={userId}
        fetcher={pendingFetcher}
        initialConversations={[first]}
        initialActiveConversation={first}
        initialMessages={[]}
      />
    );
    fireEvent(window, new Event("offline"));
    expect(screen.getByTestId("connection-state").textContent).toContain("offline");
    expect(screen.getByTestId("composer-offline")).toBeTruthy();
    fireEvent(window, new Event("online"));
    expect(screen.getByTestId("connection-state").textContent).toContain("Reconnecting");
  });

  it("has no serious or critical automated accessibility findings", async () => {
    const { container } = render(
      <InboxView
        organizationId={orgId}
        userRole="supervisor"
        sessionUserId={userId}
        fetcher={pendingFetcher}
        initialConversations={[first]}
        initialActiveConversation={first}
        initialMessages={[]}
      />
    );
    const results = await axe.run(container, {
      resultTypes: ["violations"],
      rules: { "color-contrast": { enabled: false } }
    });
    expect(
      results.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""))
    ).toEqual([]);
  });

  it("restores a worker draft and sends only through explicit approval", async () => {
    let generated = false;
    const runId = "d0000000-0000-7000-8000-000000000001";
    const now = "2026-08-28T10:01:00.000Z";
    const draft = (status: "queued" | "drafted") => ({
      runId,
      status,
      suggestedContent: status === "drafted" ? "Garansi berlaku satu tahun." : "",
      citations:
        status === "drafted"
          ? [
              {
                chunkId: "chunk-1",
                documentTitle: "Warranty policy",
                snippet: "Garansi produk berlaku satu tahun.",
                score: 0.91
              }
            ]
          : [],
      confidence: status === "drafted" ? 0.92 : 0,
      sendable: status === "drafted",
      errorCode: null,
      createdAt: now,
      updatedAt: now
    });
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      await Promise.resolve();
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      if (url.endsWith("/conversations/workspace-resources")) {
        return new Response(JSON.stringify({ queues: [], tags: [], savedFilters: [] }), {
          status: 200
        });
      }
      if (url === `/api/v1/organizations/${orgId}/conversations`) {
        return new Response(JSON.stringify({ items: [first], nextCursor: null }), { status: 200 });
      }
      if (url === `/api/v1/organizations/${orgId}/conversations/${first.id}`) {
        return new Response(
          JSON.stringify({ conversation: first, messages: [], notes: [], tags: [] }),
          { status: 200 }
        );
      }
      if (url.endsWith(`/bot/draft/${first.id}/latest`)) {
        if (!generated) {
          return new Response(
            JSON.stringify({
              type: "about:blank",
              title: "Draft not found",
              status: 404,
              code: "DRAFT_NOT_FOUND",
              detail: "No draft",
              requestId: "test"
            }),
            { status: 404 }
          );
        }
        return new Response(JSON.stringify(draft("drafted")), { status: 200 });
      }
      if (url.endsWith(`/bot/draft/${first.id}`) && method === "POST") {
        generated = true;
        return new Response(JSON.stringify(draft("queued")), { status: 202 });
      }
      if (url.endsWith(`/bot/draft-runs/${runId}/action`) && method === "POST") {
        return new Response(
          JSON.stringify({
            message: {
              id: "e0000000-0000-7000-8000-000000000001",
              organizationId: orgId,
              conversationId: first.id,
              channelId: first.channelId,
              direction: "outbound",
              senderType: "agent",
              senderUserId: userId,
              providerMessageId: null,
              content: "Garansi berlaku satu tahun.",
              status: "queued",
              errorDetail: null,
              sentAt: now,
              deliveredAt: null,
              readAt: null,
              createdAt: now,
              updatedAt: now
            }
          }),
          { status: 201 }
        );
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    render(
      <InboxView
        organizationId={orgId}
        userRole="agent"
        sessionUserId={userId}
        fetcher={fetcher}
        initialConversations={[first]}
        initialActiveConversation={first}
        initialMessages={[]}
      />
    );

    await user.click(await screen.findByTestId("copilot-generate-btn"));
    expect(screen.getByTestId("copilot-loading")).toBeTruthy();
    await waitFor(
      () => expect(screen.getByTestId("copilot-draft-text").textContent).toContain("Garansi"),
      {
        timeout: 2_500
      }
    );
    await user.click(screen.getByTestId("copilot-approve-btn"));
    await waitFor(() => expect(screen.queryByTestId("copilot-draft-card")).toBeNull());
    expect(screen.getByText("Garansi berlaku satu tahun.")).toBeTruthy();
    const actionCall = fetcher.mock.calls.find(([input]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return url.includes("/draft-runs/");
    });
    expect(actionCall?.[1]).toMatchObject({ method: "POST" });
  });
});
