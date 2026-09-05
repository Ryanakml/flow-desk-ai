export const teamKeys = {
  all: (orgId: string) => ["organizations", orgId, "team"] as const,
  members: (orgId: string) => [...teamKeys.all(orgId), "members"] as const
};
