import type { Pool, PoolClient } from "pg";

export type DbClient = Pool | PoolClient;

export interface OidcTransactionInput {
  stateHash: string;
  nonceHash: string;
  codeVerifierHash: string;
  returnTo: string;
  expiresAt: Date;
}

export interface OidcTransactionRecord {
  id: string;
  nonceHash: string;
  codeVerifierHash: string;
  returnTo: string;
  expiresAt: Date;
}

export interface UpsertIdentityUserInput {
  provider: string;
  subject: string;
  email: string;
  displayName: string;
  emailVerifiedAt?: Date | null;
}

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  status: string;
}

export interface CreateAuthSessionInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgentHash?: string;
  ipHash?: string;
}

export interface AuthSessionRecord {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  expiresAt: Date;
  createdAt: Date;
}

export async function createOidcTransaction(
  db: DbClient,
  input: OidcTransactionInput
): Promise<{ id: string }> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO flowdesk.oidc_authorization_transactions
      (state_hash, nonce_hash, code_verifier_hash, return_to, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [input.stateHash, input.nonceHash, input.codeVerifierHash, input.returnTo, input.expiresAt]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to insert OIDC authorization transaction");
  }
  return { id: row.id };
}

export async function consumeOidcTransaction(
  db: DbClient,
  stateHash: string
): Promise<OidcTransactionRecord | null> {
  const result = await db.query<{
    id: string;
    nonce_hash: string;
    code_verifier_hash: string;
    return_to: string;
    expires_at: Date;
  }>(
    `UPDATE flowdesk.oidc_authorization_transactions
     SET consumed_at = clock_timestamp()
     WHERE state_hash = $1
       AND consumed_at IS NULL
       AND expires_at > clock_timestamp()
     RETURNING id, nonce_hash, code_verifier_hash, return_to, expires_at`,
    [stateHash]
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    nonceHash: row.nonce_hash,
    codeVerifierHash: row.code_verifier_hash,
    returnTo: row.return_to,
    expiresAt: row.expires_at
  };
}

export async function findOrCreateUserFromIdentity(
  db: DbClient,
  input: UpsertIdentityUserInput
): Promise<UserRecord> {
  const normalizedEmail = input.email.toLowerCase().trim();

  // 1. Check if identity already exists
  const existingIdentity = await db.query<{
    user_id: string;
    email: string;
    display_name: string;
    status: string;
  }>(
    `SELECT u.id AS user_id, u.email, u.display_name, u.status
     FROM flowdesk.identities i
     JOIN flowdesk.users u ON u.id = i.user_id
     WHERE i.provider = $1 AND i.subject = $2`,
    [input.provider, input.subject]
  );

  if (existingIdentity.rows[0]) {
    const row = existingIdentity.rows[0];
    return {
      id: row.user_id,
      email: row.email,
      displayName: row.display_name,
      status: row.status
    };
  }

  // 2. Identity does not exist: find user by email or create new user
  const existingUser = await db.query<{
    id: string;
    email: string;
    display_name: string;
    status: string;
  }>(
    `SELECT id, email, display_name, status
     FROM flowdesk.users
     WHERE email = $1`,
    [normalizedEmail]
  );

  let userId: string;
  let userRecord: UserRecord;

  if (existingUser.rows[0]) {
    const row = existingUser.rows[0];
    userId = row.id;
    userRecord = {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      status: row.status
    };
  } else {
    const newUser = await db.query<{
      id: string;
      email: string;
      display_name: string;
      status: string;
    }>(
      `INSERT INTO flowdesk.users (email, display_name)
       VALUES ($1, $2)
       RETURNING id, email, display_name, status`,
      [normalizedEmail, input.displayName.trim() || normalizedEmail]
    );
    const row = newUser.rows[0];
    if (!row) {
      throw new Error("Failed to create user record");
    }
    userId = row.id;
    userRecord = {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      status: row.status
    };
  }

  // 3. Insert identity link
  await db.query(
    `INSERT INTO flowdesk.identities (user_id, provider, subject, email_verified_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (provider, subject) DO NOTHING`,
    [userId, input.provider, input.subject, input.emailVerifiedAt ?? new Date()]
  );

  return userRecord;
}

export async function createAuthSession(
  db: DbClient,
  input: CreateAuthSessionInput
): Promise<{ sessionId: string }> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO flowdesk.auth_sessions
      (user_id, token_hash, expires_at, user_agent_hash, ip_hash)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      input.userId,
      input.tokenHash,
      input.expiresAt,
      input.userAgentHash ?? null,
      input.ipHash ?? null
    ]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to insert auth session record");
  }
  return { sessionId: row.id };
}

export async function getActiveSessionByTokenHash(
  db: DbClient,
  tokenHash: string
): Promise<AuthSessionRecord | null> {
  const result = await db.query<{
    id: string;
    user_id: string;
    email: string;
    display_name: string;
    expires_at: Date;
    created_at: Date;
  }>(
    `SELECT s.id, s.user_id, u.email, u.display_name, s.expires_at, s.created_at
     FROM flowdesk.auth_sessions s
     JOIN flowdesk.users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > clock_timestamp()
       AND u.status = 'active'`,
    [tokenHash]
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    sessionId: row.id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    expiresAt: row.expires_at,
    createdAt: row.created_at
  };
}

export async function revokeAuthSession(db: DbClient, tokenHash: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE flowdesk.auth_sessions
     SET revoked_at = clock_timestamp()
     WHERE token_hash = $1
       AND revoked_at IS NULL`,
    [tokenHash]
  );
  return (result.rowCount ?? 0) > 0;
}
