import type { DbClient } from "@flowdesk/db";
import {
  aggregateHourlyMetricsForOrg,
  listActiveOrganizationIds,
  runInTenantTransaction
} from "@flowdesk/db";

export function schedulerState(schedulesJobs = false) {
  const status: "active" | "idle" = schedulesJobs ? "active" : "idle";
  return { status, schedulesJobs };
}

export interface AnalyticsAggregationJobResult {
  organizationsProcessed: number;
  totalBucketsAggregated: number;
  errors: Array<{ organizationId: string; error: string }>;
}

export interface RunAnalyticsAggregationJobOptions {
  logError?: (details: { organizationId: string; err: unknown }) => void;
}

/**
 * Discovers active organizations via narrow system capability, then executes
 * hourly analytics rollups inside tenant transactions under NOBYPASSRLS.
 */
export async function runAnalyticsAggregationJob(
  db: DbClient,
  options: RunAnalyticsAggregationJobOptions = {}
): Promise<AnalyticsAggregationJobResult> {
  const orgIds = await listActiveOrganizationIds(db);

  let totalBuckets = 0;
  const errors: Array<{ organizationId: string; error: string }> = [];

  for (const orgId of orgIds) {
    try {
      const count = await runInTenantTransaction(
        db,
        { organizationId: orgId },
        async (tenantDb) => {
          const watermarkRes = await tenantDb.query<{ last_aggregated_at: Date }>(
            `SELECT last_aggregated_at FROM flowdesk.analytics_watermarks WHERE organization_id = $1`,
            [orgId]
          );
          const since = watermarkRes.rows[0]?.last_aggregated_at ?? undefined;
          return aggregateHourlyMetricsForOrg(tenantDb, orgId, since);
        }
      );
      totalBuckets += count;
    } catch (err) {
      options.logError?.({ organizationId: orgId, err });
      errors.push({
        organizationId: orgId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return {
    organizationsProcessed: orgIds.length,
    totalBucketsAggregated: totalBuckets,
    errors
  };
}
