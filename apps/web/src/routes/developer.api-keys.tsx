import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "../features/auth/context.js";
import { DeveloperSettingsView } from "../DeveloperSettingsView.js";

export const Route = createFileRoute("/developer/api-keys")({
  component: DeveloperApiKeysRouteComponent
});

function DeveloperApiKeysRouteComponent() {
  const { selectedOrgId, checkPermission, showToast } = useAuth();
  if (!selectedOrgId) return null;
  return (
    <DeveloperSettingsView
      orgId={selectedOrgId}
      canManage={checkPermission("automation:publish")}
      showToast={(msg, type) => showToast(msg, type === "error")}
    />
  );
}
