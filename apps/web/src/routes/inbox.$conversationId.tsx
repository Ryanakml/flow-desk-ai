import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../features/auth/context.js";
import { InboxView } from "../InboxView.js";
import { handleRealtimeHint, handleRealtimeReconciliation } from "../lib/realtime-adapter.js";

export const Route = createFileRoute("/inbox/$conversationId")({
  component: InboxConversationRouteComponent
});

function InboxConversationRouteComponent() {
  const { conversationId } = useParams({ from: "/inbox/$conversationId" });
  const { selectedOrgId, currentRole, sessionUser } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  if (!selectedOrgId || !sessionUser) {
    return null;
  }

  return (
    <InboxView
      key={conversationId}
      organizationId={selectedOrgId}
      userRole={currentRole}
      sessionUserId={sessionUser.id}
      activeConversationId={conversationId}
      onSelectConversation={(id) => {
        void navigate({
          to: "/inbox/$conversationId",
          params: { conversationId: id }
        });
      }}
      onRealtimeHint={(hint) => handleRealtimeHint(queryClient, hint)}
      onRealtimeReconcile={() => handleRealtimeReconciliation(queryClient, selectedOrgId)}
    />
  );
}
