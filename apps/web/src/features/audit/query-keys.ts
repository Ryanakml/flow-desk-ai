export const auditKeys = {
  all: (orgId: string) => ["organizations", orgId, "audit"] as const,
  list: (orgId: string, query?: Record<string, unknown>) =>
    [...auditKeys.all(orgId), "list", query ?? {}] as const
};
