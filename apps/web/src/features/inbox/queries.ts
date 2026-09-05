import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateOutboundMessageRequest,
  ConversationOperationRequest
} from "@flowdesk/contracts";
import {
  listConversations,
  getConversation,
  sendOutboundMessage,
  performConversationOperation,
  getInboxWorkspaceResources
} from "../../api.js";
import { conversationsKeys } from "./query-keys.js";

export function useConversationsList(
  orgId: string | null,
  filters?: {
    status?: string;
    assignedTo?: string;
    queueId?: string;
    cursor?: string;
    limit?: number;
  },
  fetcher: typeof fetch = fetch
) {
  return useQuery({
    queryKey: conversationsKeys.list(orgId ?? "", filters),
    queryFn: () => listConversations(orgId!, filters, fetcher),
    enabled: Boolean(orgId),
    staleTime: 0 // realtime high churn
  });
}

export function useConversationDetail(
  orgId: string | null,
  conversationId: string | null,
  fetcher: typeof fetch = fetch
) {
  return useQuery({
    queryKey: conversationsKeys.detail(orgId ?? "", conversationId ?? ""),
    queryFn: () => getConversation(orgId!, conversationId!, fetcher),
    enabled: Boolean(orgId && conversationId),
    staleTime: 0
  });
}

export function useInboxWorkspaceResources(orgId: string | null, fetcher: typeof fetch = fetch) {
  return useQuery({
    queryKey: conversationsKeys.workspaceResources(orgId ?? ""),
    queryFn: () => getInboxWorkspaceResources(orgId!, fetcher),
    enabled: Boolean(orgId),
    staleTime: 1000 * 60 * 5 // 5 minutes
  });
}

export function useSendMessageMutation(orgId: string, conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateOutboundMessageRequest) =>
      sendOutboundMessage(orgId, conversationId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: conversationsKeys.detail(orgId, conversationId)
      });
      void queryClient.invalidateQueries({
        queryKey: conversationsKeys.lists(orgId)
      });
    }
  });
}

export function useConversationOperationMutation(orgId: string, conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ConversationOperationRequest) =>
      performConversationOperation(orgId, conversationId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: conversationsKeys.detail(orgId, conversationId)
      });
      void queryClient.invalidateQueries({
        queryKey: conversationsKeys.lists(orgId)
      });
    }
  });
}
