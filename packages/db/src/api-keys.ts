import type { DbClient } from "./auth.js";

export interface ApiKeyRecord {
  id: string;
  organizationId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: string[];
  createdByUserId: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawApiKeyRow {
  id: string;
  organization_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: unknown;
  created_by_user_id: string | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapApiKeyRow(row: RawApiKeyRow): ApiKeyRecord {
  let parsedScopes: string[] = [];
  if (Array.isArray(row.scopes)) {
    parsedScopes = row.scopes as string[];
  } else if (typeof row.scopes === "string") {
    try {
      parsedScopes = JSON.parse(row.scopes) as string[];
    } catch {
      parsedScopes = [];
    }
  }

  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    keyHash: row.key_hash,
    scopes: parsedScopes,
    createdByUserId: row.created_by_user_id,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

export async function listApiKeys(db: DbClient, organizationId: string): Promise<ApiKeyRecord[]> {
  const res = await db.query<RawApiKeyRow>(
    `SELECT * FROM flowdesk.api_keys WHERE organization_id = $1 ORDER BY created_at DESC`,
    [organizationId]
  );
  return res.rows.map(mapApiKeyRow);
}

export interface CreateApiKeyParams {
  organizationId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: string[];
  createdByUserId?: string | null;
  expiresAt?: Date | null;
}

export async function createApiKey(
  db: DbClient,
  params: CreateApiKeyParams
): Promise<ApiKeyRecord> {
  const res = await db.query<RawApiKeyRow>(
    `INSERT INTO flowdesk.api_keys (
      organization_id, name, key_prefix, key_hash, scopes, created_by_user_id, expires_at
    ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
    RETURNING *`,
    [
      params.organizationId,
      params.name,
      params.keyPrefix,
      params.keyHash,
      JSON.stringify(params.scopes),
      params.createdByUserId ?? null,
      params.expiresAt ?? null
    ]
  );

  const row = res.rows[0];
  if (!row) {
    throw new Error("Failed to insert API key");
  }
  return mapApiKeyRow(row);
}

export async function revokeApiKey(
  db: DbClient,
  id: string,
  organizationId: string
): Promise<boolean> {
  const res = await db.query(
    `UPDATE flowdesk.api_keys
     SET revoked_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL`,
    [id, organizationId]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function findApiKeyByHash(
  db: DbClient,
  keyHash: string
): Promise<ApiKeyRecord | null> {
  const res = await db.query<RawApiKeyRow>(
    `SELECT * FROM flowdesk.api_keys
     WHERE key_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > clock_timestamp())`,
    [keyHash]
  );
  const row = res.rows[0];
  return row ? mapApiKeyRow(row) : null;
}
