import { createFileRoute, useNavigate, Outlet, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../features/auth/context.js";
import { InboxView } from "../InboxView.js";
import { handleRealtimeHint, handleRealtimeReconciliation } from "../lib/realtime-adapter.js";

export const Route = createFileRoute("/inbox")({
  component: InboxRouteComponent
});

function InboxRouteComponent() {
  const { selectedOrgId, currentRole, sessionUser } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (!selectedOrgId || !sessionUser) {
    return null;
  }

  if (pathname !== "/inbox" && pathname.startsWith("/inbox/")) {
    return <Outlet />;
  }

  return (
    <InboxView
      organizationId={selectedOrgId}
      userRole={currentRole}
      sessionUserId={sessionUser.id}
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
