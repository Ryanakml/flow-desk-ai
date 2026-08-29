import {
  type BuildInfo,
  BuildInfoSchema,
  type SessionState,
  SessionStateSchema,
  type ListUserOrganizationsResponse,
  ListUserOrganizationsResponseSchema,
  type BootstrapOrganizationResponse,
  BootstrapOrganizationResponseSchema,
  type ListMembersResponse,
  ListMembersResponseSchema,
  type CreateInvitationResponse,
  CreateInvitationResponseSchema,
  type AcceptInvitationResponse,
  AcceptInvitationResponseSchema,
  type ListAuditLogsResponse,
  ListAuditLogsResponseSchema,
  type ListConversationsResponse,
  ListConversationsResponseSchema,
  type ConversationDetailResponse,
  ConversationDetailResponseSchema,
  type Conversation,
  ConversationSchema,
  type Message,
  MessageSchema,
  type UpdateConversationRequest,
  type ConversationOperationRequest,
  type InboxWorkspaceResourcesResponse,
  InboxWorkspaceResourcesResponseSchema,
  type CreateSavedFilterRequest,
  type CreateUploadSessionRequest,
  type CreateUploadSessionResponse,
  CreateUploadSessionResponseSchema,
  type AttachmentDetailResponse,
  AttachmentDetailResponseSchema,
  type CreateOutboundMessageRequest,
  type TemplatePreviewRequest,
  type TemplatePreviewResponse,
  TemplatePreviewResponseSchema,
  type Problem
} from "@flowdesk/contracts";
import type { RoleKey } from "@flowdesk/domain";

export class ApiError extends Error {
  readonly status: number;
  readonly problem?: Problem | undefined;

  constructor(message: string, status: number, problem?: Problem) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let problem: Problem | undefined = undefined;
    try {
      problem = (await response.json()) as Problem;
    } catch {
      // Body not JSON
    }
    const message =
      problem?.detail || problem?.title || `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, problem);
  }
  return (await response.json()) as T;
}

export async function getBuildInfo(fetcher: typeof fetch = fetch): Promise<BuildInfo> {
  const res = await fetcher("/api/v1/system/build");
  const data = await handleResponse<unknown>(res);
  return BuildInfoSchema.parse(data);
}

export async function getSession(fetcher: typeof fetch = fetch): Promise<SessionState> {
  const res = await fetcher("/api/v1/auth/session");
  const data = await handleResponse<unknown>(res);
  return SessionStateSchema.parse(data);
}

export async function logout(fetcher: typeof fetch = fetch): Promise<void> {
  const res = await fetcher("/api/v1/auth/logout", {
    method: "POST"
  });
  await handleResponse(res);
}

export async function listUserOrganizations(
  fetcher: typeof fetch = fetch
): Promise<ListUserOrganizationsResponse> {
  const res = await fetcher("/api/v1/organizations");
  const data = await handleResponse<unknown>(res);
  return ListUserOrganizationsResponseSchema.parse(data);
}

export async function bootstrapOrganization(
  input: { name: string; slug: string },
  fetcher: typeof fetch = fetch
): Promise<BootstrapOrganizationResponse> {
  const res = await fetcher("/api/v1/organizations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const data = await handleResponse<unknown>(res);
  return BootstrapOrganizationResponseSchema.parse(data);
}

export async function acceptInvitation(
  token: string,
  fetcher: typeof fetch = fetch
): Promise<AcceptInvitationResponse> {
  const res = await fetcher("/api/v1/invitations/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  });
  const data = await handleResponse<unknown>(res);
  return AcceptInvitationResponseSchema.parse(data);
}

export async function listMembers(
  orgId: string,
  fetcher: typeof fetch = fetch
): Promise<ListMembersResponse> {
  const res = await fetcher(`/api/v1/organizations/${orgId}/members`);
  const data = await handleResponse<unknown>(res);
  return ListMembersResponseSchema.parse(data);
}

export async function inviteMember(
  orgId: string,
  input: { email: string; role: RoleKey },
  idempotencyKey?: string,
  fetcher: typeof fetch = fetch
): Promise<CreateInvitationResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const res = await fetcher(`/api/v1/organizations/${orgId}/invitations`, {
    method: "POST",
    headers,
    body: JSON.stringify(input)
  });
  const data = await handleResponse<unknown>(res);
  return CreateInvitationResponseSchema.parse(data);
}

export async function updateMemberRole(
  orgId: string,
  memberId: string,
  role: RoleKey,
  idempotencyKey?: string,
  fetcher: typeof fetch = fetch
): Promise<{ membershipId: string; role: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const res = await fetcher(`/api/v1/organizations/${orgId}/members/${memberId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ role })
  });
  return handleResponse<{ membershipId: string; role: string }>(res);
}

