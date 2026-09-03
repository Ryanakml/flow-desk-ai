import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadAuthConfig } from "@flowdesk/config";
import type { DbClient } from "@flowdesk/db";
import { MockIdentityProvider } from "@flowdesk/providers";
import { SESSION_COOKIE_NAME } from "@flowdesk/security";
import { createApiApp } from "./app.js";

// In-memory mock database state for testing auth API contracts
function createMockDb(): DbClient {
  const transactions = new Map<
    string,
    {
      id: string;
      stateHash: string;
      nonceHash: string;
      codeVerifierHash: string;
      returnTo: string;
      expiresAt: Date;
      consumedAt: Date | null;
    }
  >();

  const users = new Map<
    string,
    { id: string; email: string; displayName: string; status: string }
  >();

  const identities = new Map<
    string,
    { id: string; userId: string; provider: string; subject: string }
  >();

  const sessions = new Map<
    string,
    {
      id: string;
      userId: string;
      tokenHash: string;
      expiresAt: Date;
      revokedAt: Date | null;
      createdAt: Date;
    }
  >();

  return {
    async query(queryText: string, values: unknown[] = []) {
      await Promise.resolve();
      const sql = queryText.replace(/\s+/g, " ").trim();

      // INSERT oidc_authorization_transactions
      if (sql.includes("INSERT INTO flowdesk.oidc_authorization_transactions")) {
        const [stateHash, nonceHash, codeVerifierHash, returnTo, expiresAt] = values as [
          string,
          string,
          string,
          string,
          Date
        ];
        const id = `tx-${transactions.size + 1}`;
        transactions.set(stateHash, {
          id,
          stateHash,
          nonceHash,
          codeVerifierHash,
          returnTo,
          expiresAt,
          consumedAt: null
        });
        return { rows: [{ id }] };
      }

      // UPDATE oidc_authorization_transactions (consume)
      if (sql.includes("UPDATE flowdesk.oidc_authorization_transactions")) {
        const [stateHash] = values as [string];
        const tx = transactions.get(stateHash);
        if (!tx || tx.consumedAt !== null || tx.expiresAt.getTime() <= Date.now()) {
          return { rows: [] };
        }
        tx.consumedAt = new Date();
        return {
          rows: [
            {
              id: tx.id,
              nonce_hash: tx.nonceHash,
              code_verifier_hash: tx.codeVerifierHash,
              return_to: tx.returnTo,
              expires_at: tx.expiresAt
            }
          ]
        };
      }

      // SELECT identities JOIN users
      if (sql.includes("FROM flowdesk.identities i JOIN flowdesk.users u")) {
        const [provider, subject] = values as [string, string];
        const key = `${provider}:${subject}`;
        const identity = identities.get(key);
        if (identity) {
          const user = users.get(identity.userId);
          if (user) {
            return {
              rows: [
                {
                  user_id: user.id,
                  email: user.email,
                  display_name: user.displayName,
                  status: user.status
                }
              ]
            };
          }
        }
        return { rows: [] };
      }

      // SELECT users WHERE email
      if (sql.includes("FROM flowdesk.users WHERE email")) {
        const [email] = values as [string];
        for (const user of users.values()) {
          if (user.email === email) {
            return {
              rows: [
                {
                  id: user.id,
                  email: user.email,
                  display_name: user.displayName,
                  status: user.status
                }
              ]
            };
          }
        }
        return { rows: [] };
      }

      // INSERT users
      if (sql.includes("INSERT INTO flowdesk.users")) {
        const [email, displayName] = values as [string, string];
        const id = `00000000-0000-7000-8000-${String(users.size + 1).padStart(12, "0")}`;
        const user = { id, email, displayName, status: "active" };
        users.set(id, user);
        return { rows: [{ id, email, display_name: displayName, status: "active" }] };
      }

      // INSERT identities
      if (sql.includes("INSERT INTO flowdesk.identities")) {
        const [userId, provider, subject] = values as [string, string, string];
        const id = `id-${identities.size + 1}`;
        identities.set(`${provider}:${subject}`, { id, userId, provider, subject });
        return { rows: [{ id }] };
      }

      // INSERT auth_sessions
      if (sql.includes("INSERT INTO flowdesk.auth_sessions")) {
        const [userId, tokenHash, expiresAt] = values as [string, string, Date];
        const id = `sess-${sessions.size + 1}`;
        sessions.set(tokenHash, {
          id,
          userId,
          tokenHash,
          expiresAt,
          revokedAt: null,
          createdAt: new Date()
        });
        return { rows: [{ id }] };
      }

      // SELECT auth_sessions JOIN users
      if (sql.includes("FROM flowdesk.auth_sessions s JOIN flowdesk.users u")) {
        const [tokenHash] = values as [string];
        const session = sessions.get(tokenHash);
        if (!session || session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) {
          return { rows: [] };
        }
        const user = users.get(session.userId);
        if (!user || user.status !== "active") {
          return { rows: [] };
        }
        return {
          rows: [
            {
              id: session.id,
              user_id: session.userId,
              email: user.email,
              display_name: user.displayName,
              expires_at: session.expiresAt,
              created_at: session.createdAt
            }
          ]
        };
      }

      // UPDATE auth_sessions (revoke)
      if (sql.includes("UPDATE flowdesk.auth_sessions")) {
        const [tokenHash] = values as [string];
        const session = sessions.get(tokenHash);
        if (session && session.revokedAt === null) {
          session.revokedAt = new Date();
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      }

      return { rows: [] };
    }
  } as unknown as DbClient;
}

function getCookies(header: string | string[] | undefined): string[] {
  if (!header) return [];
  return Array.isArray(header) ? header : [header];
}

describe("API Auth and Session lifecycle (M1-04)", () => {
  const db = createMockDb();
  const config = loadAuthConfig({
    AUTH_COOKIE_SECURE: "false",
    AUTH_MOCK_ENABLED: "true"
  });

  const app = createApiApp({
    service: "api",
    version: "test",
    gitSha: "test-sha",
    environment: "local",
    auth: {
      db,
      config,
      identityProvider: new MockIdentityProvider()
    }
  });

  it("GET /api/v1/auth/login initiates OIDC flow with PKCE cookie", async () => {
    const response = await request(app)
      .get("/api/v1/auth/login?returnTo=/inbox")
      .set("Accept", "application/json")
      .expect(200);

    const body = response.body as { authorizationUrl: string };
    expect(body).toHaveProperty("authorizationUrl");
    if (config.AUTH_MOCK_ENABLED) {
      expect(body.authorizationUrl).toContain("/api/v1/auth/callback");
      expect(body.authorizationUrl).toContain("state=");
      expect(body.authorizationUrl).toContain("code=");
    } else {
      expect(body.authorizationUrl).toContain("response_type=code");
      expect(body.authorizationUrl).toContain("state=");
      expect(body.authorizationUrl).toContain("code_challenge=");
    }

    const cookies = getCookies(response.headers["set-cookie"]);
    expect(cookies.length).toBeGreaterThan(0);
    const pkceCookie = cookies[0] ?? "";
    expect(pkceCookie).toContain("flowdesk_pkce=");
    expect(pkceCookie).toContain("HttpOnly");
  });

  it("GET /api/v1/auth/callback fails with 400 problem if state or code is missing", async () => {
    const response = await request(app).get("/api/v1/auth/callback").expect(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.body).toMatchObject({
      code: "BAD_REQUEST",
      status: 400
    });
  });

  it("GET /api/v1/auth/callback fails if state is invalid or expired", async () => {
    const response = await request(app)
      .get("/api/v1/auth/callback?code=mock-code&state=non-existent-state")
      .expect(400);

    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.body).toMatchObject({
      code: "AUTH_STATE_INVALID",
      status: 400
    });
  });

  it("completes login callback, establishes session, and accesses protected route", async () => {
    // 1. Initiate login
    const loginRes = await request(app)
      .get("/api/v1/auth/login?returnTo=/dashboard")
      .set("Accept", "application/json")
      .expect(200);

    const loginBody = loginRes.body as { authorizationUrl: string };
    const authUrl = new URL(loginBody.authorizationUrl);
    const state = authUrl.searchParams.get("state")!;
    expect(state).toBeTruthy();

    const pkceCookie = getCookies(loginRes.headers["set-cookie"])[0] ?? "";

    // 2. Perform callback with the generated state
    const callbackRes = await request(app)
      .get(`/api/v1/auth/callback?code=user:alice@flowdesk.dev&state=${state}`)
      .set("Cookie", pkceCookie)
      .set("Accept", "application/json")
      .expect(200);

    expect(callbackRes.body).toMatchObject({
      status: "ok",
      returnTo: "/dashboard",
      user: {
        email: "alice@flowdesk.dev",
        displayName: "Alice"
      }
    });

    // Verify session cookie was set and PKCE cookie was cleared
    const cookies = getCookies(callbackRes.headers["set-cookie"]);
    expect(cookies.length).toBeGreaterThan(0);
    const sessionCookieStr = cookies.find(
      (c) => c.includes(SESSION_COOKIE_NAME) || c.includes("flowdesk_session")
    );
    const clearedPkce = cookies.find((c) => c.includes("flowdesk_pkce="));
    expect(sessionCookieStr).toBeDefined();
    expect(sessionCookieStr).toContain("HttpOnly");
    expect(sessionCookieStr).toContain("SameSite=Lax");
    expect(clearedPkce).toBeDefined();

    // 3. Verify state cannot be replayed (idempotent one-time transaction)
    const replayRes = await request(app)
      .get(`/api/v1/auth/callback?code=user:alice@flowdesk.dev&state=${state}`)
      .set("Cookie", pkceCookie)
      .expect(400);
    const replayBody = replayRes.body as { code: string };
    expect(replayBody.code).toBe("AUTH_STATE_INVALID");

    // 4. Access protected GET /api/v1/auth/session with session cookie
    const sessionRes = await request(app)
      .get("/api/v1/auth/session")
      .set("Cookie", sessionCookieStr!)
      .expect(200);

    expect(sessionRes.body).toMatchObject({
      user: {
        email: "alice@flowdesk.dev",
        displayName: "Alice"
      }
    });

    // 5. Accessing session without cookie fails with 401
    const unauthRes = await request(app).get("/api/v1/auth/session").expect(401);
    const unauthBody = unauthRes.body as { code: string };
    expect(unauthBody.code).toBe("UNAUTHORIZED");

    // 6. Logout revokes the session and clears cookie
    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", sessionCookieStr!)
      .expect(200);

    expect(logoutRes.body).toMatchObject({ status: "ok" });
    const logoutCookies = getCookies(logoutRes.headers["set-cookie"]);
    expect(logoutCookies[0]).toContain("Max-Age=0");

    // 7. Subsequent access with revoked session token fails with 401 SESSION_EXPIRED
    const revokedRes = await request(app)
      .get("/api/v1/auth/session")
      .set("Cookie", sessionCookieStr!)
      .expect(401);

    const revokedBody = revokedRes.body as { code: string };
    expect(revokedBody.code).toBe("SESSION_EXPIRED");
  });
});

