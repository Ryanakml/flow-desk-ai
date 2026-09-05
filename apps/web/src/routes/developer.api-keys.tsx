import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth } from "../features/auth/context.js";
import { DeveloperSettingsView } from "../DeveloperSettingsView.js";

export const Route = createFileRoute("/developer/api-keys")({
  component: DeveloperApiKeysRouteComponent
});

function DeveloperApiKeysRouteComponent() {
  const { selectedOrgId, checkPermission, showToast } = useAuth();
  const navigate = useNavigate();

  if (!selectedOrgId) return null;
  return (
    <DeveloperSettingsView
      orgId={selectedOrgId}
      canManage={checkPermission("automation:publish")}
      showToast={(msg, type) => showToast(msg, type === "error")}
      initialTab="keys"
      onTabChange={(tab) => {
        if (tab === "webhooks") {
          void navigate({ to: "/developer/webhooks" });
        }
      }}
    />
  );
}
