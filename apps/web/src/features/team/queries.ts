import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listMembers, inviteMember, updateMemberRole, revokeMember } from "../../api.js";
import type { RoleKey } from "@flowdesk/domain";
import { teamKeys } from "./query-keys.js";

export function useTeamMembers(orgId: string | null, fetcher: typeof fetch = fetch) {
  return useQuery({
    queryKey: teamKeys.members(orgId ?? ""),
    queryFn: () => listMembers(orgId!, fetcher),
    enabled: Boolean(orgId),
    staleTime: 1000 * 60 * 2 // 2 minutes
  });
}

export function useInviteMemberMutation(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: RoleKey }) =>
      inviteMember(orgId, { email, role }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: teamKeys.members(orgId) });
    }
  });
}

export function useUpdateMemberRoleMutation(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: RoleKey }) =>
      updateMemberRole(orgId, memberId, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: teamKeys.members(orgId) });
    }
  });
}

export function useRevokeMemberMutation(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => revokeMember(orgId, memberId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: teamKeys.members(orgId) });
    }
  });
}
