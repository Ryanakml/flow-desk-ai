import type { DbClient } from "./auth.js";

export type IdempotencyStatus = "acquired" | "completed" | "in_flight";

export interface AcquireIdempotencyResult {
  status: IdempotencyStatus;
  responseStatus?: number;
  responseBody?: unknown;
  requestFingerprint?: string;
}

export interface AcquireIdempotencyParams {
  organizationId: string;
  actorUserId: string;
  route: string;
  key: string;
  requestFingerprint: string;
  ttlHours?: number | undefined;
}

export interface CompleteIdempotencyParams {
  organizationId: string;
  actorUserId: string;
  route: string;
  key: string;
  responseStatus: number;
  responseBody: unknown;
}

export interface ReleaseIdempotencyParams {
  organizationId: string;
  actorUserId: string;
  route: string;
  key: string;
}

export async function acquireIdempotencyKey(
  db: DbClient,
  params: AcquireIdempotencyParams
): Promise<AcquireIdempotencyResult> {
  const ttl = params.ttlHours ?? 24;

  // 1. Check existing record
  const existing = await db.query<{
    id: string;
    request_fingerprint: string;
    response_status: number | null;
    response_body: unknown;
    completed_at: Date | null;
    expires_at: Date;
  }>(
    `SELECT id, request_fingerprint, response_status, response_body, completed_at, expires_at
     FROM flowdesk.idempotency_keys
     WHERE organization_id = $1
       AND actor_user_id = $2
       AND route = $3
       AND key = $4`,
    [params.organizationId, params.actorUserId, params.route, params.key]
  );

  const row = existing.rows[0];
  if (row) {
    // If completed, return cached response
    if (row.completed_at !== null && row.response_status !== null) {
      return {
        status: "completed",
        responseStatus: row.response_status,
        responseBody: row.response_body,
        requestFingerprint: row.request_fingerprint
      };
    }

    // If still in flight and unexpired, report concurrent conflict
    if (row.expires_at.getTime() > Date.now()) {
      return {
        status: "in_flight",
        requestFingerprint: row.request_fingerprint
      };
    }

    // Expired in-flight record: reuse existing row
    await db.query(
      `UPDATE flowdesk.idempotency_keys
       SET request_fingerprint = $1,
           response_status = NULL,
           response_body = NULL,
           completed_at = NULL,
           expires_at = clock_timestamp() + make_interval(hours => $2)
       WHERE id = $3`,
      [params.requestFingerprint, ttl, row.id]
    );
    return { status: "acquired" };
  }

  // 2. Insert new in-flight record
  try {
    await db.query(
      `INSERT INTO flowdesk.idempotency_keys (
         organization_id,
         actor_user_id,
         route,
         key,
         request_fingerprint,
         expires_at
       ) VALUES ($1, $2, $3, $4, $5, clock_timestamp() + make_interval(hours => $6))`,
      [
        params.organizationId,
        params.actorUserId,
        params.route,
        params.key,
        params.requestFingerprint,
        ttl
      ]
    );
    return { status: "acquired" };
  } catch (err: unknown) {
    // Unique violation race condition: retry lookup
    const error = err as { code?: string };
    if (error.code === "23505") {
      return acquireIdempotencyKey(db, params);
    }
    throw err;
  }
}

export async function completeIdempotencyKey(
  db: DbClient,
  params: CompleteIdempotencyParams
): Promise<void> {
  await db.query(
    `UPDATE flowdesk.idempotency_keys
     SET response_status = $1,
         response_body = $2::jsonb,
         completed_at = clock_timestamp()
     WHERE organization_id = $3
       AND actor_user_id = $4
       AND route = $5
       AND key = $6`,
    [
      params.responseStatus,
      JSON.stringify(params.responseBody),
      params.organizationId,
      params.actorUserId,
      params.route,
      params.key
    ]
  );
}

export async function releaseIdempotencyKey(
  db: DbClient,
  params: ReleaseIdempotencyParams
): Promise<void> {
  await db.query(
    `DELETE FROM flowdesk.idempotency_keys
     WHERE organization_id = $1
       AND actor_user_id = $2
       AND route = $3
       AND key = $4
       AND completed_at IS NULL`,
    [params.organizationId, params.actorUserId, params.route, params.key]
  );
}
