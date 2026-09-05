import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceView } from "../features/workspace/WorkspaceView.js";

export const Route = createFileRoute("/settings/workspace")({
  component: WorkspaceView
});
