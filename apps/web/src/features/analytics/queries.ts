import { useQuery } from "@tanstack/react-query";
import { getAnalyticsMetricsApi } from "../../api.js";
import { analyticsKeys } from "./query-keys.js";

export function useAnalyticsMetrics(
  orgId: string | null,
  days = 30,
  fetcher: typeof fetch = fetch
) {
  return useQuery({
    queryKey: analyticsKeys.metrics(orgId ?? "", days),
    queryFn: () => getAnalyticsMetricsApi(orgId!, days, fetcher),
    enabled: Boolean(orgId),
    staleTime: 1000 * 60 * 5 // 5 minutes
  });
}
