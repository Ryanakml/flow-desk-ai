import { createFileRoute } from "@tanstack/react-router";
import { TeamView } from "../features/team/TeamView.js";

export interface TeamSearch {
  invite?: boolean | string;
}

export const Route = createFileRoute("/team")({
  validateSearch: (search: Record<string, unknown>): TeamSearch => ({
    invite: search["invite"] === true || search["invite"] === "true"
  }),
  component: TeamRouteComponent
});

function TeamRouteComponent() {
  const search = Route.useSearch();
  const shouldOpenInvite = Boolean(search.invite);
  return <TeamView initialShowInviteModal={shouldOpenInvite} />;
}
