import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listApiKeysApi,
  createApiKeyApi,
  revokeApiKeyApi,
  listWebhooksApi,
  createWebhookApi,
  deleteWebhookApi,
  testWebhookApi,
  listWebhookDeliveriesApi
} from "../../api.js";
import { developerKeys } from "./query-keys.js";

export function useApiKeys(orgId: string | null, fetcher: typeof fetch = fetch) {
  return useQuery({
    queryKey: developerKeys.apiKeys(orgId ?? ""),
    queryFn: () => listApiKeysApi(orgId!, fetcher),
    enabled: Boolean(orgId),
    staleTime: 1000 * 60 // 1 minute
  });
}

export function useWebhooks(orgId: string | null, fetcher: typeof fetch = fetch) {
  return useQuery({
    queryKey: developerKeys.webhooks(orgId ?? ""),
    queryFn: () => listWebhooksApi(orgId!, fetcher),
    enabled: Boolean(orgId),
    staleTime: 1000 * 60 // 1 minute
  });
}

export function useWebhookDeliveries(
  orgId: string | null,
  webhookId: string | null,
  fetcher: typeof fetch = fetch
) {
  return useQuery({
    queryKey: developerKeys.webhookDeliveries(orgId ?? "", webhookId ?? ""),
    queryFn: () => listWebhookDeliveriesApi(orgId!, webhookId!, fetcher),
    enabled: Boolean(orgId && webhookId),
    staleTime: 1000 * 15 // 15 seconds
  });
}

export function useCreateApiKeyMutation(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; scopes?: string[] }) => createApiKeyApi(orgId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: developerKeys.apiKeys(orgId) });
    }
  });
}

export function useRevokeApiKeyMutation(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) => revokeApiKeyApi(orgId, keyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: developerKeys.apiKeys(orgId) });
    }
  });
}

export function useCreateWebhookMutation(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; url: string; events?: string[] }) =>
      createWebhookApi(orgId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: developerKeys.webhooks(orgId) });
    }
  });
}

export function useDeleteWebhookMutation(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (webhookId: string) => deleteWebhookApi(orgId, webhookId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: developerKeys.webhooks(orgId) });
    }
  });
}

export function useTestWebhookMutation(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (webhookId: string) => testWebhookApi(orgId, webhookId),
    onSuccess: (_data, webhookId) => {
      void queryClient.invalidateQueries({
        queryKey: developerKeys.webhookDeliveries(orgId, webhookId)
      });
      void queryClient.invalidateQueries({ queryKey: developerKeys.webhooks(orgId) });
    }
  });
}
