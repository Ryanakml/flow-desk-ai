export const developerKeys = {
  all: (orgId: string) => ["organizations", orgId, "developer"] as const,
  apiKeys: (orgId: string) => [...developerKeys.all(orgId), "api-keys"] as const,
  webhooks: (orgId: string) => [...developerKeys.all(orgId), "webhooks"] as const,
  webhookDeliveries: (orgId: string, webhookId: string) =>
    [...developerKeys.all(orgId), "webhooks", webhookId, "deliveries"] as const
};
