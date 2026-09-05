import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "../features/auth/context.js";
import { InboxView } from "../InboxView.js";

export const Route = createFileRoute("/inbox")({
  component: InboxRouteComponent
});

function InboxRouteComponent() {
  const { selectedOrgId, currentRole, sessionUser } = useAuth();
  if (!selectedOrgId || !sessionUser) {
    return null;
  }

  return (
    <InboxView
      organizationId={selectedOrgId}
      userRole={currentRole}
      sessionUserId={sessionUser.id}
    />
  );
}
