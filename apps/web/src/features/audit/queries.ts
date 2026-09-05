import { useQuery } from "@tanstack/react-query";
import { listAuditLogs } from "../../api.js";
import { auditKeys } from "./query-keys.js";

export function useAuditLogs(
  orgId: string | null,
  query?: { limit?: number; cursor?: string; action?: string },
  fetcher: typeof fetch = fetch
) {
  return useQuery({
    queryKey: auditKeys.list(orgId ?? "", query),
    queryFn: () => listAuditLogs(orgId!, query, fetcher),
    enabled: Boolean(orgId),
    staleTime: 1000 * 30 // 30 seconds
  });
}
