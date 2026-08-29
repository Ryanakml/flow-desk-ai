import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { InboxView } from "./InboxView.js";
import type { Conversation, Message } from "@flowdesk/contracts";

const mockOrgId = "a0000000-0000-4000-8000-000000000001";
const mockUserId = "a0000000-0000-4000-8000-000000000012";
const mockConvId = "b0000000-0000-7000-8000-000000000001";

const sampleConversation: Conversation = {
  id: mockConvId,
  organizationId: mockOrgId,
  channelId: "c0000000-0000-7000-8000-000000000001",
  customerPhone: "6281234567890",
  customerName: "Budi Santoso",
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

const sampleMessages: Message[] = [
  {
    id: "d0000000-0000-7000-8000-000000000001",
    organizationId: mockOrgId,
    conversationId: mockConvId,
    channelId: "c0000000-0000-7000-8000-000000000001",
    direction: "inbound",
    senderType: "customer",
    senderUserId: null,
    providerMessageId: "wamid.inbound.1",
    content: "Can you help me with my order?",
    status: "delivered",
    errorDetail: null,
    sentAt: "2026-08-28T09:05:00.000Z",
    deliveredAt: "2026-08-28T09:05:02.000Z",
    readAt: null,
    createdAt: "2026-08-28T09:05:00.000Z",
    updatedAt: "2026-08-28T09:05:02.000Z"
  },
  {
    id: "d0000000-0000-7000-8000-000000000002",
    organizationId: mockOrgId,
    conversationId: mockConvId,
    channelId: "c0000000-0000-7000-8000-000000000001",
    direction: "outbound",
    senderType: "agent",
    senderUserId: mockUserId,
    providerMessageId: "wamid.outbound.1",
    content: "Certainly! What is your order number?",
    status: "read",
    errorDetail: null,
    sentAt: "2026-08-28T09:06:00.000Z",
    deliveredAt: "2026-08-28T09:06:03.000Z",
    readAt: "2026-08-28T09:06:10.000Z",
    createdAt: "2026-08-28T09:06:00.000Z",
    updatedAt: "2026-08-28T09:06:10.000Z"
  }
];

describe("InboxView Operator Interface (M2-09)", () => {
  it("renders inbox shell with search input, status filter tabs, and assignee selector", () => {
    const hangingFetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));

    const html = renderToString(
      <InboxView
        organizationId={mockOrgId}
        userRole="agent"
        sessionUserId={mockUserId}
        fetcher={hangingFetcher}
      />
    );

    expect(html).toContain("Inbox");
    expect(html).toContain("Search phone or name...");
    expect(html).toContain("All Assignees");
    expect(html).toContain("Assigned to Me");
    expect(html).toContain("Unassigned");
    expect(html).toContain("Loading conversations...");
  });

  it("renders conversation items with WhatsApp badge, customer name, and status pill", () => {
    const html = renderToString(
      <InboxView
        organizationId={mockOrgId}
        userRole="agent"
        sessionUserId={mockUserId}
        initialConversations={[sampleConversation]}
        initialActiveConversation={sampleConversation}
        initialMessages={sampleMessages}
      />
    );

    expect(html).toContain("Budi Santoso");
    expect(html).toContain("6281234567890");
    expect(html).toContain("WhatsApp");
    expect(html).toContain("badge-open");
    expect(html).toContain("open");
  });

  it("renders thread timeline with inbound and outbound message bubbles", () => {
    const html = renderToString(
      <InboxView
        organizationId={mockOrgId}
        userRole="agent"
        sessionUserId={mockUserId}
        initialConversations={[sampleConversation]}
        initialActiveConversation={sampleConversation}
        initialMessages={sampleMessages}
      />
    );

    expect(html).toContain("Can you help me with my order?");
    expect(html).toContain("Certainly! What is your order number?");
    expect(html).toContain("inbound");
    expect(html).toContain("outbound");
  });

  it("renders status checkmarks on outbound messages", () => {
    const messagesWithStatuses: Message[] = [
      {
        ...sampleMessages[1]!,
        id: "d0000000-0000-7000-8000-000000000003",
        status: "queued",
        content: "Message queued"
      },
      {
        ...sampleMessages[1]!,
        id: "d0000000-0000-7000-8000-000000000004",
        status: "sent",
        content: "Message sent"
      },
      {
        ...sampleMessages[1]!,
        id: "d0000000-0000-7000-8000-000000000005",
        status: "delivered",
        content: "Message delivered"
      },
      {
        ...sampleMessages[1]!,
        id: "d0000000-0000-7000-8000-000000000006",
        status: "read",
        content: "Message read"
      },
      {
        ...sampleMessages[1]!,
        id: "d0000000-0000-7000-8000-000000000007",
        status: "failed",
        errorDetail: "Rate limit exceeded",
        content: "Message failed"
      }
    ];

    const html = renderToString(
      <InboxView
        organizationId={mockOrgId}
        userRole="agent"
        sessionUserId={mockUserId}
        initialConversations={[sampleConversation]}
        initialActiveConversation={sampleConversation}
        initialMessages={messagesWithStatuses}
      />
    );

    expect(html).toContain("msg-check queued");
    expect(html).toContain("msg-check sent");
    expect(html).toContain("msg-check delivered");
    expect(html).toContain("msg-check read");
    expect(html).toContain("msg-check failed");
    expect(html).toContain("Rate limit exceeded");
  });

  it("renders action buttons (Resolve, Assign to Me) for open unassigned conversation", () => {
    const html = renderToString(
      <InboxView
        organizationId={mockOrgId}
        userRole="supervisor"
        sessionUserId={mockUserId}
        initialConversations={[sampleConversation]}
        initialActiveConversation={sampleConversation}
        initialMessages={sampleMessages}
      />
    );

    expect(html).toContain("Assign to Me");
    expect(html).toContain("Resolve");
  });

  it("renders Reopen button when conversation is resolved or closed", () => {
    const resolvedConversation: Conversation = {
      ...sampleConversation,
      status: "resolved"
    };

    const html = renderToString(
      <InboxView
        organizationId={mockOrgId}
        userRole="supervisor"
        sessionUserId={mockUserId}
        initialConversations={[resolvedConversation]}
        initialActiveConversation={resolvedConversation}
        initialMessages={sampleMessages}
      />
    );

    expect(html).toContain("Reopen");
    expect(html).not.toContain('data-testid="btn-resolve"');
  });

  it("renders active message composer for agents", () => {
    const html = renderToString(
      <InboxView
        organizationId={mockOrgId}
        userRole="agent"
        sessionUserId={mockUserId}
        initialConversations={[sampleConversation]}
        initialActiveConversation={sampleConversation}
        initialMessages={sampleMessages}
      />
    );

    expect(html).toContain('data-testid="thread-composer-form"');
    expect(html).toContain('data-testid="composer-input"');
    expect(html).toContain('data-testid="composer-send-btn"');
    expect(html).toContain("Cmd+Enter to send");
  });

  it("disables composer with role explanation when role lacks message:send (e.g. analyst)", () => {
    const html = renderToString(
      <InboxView
        organizationId={mockOrgId}
        userRole="analyst"
        sessionUserId={mockUserId}
        initialConversations={[sampleConversation]}
        initialActiveConversation={sampleConversation}
        initialMessages={sampleMessages}
      />
    );

    expect(html).toContain('data-testid="composer-disabled"');
    expect(html).toContain("You need the Agent or Administrator role to send WhatsApp messages.");
    expect(html).not.toContain('data-testid="thread-composer-form"');
  });

  it("disables composer when conversation status is closed", () => {
    const closedConversation: Conversation = {
      ...sampleConversation,
      status: "closed"
    };

    const html = renderToString(
      <InboxView
        organizationId={mockOrgId}
        userRole="agent"
        sessionUserId={mockUserId}
        initialConversations={[closedConversation]}
        initialActiveConversation={closedConversation}
        initialMessages={sampleMessages}
      />
    );

    expect(html).toContain('data-testid="composer-closed"');
    expect(html).toContain("This conversation is closed. Reopen it to send a reply.");
    expect(html).not.toContain('data-testid="thread-composer-form"');
  });

  it("renders empty state when no conversation is selected", () => {
    const html = renderToString(
      <InboxView
        organizationId={mockOrgId}
        userRole="agent"
        sessionUserId={mockUserId}
        initialConversations={[]}
      />
    );

    expect(html).toContain('data-testid="no-conv-selected"');
    expect(html).toContain("No conversation selected");
  });

  it("renders service window active badge when customer window is open", () => {
    const activeWindowConv: Conversation = {
      ...sampleConversation,
      serviceWindow: {
        isOpen: true,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        remainingSeconds: 3600
      }
    };

    const html = renderToString(
      <InboxView
        organizationId={mockOrgId}
        userRole="agent"
        sessionUserId={mockUserId}
        initialConversations={[activeWindowConv]}
        initialActiveConversation={activeWindowConv}
        initialMessages={sampleMessages}
      />
    );

    expect(html).toContain('data-testid="service-window-badge"');
    expect(html).toContain("24h Window Active");
    expect(html).toContain('data-testid="thread-composer-form"');
    expect(html).toContain('data-testid="btn-open-template-composer"');
  });

  it("renders service window expired banner and template button when window has closed", () => {
    const expiredWindowConv: Conversation = {
      ...sampleConversation,
      serviceWindow: {
        isOpen: false,
        expiresAt: new Date(Date.now() - 3600000).toISOString(),
        remainingSeconds: 0
      }
    };

    const html = renderToString(
      <InboxView
        organizationId={mockOrgId}
        userRole="agent"
        sessionUserId={mockUserId}
        initialConversations={[expiredWindowConv]}
        initialActiveConversation={expiredWindowConv}
        initialMessages={sampleMessages}
      />
    );

    expect(html).toContain('data-testid="service-window-badge"');
    expect(html).toContain("24h Window Expired");
    expect(html).toContain('data-testid="composer-window-expired"');
    expect(html).toContain("24-hour service window expired.");
    expect(html).toContain('data-testid="btn-open-template-composer"');
    expect(html).not.toContain('data-testid="thread-composer-form"');
  });
});