export async function revokeMember(
  orgId: string,
  memberId: string,
  idempotencyKey?: string,
  fetcher: typeof fetch = fetch
): Promise<void> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const res = await fetcher(`/api/v1/organizations/${orgId}/members/${memberId}`, {
    method: "DELETE",
    headers
  });
  await handleResponse(res);
}

export async function revokeInvitation(
  orgId: string,
  inviteId: string,
  idempotencyKey?: string,
  fetcher: typeof fetch = fetch
): Promise<void> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const res = await fetcher(`/api/v1/organizations/${orgId}/invitations/${inviteId}`, {
    method: "DELETE",
    headers
  });
  await handleResponse(res);
}

export async function listAuditLogs(
  orgId: string,
  query?: { limit?: number | undefined; cursor?: string | undefined; action?: string | undefined },
  fetcher: typeof fetch = fetch
): Promise<ListAuditLogsResponse> {
  const params = new URLSearchParams();
  if (query?.limit) params.set("limit", String(query.limit));
  if (query?.cursor) params.set("cursor", query.cursor);
  if (query?.action) params.set("action", query.action);

  const qs = params.toString();
  const url = `/api/v1/organizations/${orgId}/audit-logs${qs ? `?${qs}` : ""}`;
  const res = await fetcher(url);
  const data = await handleResponse<unknown>(res);
  return ListAuditLogsResponseSchema.parse(data);
}

export async function listConversations(
  orgId: string,
  query?: {
    status?: string | undefined;
    assignedTo?: string | undefined;
    queueId?: string | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  },
  fetcher: typeof fetch = fetch
): Promise<ListConversationsResponse> {
  const params = new URLSearchParams();
  if (query?.status) params.set("status", query.status);
  if (query?.assignedTo) params.set("assignedTo", query.assignedTo);
  if (query?.queueId) params.set("queueId", query.queueId);
  if (query?.cursor) params.set("cursor", query.cursor);
  if (query?.limit) params.set("limit", String(query.limit));

  const qs = params.toString();
  const url = `/api/v1/organizations/${orgId}/conversations${qs ? `?${qs}` : ""}`;
  const res = await fetcher(url);
  const data = await handleResponse<unknown>(res);
  return ListConversationsResponseSchema.parse(data);
}

export async function getConversation(
  orgId: string,
  conversationId: string,
  fetcher: typeof fetch = fetch
): Promise<ConversationDetailResponse> {
  const url = `/api/v1/organizations/${orgId}/conversations/${conversationId}`;
  const res = await fetcher(url);
  const data = await handleResponse<unknown>(res);
  return ConversationDetailResponseSchema.parse(data);
}

export async function updateConversation(
  orgId: string,
  conversationId: string,
  body: UpdateConversationRequest,
  idempotencyKey?: string,
  fetcher: typeof fetch = fetch
): Promise<Conversation> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const url = `/api/v1/organizations/${orgId}/conversations/${conversationId}`;
  const res = await fetcher(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body)
  });
  const data = await handleResponse<unknown>(res);
  return ConversationSchema.parse(data);
}

export async function sendOutboundMessage(
  orgId: string,
  conversationId: string,
  body: CreateOutboundMessageRequest,
  idempotencyKey?: string,
  fetcher: typeof fetch = fetch
): Promise<Message> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const url = `/api/v1/organizations/${orgId}/conversations/${conversationId}/messages`;
  const res = await fetcher(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const data = await handleResponse<unknown>(res);
  return MessageSchema.parse(data);
}

