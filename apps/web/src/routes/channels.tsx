import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "../features/auth/context.js";
import { ChannelsView } from "../ChannelsView.js";

export const Route = createFileRoute("/channels")({
  component: ChannelsRouteComponent
});

function ChannelsRouteComponent() {
  const { selectedOrgId, checkPermission, showToast } = useAuth();
  if (!selectedOrgId) return null;
  return (
    <ChannelsView
      orgId={selectedOrgId}
      canManage={checkPermission("channel:manage")}
      showToast={showToast}
    />
  );
}
