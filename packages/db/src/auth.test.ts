import { describe, expect, it, vi } from "vitest";
import {
  createAuthSession,
  createOidcTransaction,
  consumeOidcTransaction,
  findOrCreateUserFromIdentity,
  getActiveSessionByTokenHash,
  revokeAuthSession,
  type DbClient
} from "./auth.js";

describe("auth database repository", () => {
  it("creates an OIDC authorization transaction", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "tx-1" }] });
    const db = { query } as unknown as DbClient;

    const result = await createOidcTransaction(db, {
      stateHash: "state-hash",
      nonceHash: "nonce-hash",
      codeVerifierHash: "code-verifier-hash",
      returnTo: "/inbox",
      expiresAt: new Date(Date.now() + 600_000)
    });

    expect(result.id).toBe("tx-1");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO flowdesk.oidc_authorization_transactions"),
      expect.arrayContaining(["state-hash", "nonce-hash", "code-verifier-hash", "/inbox"])
    );
  });

  it("consumes an unexpired OIDC transaction", async () => {
    const now = new Date();
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "tx-1",
          nonce_hash: "nonce-hash",
          code_verifier_hash: "code-hash",
          return_to: "/app",
          expires_at: now
        }
      ]
    });
    const db = { query } as unknown as DbClient;

    const result = await consumeOidcTransaction(db, "state-hash");
    expect(result).toEqual({
      id: "tx-1",
      nonceHash: "nonce-hash",
      codeVerifierHash: "code-hash",
      returnTo: "/app",
      expiresAt: now
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE flowdesk.oidc_authorization_transactions"),
      ["state-hash"]
    );
  });

  it("returns null when consuming a non-existent or expired OIDC transaction", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db = { query } as unknown as DbClient;

    const result = await consumeOidcTransaction(db, "expired-state");
    expect(result).toBeNull();
  });

  it("finds existing user from existing identity", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          user_id: "u-1",
          email: "user@flowdesk.dev",
          display_name: "Test User",
          status: "active"
        }
      ]
    });
    const db = { query } as unknown as DbClient;

    const user = await findOrCreateUserFromIdentity(db, {
      provider: "auth0",
      subject: "auth0|123",
      email: "user@flowdesk.dev",
      displayName: "Test User"
    });

    expect(user).toEqual({
      id: "u-1",
      email: "user@flowdesk.dev",
      displayName: "Test User",
      status: "active"
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("creates user and identity when neither exists", async () => {
    const query = vi
      .fn()
      // 1. check identity
      .mockResolvedValueOnce({ rows: [] })
      // 2. check user by email
      .mockResolvedValueOnce({ rows: [] })
      // 3. insert user
      .mockResolvedValueOnce({
        rows: [
          {
            id: "u-new",
            email: "new@flowdesk.dev",
            display_name: "New User",
            status: "active"
          }
        ]
      })
      // 4. insert identity
      .mockResolvedValueOnce({ rows: [] });

    const db = { query } as unknown as DbClient;

    const user = await findOrCreateUserFromIdentity(db, {
      provider: "auth0",
      subject: "auth0|456",
      email: "new@flowdesk.dev",
      displayName: "New User"
    });

    expect(user.id).toBe("u-new");
    expect(query).toHaveBeenCalledTimes(4);
  });

  it("creates an auth session", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "s-1" }] });
    const db = { query } as unknown as DbClient;

    const session = await createAuthSession(db, {
      userId: "u-1",
      tokenHash: "token-hash-val",
      expiresAt: new Date(Date.now() + 86400_000)
    });

    expect(session.sessionId).toBe("s-1");
  });

  it("retrieves active session by token hash", async () => {
    const now = new Date();
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "s-1",
          user_id: "u-1",
          email: "user@flowdesk.dev",
          display_name: "Test User",
          expires_at: now,
          created_at: now
        }
      ]
    });
    const db = { query } as unknown as DbClient;

    const session = await getActiveSessionByTokenHash(db, "token-hash-val");
    expect(session).toEqual({
      sessionId: "s-1",
      userId: "u-1",
      email: "user@flowdesk.dev",
      displayName: "Test User",
      expiresAt: now,
      createdAt: now
    });
  });

  it("revokes an active session", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const db = { query } as unknown as DbClient;

    const revoked = await revokeAuthSession(db, "token-hash-val");
    expect(revoked).toBe(true);
  });
});
