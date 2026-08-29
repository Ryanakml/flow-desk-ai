// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});
