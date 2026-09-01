import type { Pool, PoolClient } from "pg";
import type { DbClient } from "./auth.js";

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
    // Never rely on the login role being correctly constrained. Production and
    // local development commonly connect through a role that can SET ROLE; the
    // transaction must still execute as the NOBYPASSRLS runtime principal.
    await client.query("SET LOCAL ROLE flowdesk_runtime");
    await client.query("SET LOCAL search_path = flowdesk, public");
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

function isPool(db: DbClient): db is Pool {
  return (
    typeof (db as Pool).connect === "function" &&
    typeof (db as PoolClient).release !== "function" &&
    (typeof (db as Pool).totalCount === "number" ||
      (db as { constructor?: { name?: string } }).constructor?.name === "Pool")
  );
}

/**
 * Runs tenant work atomically when backed by a Pool. Lightweight unit-test
 * clients remain supported without pretending their query mocks are a real
 * PostgreSQL transaction boundary.
 */
export async function runInTenantTransaction<T>(
  db: DbClient,
  context: TenantContext,
  work: (client: DbClient) => Promise<T>
): Promise<T> {
  if (isPool(db)) {
    return withTenantTransaction(db, context, work);
  }
  return work(db);
}
