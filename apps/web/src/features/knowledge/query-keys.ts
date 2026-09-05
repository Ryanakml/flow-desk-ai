export const knowledgeKeys = {
  all: (orgId: string) => ["organizations", orgId, "knowledge"] as const,
  sources: (orgId: string) => [...knowledgeKeys.all(orgId), "sources"] as const,
  botConfig: (orgId: string) => [...knowledgeKeys.all(orgId), "bot-config"] as const,
  policies: (orgId: string) => [...knowledgeKeys.all(orgId), "policies"] as const
};
