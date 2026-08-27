import type { DbClient } from "./auth.js";
import {
  type ChannelStatus,
  type ChannelType,
  assertValidChannelStatusTransition
} from "@flowdesk/domain";

export interface ChannelRecord {
  id: string;
  organizationId: string;
  type: ChannelType;
  name: string;
  phoneNumberId: string;
  wabaId: string;
  encryptedCredentials: string;
  status: ChannelStatus;
  statusReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateChannelInput {
  organizationId: string;
  type?: ChannelType | undefined;
  name: string;
  phoneNumberId: string;
  wabaId: string;
  encryptedCredentials: string;
  status?: ChannelStatus | undefined;
  statusReason?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

interface RawChannelRow {
  id: string;
  organization_id: string;
  type: string;
  name: string;
  phone_number_id: string;
  waba_id: string;
  encrypted_credentials: string;
  status: string;
  status_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

function mapChannelRow(row: RawChannelRow): ChannelRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    type: row.type as ChannelType,
    name: row.name,
    phoneNumberId: row.phone_number_id,
    wabaId: row.waba_id,
    encryptedCredentials: row.encrypted_credentials,
    status: row.status as ChannelStatus,
    statusReason: row.status_reason,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function createChannel(
  db: DbClient,
  input: CreateChannelInput
): Promise<ChannelRecord> {
  const type = input.type ?? "whatsapp";
  const status = input.status ?? "draft";
  const statusReason = input.statusReason ?? null;
  const metadata = input.metadata ?? {};

  const res = await db.query<RawChannelRow>(
    `INSERT INTO flowdesk.channels (
       organization_id, type, name, phone_number_id, waba_id,
       encrypted_credentials, status, status_reason, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.organizationId,
      type,
      input.name,
      input.phoneNumberId,
      input.wabaId,
      input.encryptedCredentials,
      status,
      statusReason,
      JSON.stringify(metadata)
    ]
  );

  const row = res.rows[0];
  if (!row) throw new Error("Failed to insert channel record");
  return mapChannelRow(row);
}

export async function getChannelById(
  db: DbClient,
  id: string,
  organizationId?: string
): Promise<ChannelRecord | null> {
  let queryText = "SELECT * FROM flowdesk.channels WHERE id = $1";
  const values: unknown[] = [id];

  if (organizationId) {
    queryText += " AND organization_id = $2";
    values.push(organizationId);
  }

  const res = await db.query<RawChannelRow>(queryText, values);
  const row = res.rows[0];
  return row ? mapChannelRow(row) : null;
}

export async function getChannelByPhoneNumberId(
  db: DbClient,
  phoneNumberId: string
): Promise<ChannelRecord | null> {
  const res = await db.query<RawChannelRow>(
    "SELECT * FROM flowdesk.channels WHERE phone_number_id = $1 LIMIT 1",
    [phoneNumberId]
  );
  const row = res.rows[0];
  return row ? mapChannelRow(row) : null;
}

export async function listChannels(
  db: DbClient,
  organizationId: string,
  status?: ChannelStatus
): Promise<ChannelRecord[]> {
  let queryText = "SELECT * FROM flowdesk.channels WHERE organization_id = $1";
  const values: unknown[] = [organizationId];

  if (status) {
    queryText += " AND status = $2";
    values.push(status);
  }

  queryText += " ORDER BY created_at DESC";

  const res = await db.query<RawChannelRow>(queryText, values);
  return res.rows.map(mapChannelRow);
}

export async function updateChannelStatus(
  db: DbClient,
  id: string,
  targetStatus: ChannelStatus,
  statusReason?: string | null
): Promise<ChannelRecord> {
  // 1. Fetch current status
  const current = await getChannelById(db, id);
  if (!current) {
    throw new Error(`Channel with ID '${id}' not found`);
  }

  // 2. Validate state transition via domain rules
  assertValidChannelStatusTransition(current.status, targetStatus);

  // 3. Update status
  const res = await db.query<RawChannelRow>(
    `UPDATE flowdesk.channels
     SET status = $2,
         status_reason = $3,
         updated_at = clock_timestamp()
     WHERE id = $1
     RETURNING *`,
    [id, targetStatus, statusReason ?? null]
  );

  const row = res.rows[0];
  if (!row) throw new Error(`Failed to update status for channel '${id}'`);
  return mapChannelRow(row);
}
