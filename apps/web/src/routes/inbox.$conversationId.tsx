import type { Conversation } from "@flowdesk/contracts";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useAuth } from "../features/auth/context.js";
import { InboxView } from "../InboxView.js";

export const Route = createFileRoute("/inbox/$conversationId")({
  component: InboxConversationRouteComponent
});

function InboxConversationRouteComponent() {
  const { conversationId } = useParams({ from: "/inbox/$conversationId" });
  const { selectedOrgId, currentRole, sessionUser } = useAuth();

  if (!selectedOrgId || !sessionUser) {
    return null;
  }

  return (
    <InboxView
      key={conversationId}
      organizationId={selectedOrgId}
      userRole={currentRole}
      sessionUserId={sessionUser.id}
      initialActiveConversation={{ id: conversationId } as unknown as Conversation}
    />
  );
}
