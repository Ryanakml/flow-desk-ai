import { describe, expect, it, vi } from "vitest";
import {
  getBuildInfo,
  getSession,
  logout,
  listUserOrganizations,
  bootstrapOrganization,
  acceptInvitation,
  listMembers,
  inviteMember,
  updateMemberRole,
  revokeMember,
  listAuditLogs,
  listConversations,
  getConversation,
  updateConversation,
  sendOutboundMessage,
  ApiError
} from "./api.js";

describe("typed API client (M1-07)", () => {
  it("validates build information", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ service: "api", version: "test", gitSha: "abc", environment: "local" }),
          { status: 200 }
        )
      );
    await expect(getBuildInfo(fetcher)).resolves.toMatchObject({ service: "api", gitSha: "abc" });
  });

  it("fetches session state", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: "a0000000-0000-4000-8000-000000000001",
            email: "user@flowdesk.dev",
            displayName: "User"
          },
          expiresAt: new Date().toISOString()
        }),
        { status: 200 }
      )
    );
    const session = await getSession(fetcher);
    expect(session.user.email).toBe("user@flowdesk.dev");
  });

  it("throws ApiError on 401 unauthorized", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "https://flowdesk.dev/problems/unauthorized",
          title: "Unauthorized",
          status: 401,
          code: "UNAUTHORIZED",
          detail: "Session missing",
          requestId: "req-1"
        }),
        { status: 401 }
      )
    );
    await expect(getSession(fetcher)).rejects.toThrow(ApiError);
  });

  it("calls logout endpoint", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    await expect(logout(fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith("/api/v1/auth/logout", { method: "POST" });
  });

  it("lists user organizations", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          organizations: [
            {
              id: "a0000000-0000-4000-8000-000000000001",
              slug: "acme",
              name: "Acme Corp",
              role: "owner",
              membershipId: "a0000000-0000-4000-8000-000000000002"
            }
          ]
        }),
        { status: 200 }
      )
    );
    const res = await listUserOrganizations(fetcher);
    expect(res.organizations.length).toBe(1);
    expect(res.organizations[0]?.role).toBe("owner");
  });

  it("bootstraps an organization", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          organization: {
            id: "a0000000-0000-4000-8000-000000000001",
            slug: "beta-ops",
            displayName: "Beta Ops",
            ownerRoleId: "a0000000-0000-4000-8000-000000000003",
            membershipId: "a0000000-0000-4000-8000-000000000004"
          }
        }),
        { status: 201 }
      )
    );
    const res = await bootstrapOrganization({ name: "Beta Ops", slug: "beta-ops" }, fetcher);
    expect(res.organization.displayName).toBe("Beta Ops");
  });

  it("accepts an invitation token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ok",
          organizationId: "a0000000-0000-4000-8000-000000000001",
          membershipId: "a0000000-0000-4000-8000-000000000005"
        }),
        { status: 200 }
      )
    );
    const res = await acceptInvitation("valid-token", fetcher);
    expect(res.status).toBe("ok");
  });

  it("lists members for an organization", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          members: [
            {
              id: "a0000000-0000-4000-8000-000000000010",
              userId: "a0000000-0000-4000-8000-000000000011",
              email: "agent@flowdesk.dev",
              displayName: "Agent Smith",
              roleKey: "agent",
              roleLabel: "Agent",
              status: "active",
              createdAt: new Date().toISOString()
            }
          ]
        }),
        { status: 200 }
      )
    );
    const res = await listMembers("a0000000-0000-4000-8000-000000000001", fetcher);
    expect(res.members.length).toBe(1);
    expect(res.members[0]?.email).toBe("agent@flowdesk.dev");
  });

  it("invites a member with Idempotency-Key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          invitation: {
            id: "a0000000-0000-4000-8000-000000000020",
            organizationId: "a0000000-0000-4000-8000-000000000001",
            email: "new@flowdesk.dev",
            role: "agent",
            status: "pending",
            expiresAt: new Date().toISOString(),
            inviteToken: "mock-token-xyz"
          }
        }),
        { status: 201 }
      )
    );
    const res = await inviteMember(
      "a0000000-0000-4000-8000-000000000001",
      { email: "new@flowdesk.dev", role: "agent" },
      "idemp-key-123",
      fetcher
    );
    expect(res.invitation.email).toBe("new@flowdesk.dev");
  });

  it("updates member role", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          membershipId: "a0000000-0000-4000-8000-000000000010",
          role: "supervisor"
        }),
        { status: 200 }
      )
    );
    const res = await updateMemberRole(
      "a0000000-0000-4000-8000-000000000001",
      "a0000000-0000-4000-8000-000000000010",
      "supervisor",
      "idemp-role-123",
      fetcher
    );
    expect(res.role).toBe("supervisor");
  });

  it("revokes member", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    await expect(
      revokeMember(
        "a0000000-0000-4000-8000-000000000001",
        "a0000000-0000-4000-8000-000000000010",
        undefined,
        fetcher
      )
    ).resolves.toBeUndefined();
  });

  it("lists cursor-paginated audit logs", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "a0000000-0000-4000-8000-000000000030",
              organizationId: "a0000000-0000-4000-8000-000000000001",
              actorUserId: "a0000000-0000-4000-8000-000000000011",
              action: "org:bootstrap",
              targetType: "organization",
              targetId: "a0000000-0000-4000-8000-000000000001",
              result: "allowed",
              correlationId: null,
              metadata: {},
              occurredAt: new Date().toISOString()
            }
          ],
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: null,
            endCursor: null
          }
        }),
        { status: 200 }
      )
    );
    const res = await listAuditLogs("a0000000-0000-4000-8000-000000000001", { limit: 20 }, fetcher);
    expect(res.items.length).toBe(1);
    expect(res.pageInfo.hasNextPage).toBe(false);
  });

  it("lists conversations with status and assignee filter", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "b0000000-0000-7000-8000-000000000001",
              organizationId: "a0000000-0000-4000-8000-000000000001",
              channelId: "c0000000-0000-7000-8000-000000000001",
              customerPhone: "6281234567890",
              customerName: "Budi Santoso",
              status: "open",
              priority: "medium",
              assignedToUserId: null,
              version: 1,
              lastMessageAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ],
          nextCursor: null
        }),
        { status: 200 }
      )
    );

    const res = await listConversations(
      "a0000000-0000-4000-8000-000000000001",
      { status: "open", assignedTo: "unassigned" },
      fetcher
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/organizations/a0000000-0000-4000-8000-000000000001/conversations?status=open&assignedTo=unassigned"
    );
    expect(res.items.length).toBe(1);
    expect(res.items[0]!.customerName).toBe("Budi Santoso");
  });

  it("retrieves conversation detail with messages", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          conversation: {
            id: "b0000000-0000-7000-8000-000000000001",
            organizationId: "a0000000-0000-4000-8000-000000000001",
            channelId: "c0000000-0000-7000-8000-000000000001",
            customerPhone: "6281234567890",
            customerName: "Budi Santoso",
            status: "open",
            priority: "medium",
            assignedToUserId: null,
            version: 1,
            lastMessageAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          messages: [
            {
              id: "d0000000-0000-7000-8000-000000000001",
              organizationId: "a0000000-0000-4000-8000-000000000001",
              conversationId: "b0000000-0000-7000-8000-000000000001",
              channelId: "c0000000-0000-7000-8000-000000000001",
              direction: "inbound",
              senderType: "customer",
              senderUserId: null,
              providerMessageId: "wamid.inbound.1",
              content: "Hello I need help",
              status: "delivered",
              errorDetail: null,
              sentAt: new Date().toISOString(),
              deliveredAt: new Date().toISOString(),
              readAt: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ]
        }),
        { status: 200 }
      )
    );

    const res = await getConversation(
      "a0000000-0000-4000-8000-000000000001",
      "b0000000-0000-7000-8000-000000000001",
      fetcher
    );

    expect(res.conversation.id).toBe("b0000000-0000-7000-8000-000000000001");
    expect(res.messages.length).toBe(1);
    expect(res.messages[0]!.content).toBe("Hello I need help");
  });

  it("updates conversation with optimistic concurrency version", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "b0000000-0000-7000-8000-000000000001",
          organizationId: "a0000000-0000-4000-8000-000000000001",
          channelId: "c0000000-0000-7000-8000-000000000001",
          customerPhone: "6281234567890",
          customerName: "Budi Santoso",
          status: "resolved",
          priority: "medium",
          assignedToUserId: null,
          version: 2,
          lastMessageAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }),
        { status: 200 }
      )
    );

    const res = await updateConversation(
      "a0000000-0000-4000-8000-000000000001",
      "b0000000-0000-7000-8000-000000000001",
      { status: "resolved", version: 1 },
      "idemp-update-conv",
      fetcher
    );

    expect(res.status).toBe("resolved");
    expect(res.version).toBe(2);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/organizations/a0000000-0000-4000-8000-000000000001/conversations/b0000000-0000-7000-8000-000000000001",
      expect.objectContaining({
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "idemp-update-conv"
        }
      })
    );
  });

  it("sends outbound message and returns queued message", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "d0000000-0000-7000-8000-000000000002",
          organizationId: "a0000000-0000-4000-8000-000000000001",
          conversationId: "b0000000-0000-7000-8000-000000000001",
          channelId: "c0000000-0000-7000-8000-000000000001",
          direction: "outbound",
          senderType: "agent",
          senderUserId: "a0000000-0000-4000-8000-000000000012",
          providerMessageId: null,
          content: "We are processing your order right away!",
          status: "queued",
          errorDetail: null,
          sentAt: null,
          deliveredAt: null,
          readAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }),
        { status: 201 }
      )
    );

    const res = await sendOutboundMessage(
      "a0000000-0000-4000-8000-000000000001",
      "b0000000-0000-7000-8000-000000000001",
      { content: "We are processing your order right away!" },
      "idemp-msg-123",
      fetcher
    );

    expect(res.status).toBe("queued");
    expect(res.direction).toBe("outbound");
    expect(res.content).toBe("We are processing your order right away!");
  });

  it("handles 409 conflict error when updating conversation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "https://flowdesk.dev/problems/concurrency-conflict",
          title: "Concurrency Conflict",
          status: 409,
          code: "CONCURRENCY_CONFLICT",
          detail:
            "Conversation has been modified by another user. Expected version 1, current is 2."
        }),
        { status: 409 }
      )
    );

    await expect(
      updateConversation(
        "a0000000-0000-4000-8000-000000000001",
        "b0000000-0000-7000-8000-000000000001",
        { status: "resolved", version: 1 },
        undefined,
        fetcher
      )
    ).rejects.toThrow("Conversation has been modified by another user");
  });
});
