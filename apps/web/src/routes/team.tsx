import { createFileRoute } from "@tanstack/react-router";
import { TeamView } from "../features/team/TeamView.js";

export const Route = createFileRoute("/team")({
  component: TeamView
});
