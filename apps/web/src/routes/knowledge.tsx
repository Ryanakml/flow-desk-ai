import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "../features/auth/context.js";
import { KnowledgeView } from "../KnowledgeView.js";

export const Route = createFileRoute("/knowledge")({
  component: KnowledgeRouteComponent
});

function KnowledgeRouteComponent() {
  const { selectedOrgId, checkPermission, showToast } = useAuth();
  if (!selectedOrgId) return null;
  return (
    <KnowledgeView
      orgId={selectedOrgId}
      canManage={checkPermission("automation:publish")}
      showToast={(msg, type) => showToast(msg, type === "error")}
    />
  );
}
