import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listChannelsApi, deleteChannelApi, verifyChannelApi } from "../../api.js";
import { channelsKeys } from "./query-keys.js";

export function useChannels(orgId: string | null, fetcher: typeof fetch = fetch) {
  return useQuery({
    queryKey: channelsKeys.list(orgId ?? ""),
    queryFn: () => listChannelsApi(orgId!, fetcher),
    enabled: Boolean(orgId),
    staleTime: 1000 * 60 * 2 // 2 minutes
  });
}

export function useDeleteChannelMutation(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) => deleteChannelApi(orgId, channelId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelsKeys.list(orgId) });
    }
  });
}

export function useVerifyChannelMutation(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) => verifyChannelApi(orgId, channelId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelsKeys.list(orgId) });
    }
  });
}
