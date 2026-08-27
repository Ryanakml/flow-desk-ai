import {
  type AuditLogEntry,
  type AuditLogResult,
  type ListAuditLogsResponse,
  decodeCursor,
  encodeCursor
} from "@flowdesk/contracts";
import type { DbClient } from "./auth.js";

const SENSITIVE_KEY_PATTERN = /password|token|secret|authorization|cookie|key|credential|private/i;

export function redactSensitiveMetadata(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveMetadata(item));
  }

  if (typeof data === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        redacted[key] = "[REDACTED]";
      } else {
        redacted[key] = redactSensitiveMetadata(value);
      }
    }
    return redacted;
  }

  return data;
}

export interface RecordAuditEventParams {
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  result: AuditLogResult;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RecordAuditEventResult {
  id: string;
  occurredAt: Date;
}

export async function recordAuditEvent(
  db: DbClient,
  params: RecordAuditEventParams
): Promise<RecordAuditEventResult> {
  const sanitizedMetadata = (redactSensitiveMetadata(params.metadata ?? {}) ?? {}) as Record<
    string,
    unknown
  >;

  const result = await db.query<{ id: string; occurred_at: Date }>(
    `INSERT INTO flowdesk.audit_logs (
       organization_id,
       actor_user_id,
       action,
       target_type,
       target_id,
       result,
       correlation_id,
       metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING id, occurred_at`,
    [
      params.organizationId,
      params.actorUserId ?? null,
      params.action,
      params.targetType,
      params.targetId ?? null,
      params.result,
      params.correlationId ?? null,
      JSON.stringify(sanitizedMetadata)
    ]
  );

  const row = result.rows[0]!;
  return {
    id: row.id,
    occurredAt: row.occurred_at
  };
}

export interface ListAuditLogsParams {
  organizationId: string;
  limit?: number | undefined;
  cursor?: string | undefined;
  action?: string | undefined;
  actorUserId?: string | undefined;
}

export async function listAuditLogs(
  db: DbClient,
  params: ListAuditLogsParams
): Promise<ListAuditLogsResponse> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);
  const values: unknown[] = [params.organizationId];
  const conditions: string[] = ["organization_id = $1"];

  if (params.cursor) {
    const decoded = decodeCursor(params.cursor, params.organizationId);
    if (decoded) {
      values.push(new Date(decoded.sortValue), decoded.id);
      conditions.push(
        `(occurred_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`
      );
    }
  }

  if (params.action) {
    values.push(params.action);
    conditions.push(`action = $${values.length}`);
  }

  if (params.actorUserId) {
    values.push(params.actorUserId);
    conditions.push(`actor_user_id = $${values.length}`);
  }

  values.push(limit + 1);
  const limitParam = `$${values.length}`;

  const query = `
    SELECT id, organization_id, actor_user_id, action, target_type, target_id,
           result, correlation_id, metadata, occurred_at
    FROM flowdesk.audit_logs
    WHERE ${conditions.join(" AND ")}
    ORDER BY occurred_at DESC, id DESC
    LIMIT ${limitParam}
  `;

  interface AuditLogRow {
    id: string;
    organization_id: string;
    actor_user_id: string | null;
    action: string;
    target_type: string;
    target_id: string | null;
    result: AuditLogResult;
    correlation_id: string | null;
    metadata: Record<string, unknown>;
    occurred_at: Date;
  }

  const res = await db.query<AuditLogRow>(query, values);

  const rows: AuditLogRow[] = res.rows;
  const hasNextPage = rows.length > limit;
  const items: AuditLogRow[] = hasNextPage ? rows.slice(0, limit) : rows;

  const mappedItems: AuditLogEntry[] = items.map((r: AuditLogRow) => ({
    id: r.id,
    organizationId: r.organization_id,
    actorUserId: r.actor_user_id,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    result: r.result,
    correlationId: r.correlation_id,
    metadata: r.metadata ?? {},
    occurredAt: r.occurred_at.toISOString()
  }));

  const startCursor =
    mappedItems.length > 0
      ? encodeCursor({
          id: mappedItems[0]!.id,
          sortValue: mappedItems[0]!.occurredAt,
          organizationId: params.organizationId
        })
      : null;

  const endCursor =
    mappedItems.length > 0
      ? encodeCursor({
          id: mappedItems[mappedItems.length - 1]!.id,
          sortValue: mappedItems[mappedItems.length - 1]!.occurredAt,
          organizationId: params.organizationId
        })
      : null;

  return {
    items: mappedItems,
    pageInfo: {
      hasNextPage,
      hasPreviousPage: Boolean(params.cursor),
      startCursor,
      endCursor
    }
  };
}
