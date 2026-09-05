export const workspaceKeys = {
  all: (orgId: string) => ["organizations", orgId, "workspace"] as const,
  details: (orgId: string) => [...workspaceKeys.all(orgId), "details"] as const
};
