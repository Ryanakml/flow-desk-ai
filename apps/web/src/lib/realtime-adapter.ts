import type { QueryClient } from "@tanstack/react-query";
import type { RealtimeHint } from "@flowdesk/contracts";
import { conversationsKeys } from "../features/inbox/query-keys.js";
import { teamKeys } from "../features/team/query-keys.js";
import { knowledgeKeys } from "../features/knowledge/query-keys.js";
import { workspaceKeys } from "../features/workspace/query-keys.js";

/**
 * Realtime -> Query Invalidation Adapter
 *
 * Mapped from verified contract (RealtimeHint.resourceType):
 * - "conversation": invalidates conversation detail, messages, and conversation lists
 * - "message": invalidates conversation detail and messages (and conversation lists for last message preview)
 * - "queue": invalidates workspace resources and conversation lists
 * - "team": invalidates team members
 * - "template": invalidates conversation templates and knowledge
 * - "organization": invalidates workspace details and lists
 * - "media": invalidates messages
 *
 * For unknown or unmapped hints, falls back to conservative organization-scoped conversations invalidation.
 */
export function handleRealtimeHint(queryClient: QueryClient, hint: RealtimeHint): void {
  const { organizationId, resourceType, resourceId } = hint;

  switch (resourceType) {
    case "conversation":
      void queryClient.invalidateQueries({
        queryKey: conversationsKeys.detail(organizationId, resourceId)
      });
      void queryClient.invalidateQueries({
        queryKey: conversationsKeys.lists(organizationId)
      });
      break;

    case "message":
      // resourceId here is the message id, but conversation messages are keyed by conversationId
      // Invalidate all messages and details under this organization, as well as conversation lists
      void queryClient.invalidateQueries({
        queryKey: conversationsKeys.details(organizationId)
      });
      void queryClient.invalidateQueries({
        queryKey: conversationsKeys.lists(organizationId)
      });
      break;

    case "queue":
      void queryClient.invalidateQueries({
        queryKey: conversationsKeys.workspaceResources(organizationId)
      });
      void queryClient.invalidateQueries({
        queryKey: conversationsKeys.lists(organizationId)
      });
      break;

    case "team":
      void queryClient.invalidateQueries({
        queryKey: teamKeys.members(organizationId)
      });
      break;

    case "template":
      void queryClient.invalidateQueries({
        queryKey: conversationsKeys.details(organizationId)
      });
      void queryClient.invalidateQueries({
        queryKey: knowledgeKeys.all(organizationId)
      });
      break;

    case "organization":
      void queryClient.invalidateQueries({
        queryKey: workspaceKeys.details(organizationId)
      });
      break;

    default:
      // Conservative invalidation for safe reconciliation
      void queryClient.invalidateQueries({
        queryKey: conversationsKeys.all(organizationId)
      });
      break;
  }
}

/**
 * Triggered on realtime.ready reconciliation requirement or version gap detection.
 */
export function handleRealtimeReconciliation(
  queryClient: QueryClient,
  organizationId: string
): void {
  void queryClient.invalidateQueries({
    queryKey: conversationsKeys.all(organizationId)
  });
}
