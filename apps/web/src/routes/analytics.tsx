import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "../features/auth/context.js";
import { AnalyticsView } from "../AnalyticsView.js";

export const Route = createFileRoute("/analytics")({
  component: AnalyticsRouteComponent
});

function AnalyticsRouteComponent() {
  const { selectedOrgId } = useAuth();
  if (!selectedOrgId) return null;
  return <AnalyticsView orgId={selectedOrgId} />;
}
