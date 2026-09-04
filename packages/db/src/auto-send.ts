import type { DbClient } from "./auth.js";

interface CountRow {
  count: string | number;
}

export async function countRecentAutoReplies(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  windowMinutes = 60
): Promise<number> {
  const result = await db.query<CountRow>(
    `SELECT count(*) AS count
     FROM flowdesk.messages
     WHERE organization_id = $1
       AND conversation_id = $2
       AND sender_type = 'bot'
       AND direction = 'outbound'
       AND created_at >= (clock_timestamp() - ($3 || ' minutes')::interval)`,
    [organizationId, conversationId, windowMinutes]
  );
  return Number(result.rows[0]?.count ?? 0);
}

export const MICROCENTS_PER_CENT = 1_000_000n;

export interface MonthlyAiSpend {
  totalMicrocents: bigint;
  totalCents: number;
}

export async function getMonthlyAiSpend(
  db: DbClient,
  organizationId: string
): Promise<MonthlyAiSpend> {
  const result = await db.query<{ total_microcents: string }>(
    `SELECT COALESCE(SUM(cost_estimate_microcents), 0)::text AS total_microcents
     FROM flowdesk.bot_runs
     WHERE organization_id = $1
       AND created_at >= date_trunc('month', clock_timestamp())`,
    [organizationId]
  );
  const totalMicrocents = BigInt(result.rows[0]?.total_microcents ?? "0");
  const totalCents = Number(totalMicrocents / MICROCENTS_PER_CENT);
  return { totalMicrocents, totalCents };
}
