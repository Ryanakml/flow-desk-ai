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
