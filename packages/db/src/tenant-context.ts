import type { Pool, PoolClient } from "pg";

export interface TenantContext {
  organizationId: string;
  correlationId?: string;
}

export async function withTenantTransaction<T>(
  pool: Pool,
  context: TenantContext,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [
      context.organizationId
    ]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
