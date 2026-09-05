export const analyticsKeys = {
  all: (orgId: string) => ["organizations", orgId, "analytics"] as const,
  metrics: (orgId: string, days = 30) => [...analyticsKeys.all(orgId), "metrics", { days }] as const
};
