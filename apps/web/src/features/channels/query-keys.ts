export const channelsKeys = {
  all: (orgId: string) => ["organizations", orgId, "channels"] as const,
  list: (orgId: string) => [...channelsKeys.all(orgId), "list"] as const,
  detail: (orgId: string, channelId: string) =>
    [...channelsKeys.all(orgId), "detail", channelId] as const
};