describe("M1-10 Upstream Auth0/OIDC SSO termination on logout and prompt control", () => {
  it("POST /api/v1/auth/logout revokes session, clears cookie, and returns safe logoutUrl", async () => {
    const db = createMockDb();
    const config = loadAuthConfig({
      AUTH_COOKIE_SECURE: "false",
      AUTH_MOCK_ENABLED: "true",
      APP_BASE_URL: "https://app.flowdesk.dev",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/flowdesk"
    });
    const app = createApiApp({
      service: "api",
      version: "test",
      gitSha: "test-sha",
      environment: "local",
      auth: {
        db,
        config,
        identityProvider: new MockIdentityProvider()
      }
    });

    // Login first to obtain session
    const loginRes = await request(app)
      .get("/api/v1/auth/login")
      .set("Accept", "application/json")
      .expect(200);
    const callbackUrl = new URL((loginRes.body as { authorizationUrl: string }).authorizationUrl);
    const code = callbackUrl.searchParams.get("code")!;
    const state = callbackUrl.searchParams.get("state")!;
    const callbackRes = await request(app)
      .get(`/api/v1/auth/callback?code=${code}&state=${state}`)
      .set("Accept", "application/json")
      .expect(200);
    const sessionCookie = getCookies(callbackRes.headers["set-cookie"])[0]!;

    // POST logout
    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", sessionCookie)
      .set("Accept", "application/json")
      .expect(200);

    expect(logoutRes.body).toEqual({
      status: "ok",
      logoutUrl: "https://app.flowdesk.dev"
    });
    expect(getCookies(logoutRes.headers["set-cookie"])[0]).toContain("Max-Age=0");

    // Session is now revoked
    await request(app).get("/api/v1/auth/session").set("Cookie", sessionCookie).expect(401);
  });

  it("GET /api/v1/auth/logout revokes session, clears cookie, and redirects with 302 to logoutUrl", async () => {
    const db = createMockDb();
    const config = loadAuthConfig({
      AUTH_COOKIE_SECURE: "false",
      AUTH_MOCK_ENABLED: "true",
      APP_BASE_URL: "https://app.flowdesk.dev",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/flowdesk"
    });
    const app = createApiApp({
      service: "api",
      version: "test",
      gitSha: "test-sha",
      environment: "local",
      auth: {
        db,
        config,
        identityProvider: new MockIdentityProvider()
      }
    });

    // Perform GET logout
    const logoutRes = await request(app).get("/api/v1/auth/logout?returnTo=/login").expect(302);

    expect(logoutRes.headers["location"]).toBe("https://app.flowdesk.dev/login");
    expect(getCookies(logoutRes.headers["set-cookie"])[0]).toContain("Max-Age=0");
  });

  it("POST /api/v1/auth/logout validates returnTo and prevents open redirects", async () => {
    const db = createMockDb();
    const config = loadAuthConfig({
      AUTH_COOKIE_SECURE: "false",
      AUTH_MOCK_ENABLED: "true",
      APP_BASE_URL: "https://app.flowdesk.dev",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/flowdesk"
    });
    const app = createApiApp({
      service: "api",
      version: "test",
      gitSha: "test-sha",
      environment: "local",
      auth: {
        db,
        config,
        identityProvider: new MockIdentityProvider()
      }
    });

    // Malicious returnTo attempt
    const maliciousRes = await request(app)
      .post("/api/v1/auth/logout?returnTo=https://evil.com/phish")
      .set("Accept", "application/json")
      .expect(200);

    // Falls back to safe APP_BASE_URL
    expect((maliciousRes.body as { logoutUrl: string }).logoutUrl).toBe("https://app.flowdesk.dev");

    // Valid relative path returnTo
    const safeRes = await request(app)
      .post("/api/v1/auth/logout?returnTo=/logged-out")
      .set("Accept", "application/json")
      .expect(200);

    expect((safeRes.body as { logoutUrl: string }).logoutUrl).toBe(
      "https://app.flowdesk.dev/logged-out"
    );
  });

  it("constructs upstream Auth0 v2 logout URL when configured in OIDC mode without exposing secrets", async () => {
    const db = createMockDb();
    const config = loadAuthConfig({
      AUTH_COOKIE_SECURE: "false",
      AUTH_MOCK_ENABLED: "false",
      AUTH_OIDC_ISSUER: "https://flowdesk-dev.us.auth0.com",
      AUTH_OIDC_CLIENT_ID: "auth0-client-id-abc",
      AUTH_OIDC_CLIENT_SECRET: "super-secret-key-12345",
      APP_BASE_URL: "https://app.flowdesk.dev",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/flowdesk"
    });
    const app = createApiApp({
      service: "api",
      version: "test",
      gitSha: "test-sha",
      environment: "local",
      auth: {
        db,
        config,
        identityProvider: new MockIdentityProvider()
      }
    });

    const logoutRes = await request(app)
      .post("/api/v1/auth/logout?returnTo=/goodbye")
      .set("Accept", "application/json")
      .expect(200);

    const logoutUrl = (logoutRes.body as { logoutUrl: string }).logoutUrl;
    expect(logoutUrl).toBe(
      "https://flowdesk-dev.us.auth0.com/v2/logout?client_id=auth0-client-id-abc&returnTo=https%3A%2F%2Fapp.flowdesk.dev%2Fgoodbye"
    );
    expect(logoutUrl).not.toContain("super-secret-key");
    expect(logoutUrl).not.toContain("client_secret");
  });

  it("handles prompt parameter on login/authorize: normal SSO preserved vs forced reauth and switch account", async () => {
    const db = createMockDb();
    const config = loadAuthConfig({
      AUTH_COOKIE_SECURE: "false",
      AUTH_MOCK_ENABLED: "false",
      AUTH_OIDC_ISSUER: "https://flowdesk-dev.us.auth0.com",
      AUTH_OIDC_CLIENT_ID: "auth0-client-id-abc",
      APP_BASE_URL: "https://app.flowdesk.dev",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/flowdesk"
    });
    const app = createApiApp({
      service: "api",
      version: "test",
      gitSha: "test-sha",
      environment: "local",
      auth: {
        db,
        config,
        identityProvider: new MockIdentityProvider()
      }
    });

    // 1. Normal login: prompt omitted to preserve standard SSO session
    const normalRes = await request(app)
      .get("/api/v1/auth/login")
      .set("Accept", "application/json")
      .expect(200);
    const normalUrl = new URL((normalRes.body as { authorizationUrl: string }).authorizationUrl);
    expect(normalUrl.searchParams.has("prompt")).toBe(false);

    // 2. Forced reauthentication: prompt=login
    const reauthRes = await request(app)
      .get("/api/v1/auth/login?prompt=login")
      .set("Accept", "application/json")
      .expect(200);
    const reauthUrl = new URL((reauthRes.body as { authorizationUrl: string }).authorizationUrl);
    expect(reauthUrl.searchParams.get("prompt")).toBe("login");

    // 3. Switch account: prompt=select_account (or ?switch=true)
    const switchRes = await request(app)
      .get("/api/v1/auth/login?switch=true")
      .set("Accept", "application/json")
      .expect(200);
    const switchUrl = new URL((switchRes.body as { authorizationUrl: string }).authorizationUrl);
    expect(switchUrl.searchParams.get("prompt")).toBe("select_account");
  });
});
