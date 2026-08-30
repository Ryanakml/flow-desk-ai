import type { DbClient } from "./auth.js";

export type WhatsAppEmbeddedSignupAttemptStatus =
  "initiated" | "processing" | "completed" | "failed" | "expired";

export interface WhatsAppEmbeddedSignupAttempt {
  id: string;
  organizationId: string;
  status: WhatsAppEmbeddedSignupAttemptStatus;
  expiresAt: Date;
}

function mapAttempt(row: {
  id: string;
  organization_id: string;
  status: WhatsAppEmbeddedSignupAttemptStatus;
  expires_at: Date;
}): WhatsAppEmbeddedSignupAttempt {
  return {
    id: row.id,
    organizationId: row.organization_id,
    status: row.status,
    expiresAt: row.expires_at
  };
}

export async function createWhatsAppEmbeddedSignupAttempt(
  db: DbClient,
  input: { organizationId: string; createdByUserId: string; stateHash: string; expiresAt: Date }
): Promise<WhatsAppEmbeddedSignupAttempt> {
  const result = await db.query<{
    id: string;
    organization_id: string;
    status: WhatsAppEmbeddedSignupAttemptStatus;
    expires_at: Date;
  }>(
    `INSERT INTO flowdesk.whatsapp_embedded_signup_attempts
      (organization_id, created_by_user_id, state_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, organization_id, status, expires_at`,
    [input.organizationId, input.createdByUserId, input.stateHash, input.expiresAt]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Failed to create WhatsApp Embedded Signup attempt");
  return mapAttempt(row);
}

/** Claims an attempt once. A second completion, stale state, or expired state is rejected. */
export async function beginWhatsAppEmbeddedSignupAttempt(
  db: DbClient,
  input: { id: string; organizationId: string; stateHash: string }
): Promise<WhatsAppEmbeddedSignupAttempt | null> {
  const result = await db.query<{
    id: string;
    organization_id: string;
    status: WhatsAppEmbeddedSignupAttemptStatus;
    expires_at: Date;
  }>(
    `UPDATE flowdesk.whatsapp_embedded_signup_attempts
     SET status = 'processing', processing_started_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE id = $1
       AND organization_id = $2
       AND state_hash = $3
       AND status = 'initiated'
       AND expires_at > clock_timestamp()
     RETURNING id, organization_id, status, expires_at`,
    [input.id, input.organizationId, input.stateHash]
  );
  const row = result.rows[0];
  return row ? mapAttempt(row) : null;
}

export async function completeWhatsAppEmbeddedSignupAttempt(
  db: DbClient,
  input: { id: string; organizationId: string }
): Promise<void> {
  await db.query(
    `UPDATE flowdesk.whatsapp_embedded_signup_attempts
     SET status = 'completed', completed_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE id = $1 AND organization_id = $2 AND status = 'processing'`,
    [input.id, input.organizationId]
  );
}

export async function failWhatsAppEmbeddedSignupAttempt(
  db: DbClient,
  input: { id: string; organizationId: string; failureCode: string }
): Promise<void> {
  await db.query(
    `UPDATE flowdesk.whatsapp_embedded_signup_attempts
     SET status = 'failed', failure_code = $3, updated_at = clock_timestamp()
     WHERE id = $1 AND organization_id = $2 AND status = 'processing'`,
    [input.id, input.organizationId, input.failureCode]
  );
}

/**
 * A WABA is owned by one FlowDesk tenant. The false result deliberately does
 * not reveal which tenant owns a conflicting WABA.
 */
export async function claimWhatsAppBusinessAccount(
  db: DbClient,
  input: { wabaId: string; organizationId: string }
): Promise<boolean> {
  const inserted = await db.query<{ waba_id: string }>(
    `INSERT INTO flowdesk.whatsapp_business_accounts (waba_id, organization_id)
     VALUES ($1, $2)
     ON CONFLICT (waba_id) DO NOTHING
     RETURNING waba_id`,
    [input.wabaId, input.organizationId]
  );
  if (inserted.rows[0]) return true;

  const owned = await db.query<{ waba_id: string }>(
    `SELECT waba_id
     FROM flowdesk.whatsapp_business_accounts
     WHERE waba_id = $1 AND organization_id = $2`,
    [input.wabaId, input.organizationId]
  );
  return Boolean(owned.rows[0]);
}
