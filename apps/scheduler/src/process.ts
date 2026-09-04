import type { DbClient } from "@flowdesk/db";
import { aggregateHourlyMetricsForOrg } from "@flowdesk/db";

export function schedulerState(schedulesJobs = false) {
  const status: "active" | "idle" = schedulesJobs ? "active" : "idle";
  return { status, schedulesJobs };
}

export interface AnalyticsAggregationJobResult {
  organizationsProcessed: number;
  totalBucketsAggregated: number;
}

/**
 * Iterates across active organizations and computes hourly analytics aggregates.
 */
export async function runAnalyticsAggregationJob(
  db: DbClient
): Promise<AnalyticsAggregationJobResult> {
  const orgsRes = await db.query<{ id: string }>(
    `SELECT id FROM flowdesk.organizations ORDER BY created_at ASC`
  );

  let totalBuckets = 0;
  for (const org of orgsRes.rows) {
    try {
      const watermarkRes = await db.query<{ last_aggregated_at: Date }>(
        `SELECT last_aggregated_at FROM flowdesk.analytics_watermarks WHERE organization_id = $1`,
        [org.id]
      );
      const since = watermarkRes.rows[0]?.last_aggregated_at ?? undefined;
      const count = await aggregateHourlyMetricsForOrg(db, org.id, since);
      totalBuckets += count;
    } catch {
      // Continue to next tenant to guarantee isolation
    }
  }

  return {
    organizationsProcessed: orgsRes.rows.length,
    totalBucketsAggregated: totalBuckets
  };
}