export async function performConversationOperation(
  orgId: string,
  conversationId: string,
  body: ConversationOperationRequest,
  fetcher: typeof fetch = fetch
): Promise<Conversation> {
  const url = `/api/v1/organizations/${orgId}/conversations/${conversationId}/actions`;
  const res = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return ConversationSchema.parse(await handleResponse<unknown>(res));
}

export async function getInboxWorkspaceResources(
  orgId: string,
  fetcher: typeof fetch = fetch
): Promise<InboxWorkspaceResourcesResponse> {
  const response = await fetcher(
    `/api/v1/organizations/${orgId}/conversations/workspace-resources`
  );
  return InboxWorkspaceResourcesResponseSchema.parse(await handleResponse<unknown>(response));
}

export async function saveInboxFilter(
  orgId: string,
  body: CreateSavedFilterRequest,
  fetcher: typeof fetch = fetch
): Promise<void> {
  const response = await fetcher(`/api/v1/organizations/${orgId}/conversations/saved-filters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await handleResponse(response);
}

export async function deleteInboxFilter(
  orgId: string,
  filterId: string,
  fetcher: typeof fetch = fetch
): Promise<void> {
  const response = await fetcher(
    `/api/v1/organizations/${orgId}/conversations/saved-filters/${filterId}`,
    { method: "DELETE" }
  );
  if (!response.ok) await handleResponse(response);
}

export async function createAttachmentUploadSession(
  orgId: string,
  body: CreateUploadSessionRequest,
  fetcher: typeof fetch = fetch
): Promise<CreateUploadSessionResponse> {
  const response = await fetcher(`/api/v1/organizations/${orgId}/attachments/upload-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return CreateUploadSessionResponseSchema.parse(await handleResponse<unknown>(response));
}

export async function uploadAttachmentBytes(
  session: CreateUploadSessionResponse,
  file: File,
  fetcher: typeof fetch = fetch
): Promise<void> {
  const response = await fetcher(session.uploadUrl, {
    method: "PUT",
    headers: session.headers,
    body: file
  });
  if (!response.ok) throw new ApiError("Attachment upload failed", response.status);
}

export async function completeAttachmentUpload(
  orgId: string,
  attachmentId: string,
  fetcher: typeof fetch = fetch
): Promise<AttachmentDetailResponse> {
  const response = await fetcher(
    `/api/v1/organizations/${orgId}/attachments/${attachmentId}/complete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    }
  );
  return AttachmentDetailResponseSchema.parse(await handleResponse<unknown>(response));
}

export async function getAttachment(
  orgId: string,
  attachmentId: string,
  fetcher: typeof fetch = fetch
): Promise<AttachmentDetailResponse> {
  const response = await fetcher(`/api/v1/organizations/${orgId}/attachments/${attachmentId}`);
  return AttachmentDetailResponseSchema.parse(await handleResponse<unknown>(response));
}

export interface ConversationTemplateItem {
  templateId: string;
  name: string;
  category: string;
  versionId: string;
  language: string;
  status: string;
  components: Array<{
    type: string;
    text?: string | undefined;
    format?: string | undefined;
  }>;
  variableCount: number;
}

export async function listConversationTemplates(
  orgId: string,
  conversationId: string,
  fetcher: typeof fetch = fetch
): Promise<{ items: ConversationTemplateItem[] }> {
  const url = `/api/v1/organizations/${orgId}/conversations/${conversationId}/templates`;
  const res = await fetcher(url);
  return handleResponse<{ items: ConversationTemplateItem[] }>(res);
}

export async function previewTemplate(
  orgId: string,
  conversationId: string,
  body: TemplatePreviewRequest,
  fetcher: typeof fetch = fetch
): Promise<TemplatePreviewResponse> {
  const url = `/api/v1/organizations/${orgId}/conversations/${conversationId}/template-preview`;
  const res = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await handleResponse<unknown>(res);
  return TemplatePreviewResponseSchema.parse(data);
}
