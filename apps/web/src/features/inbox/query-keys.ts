export const conversationsKeys = {
  all: (orgId: string) => ["organizations", orgId, "conversations"] as const,
  lists: (orgId: string) => [...conversationsKeys.all(orgId), "list"] as const,
  list: (orgId: string, filters?: Record<string, unknown>) =>
    [...conversationsKeys.lists(orgId), filters ?? {}] as const,
  details: (orgId: string) => [...conversationsKeys.all(orgId), "detail"] as const,
  detail: (orgId: string, conversationId: string) =>
    [...conversationsKeys.details(orgId), conversationId] as const,
  messages: (orgId: string, conversationId: string) =>
    [...conversationsKeys.detail(orgId, conversationId), "messages"] as const,
  workspaceResources: (orgId: string) =>
    [...conversationsKeys.all(orgId), "workspace-resources"] as const,
  templates: (orgId: string, conversationId: string) =>
    [...conversationsKeys.detail(orgId, conversationId), "templates"] as const,
  templatePreview: (orgId: string, conversationId: string, templateKey: string) =>
    [...conversationsKeys.detail(orgId, conversationId), "template-preview", templateKey] as const,
  copilotDraft: (orgId: string, conversationId: string) =>
    [...conversationsKeys.detail(orgId, conversationId), "copilot-draft"] as const
};
