import { createFileRoute } from "@tanstack/react-router";
import { AuditView } from "../features/audit/AuditView.js";

export const Route = createFileRoute("/audit")({
  component: AuditView
});
