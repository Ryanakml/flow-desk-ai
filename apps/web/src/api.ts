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
