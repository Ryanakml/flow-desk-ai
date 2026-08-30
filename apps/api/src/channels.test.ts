import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { loadAuthConfig } from "@flowdesk/config";
import type { DbClient } from "@flowdesk/db";
import { hashSessionToken, serializeSessionCookie, encryptSecret } from "@flowdesk/security";
import { FakeWhatsAppProvider } from "@flowdesk/providers";
import { createApiApp } from "./app.js";

const orgId = "a0000000-0000-4000-8000-000000000001";
const adminUserId = "a0000000-0000-4000-8000-000000000010";

interface MockChannelRow {
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

function createMockDb(): DbClient {
  const users = new Map<
    string,
    { id: string; email: string; displayName: string; status: string }
  >();
  const sessions = new Map<
    string,
    { id: string; userId: string; tokenHash: string; expiresAt: Date; revokedAt: Date | null }
  >();
  const orgs = new Map<string, { id: string; slug: string; name: string }>();
  const roles = new Map<string, { id: string; orgId: string; key: string; label: string }>();
  const memberships = new Map<
    string,
    { id: string; orgId: string; userId: string; roleId: string; status: string; createdAt: Date }
  >();
  const channels = new Map<string, MockChannelRow>();
  const signupAttempts = new Map<
    string,
    {
      id: string;
      organization_id: string;
      state_hash: string;
      status: "initiated" | "processing" | "completed" | "failed";
      expires_at: Date;
    }
  >();
  const wabaOwners = new Map<string, string>();

  users.set(adminUserId, {
    id: adminUserId,
    email: "admin@flowdesk.dev",
    displayName: "Admin",
    status: "active"
  });

  const rawAdminToken = "admin-token-12345";
  sessions.set("s-admin", {
    id: "s-admin",
    userId: adminUserId,
    tokenHash: hashSessionToken(rawAdminToken),
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null
  });

  orgs.set(orgId, { id: orgId, slug: "acme", name: "Acme Corp" });
  roles.set("r-owner", { id: "r-owner", orgId, key: "owner", label: "Owner" });
  memberships.set("m-admin", {
    id: "m-admin",
    orgId,
    userId: adminUserId,
    roleId: "r-owner",
    status: "active",
    createdAt: new Date()
  });

  const sampleEncrypted = JSON.stringify(
    encryptSecret(
      JSON.stringify({
        accessToken: "EAAG123456789",
        phoneNumberId: "10987654321",
        wabaId: "9876543210"
      }),
      "dev-encryption-key-32-bytes-long!!"
    )
  );

  channels.set("c1", {
    id: "c1",
    organization_id: orgId,
    type: "whatsapp",
    name: "Main Support WhatsApp",
    phone_number_id: "10987654321",
    waba_id: "9876543210",
    encrypted_credentials: sampleEncrypted,
    status: "active",
    status_reason: null,
    metadata: {},
    created_at: new Date(),
    updated_at: new Date()
  });

  return {
    async query(queryText: string, params: unknown[] = []) {
      await Promise.resolve();
      const sql = queryText.replace(/\s+/g, " ").trim();

      if (sql.includes("FROM flowdesk.auth_sessions")) {
        const hash = params[0] as string;
        for (const s of sessions.values()) {
          if (s.tokenHash === hash && !s.revokedAt) {
            return {
              rows: [{ id: s.id, user_id: s.userId, expires_at: s.expiresAt }],
              rowCount: 1,
              command: "SELECT",
              oid: 0,
              fields: []
            };
          }
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      if (sql.includes("FROM flowdesk.users")) {
        const uid = params[0] as string;
        const u = users.get(uid);
        return u
          ? {
              rows: [{ id: u.id, email: u.email, display_name: u.displayName, status: u.status }],
              rowCount: 1,
              command: "SELECT",
              oid: 0,
              fields: []
            }
          : { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      if (sql.includes("FROM flowdesk.memberships")) {
        const oId = params[0] as string;
        const uId = params[1] as string;
        for (const m of memberships.values()) {
          if (m.orgId === oId && m.userId === uId && m.status === "active") {
            const role = roles.get(m.roleId);
            return {
              rows: [{ role_key: role?.key ?? "agent" }],
              rowCount: 1,
              command: "SELECT",
              oid: 0,
              fields: []
            };
          }
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      if (sql.includes("SELECT * FROM flowdesk.channels WHERE organization_id = $1")) {
        const orgIdParam = params[0] as string;
        const matched = Array.from(channels.values()).filter(
          (c) => c.organization_id === orgIdParam
        );
        return { rows: matched, rowCount: matched.length, command: "SELECT", oid: 0, fields: [] };
      }

      if (sql.includes("SELECT * FROM flowdesk.channels WHERE phone_number_id = $1")) {
        const phoneNumberId = params[0] as string;
        const channel = Array.from(channels.values()).find(
          (candidate) => candidate.phone_number_id === phoneNumberId
        );
        return channel
          ? { rows: [channel], rowCount: 1, command: "SELECT", oid: 0, fields: [] }
          : { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      if (sql.includes("INSERT INTO flowdesk.whatsapp_embedded_signup_attempts")) {
        const id = `a0000000-0000-4000-8000-${String(signupAttempts.size + 1).padStart(12, "0")}`;
        const row = {
          id,
          organization_id: params[0] as string,
          state_hash: params[2] as string,
          status: "initiated" as const,
          expires_at: params[3] as Date
        };
        signupAttempts.set(id, row);
        return { rows: [row], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      if (
        sql.includes("UPDATE flowdesk.whatsapp_embedded_signup_attempts SET status = 'processing'")
      ) {
        const attempt = signupAttempts.get(params[0] as string);
        if (
          !attempt ||
          attempt.organization_id !== params[1] ||
          attempt.state_hash !== params[2] ||
          attempt.status !== "initiated" ||
          attempt.expires_at.getTime() <= Date.now()
        ) {
          return { rows: [], rowCount: 0, command: "UPDATE", oid: 0, fields: [] };
        }
        attempt.status = "processing";
        return { rows: [attempt], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
      }

      if (
        sql.includes("UPDATE flowdesk.whatsapp_embedded_signup_attempts SET status = 'completed'")
      ) {
        const attempt = signupAttempts.get(params[0] as string);
        if (attempt && attempt.organization_id === params[1]) attempt.status = "completed";
        return { rows: [], rowCount: attempt ? 1 : 0, command: "UPDATE", oid: 0, fields: [] };
      }

      if (sql.includes("UPDATE flowdesk.whatsapp_embedded_signup_attempts SET status = 'failed'")) {
        const attempt = signupAttempts.get(params[0] as string);
        if (attempt && attempt.organization_id === params[1]) attempt.status = "failed";
        return { rows: [], rowCount: attempt ? 1 : 0, command: "UPDATE", oid: 0, fields: [] };
      }

      if (sql.includes("INSERT INTO flowdesk.whatsapp_business_accounts")) {
        const wabaId = params[0] as string;
        const owner = params[1] as string;
        if (wabaOwners.has(wabaId)) {
          return { rows: [], rowCount: 0, command: "INSERT", oid: 0, fields: [] };
        }
        wabaOwners.set(wabaId, owner);
        return { rows: [{ waba_id: wabaId }], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      if (sql.includes("FROM flowdesk.whatsapp_business_accounts")) {
        const wabaId = params[0] as string;
        const owner = params[1] as string;
        return wabaOwners.get(wabaId) === owner
          ? { rows: [{ waba_id: wabaId }], rowCount: 1, command: "SELECT", oid: 0, fields: [] }
          : { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      if (sql.includes("SELECT * FROM flowdesk.channels WHERE id = $1")) {
        const idParam = params[0] as string;
        const c = channels.get(idParam);
        return c
          ? { rows: [c], rowCount: 1, command: "SELECT", oid: 0, fields: [] }
          : { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      if (sql.includes("INSERT INTO flowdesk.channels")) {
        const newId = `c-${channels.size + 1}`;
        const row: MockChannelRow = {
          id: newId,
          organization_id: params[0] as string,
          type: params[1] as string,
          name: params[2] as string,
          phone_number_id: params[3] as string,
          waba_id: params[4] as string,
          encrypted_credentials: params[5] as string,
          status: params[6] as string,
          status_reason: params[7] as string | null,
          metadata: JSON.parse((params[8] as string) || "{}") as Record<string, unknown>,
          created_at: new Date(),
          updated_at: new Date()
        };
        channels.set(newId, row);
        return { rows: [row], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      if (sql.includes("SET encrypted_credentials = $3")) {
        const idParam = params[0] as string;
        const orgIdParam = params[1] as string;
        const channel = channels.get(idParam);
        if (!channel || channel.organization_id !== orgIdParam) {
          return { rows: [], rowCount: 0, command: "UPDATE", oid: 0, fields: [] };
        }
        channel.encrypted_credentials = params[2] as string;
        channel.updated_at = new Date();
        return { rows: [channel], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
      }

      if (sql.includes("UPDATE flowdesk.channels")) {
        const idParam = params[0] as string;
        const statusParam = params[1] as string;
        const reasonParam = params[2] as string | null;
        const c = channels.get(idParam);
        if (c) {
          c.status = statusParam;
          c.status_reason = reasonParam;
          c.updated_at = new Date();
          return { rows: [c], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "UPDATE", oid: 0, fields: [] };
      }

      if (sql.includes("DELETE FROM flowdesk.channels")) {
        const idParam = params[0] as string;
        const deleted = channels.delete(idParam);
        return { rows: [], rowCount: deleted ? 1 : 0, command: "DELETE", oid: 0, fields: [] };
      }

      if (sql.includes("flowdesk.audit_events") || sql.includes("audit")) {
        return {
          rows: [{ id: "audit-1", occurred_at: new Date() }],
          rowCount: 1,
          command: "INSERT",
          oid: 0,
          fields: []
        };
      }

      return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
    }
  } as unknown as DbClient;
}

describe("Self-Service Channels REST API (M6-01)", () => {
  const config = loadAuthConfig({ NODE_ENV: "test" });
  const db = createMockDb();
  const provider = new FakeWhatsAppProvider();
  const verifyPhoneNumber = vi.spyOn(provider, "verifyPhoneNumber");
  const app = createApiApp({
    service: "api",
    version: "dev",
    gitSha: "dev",
    environment: "local",
    auth: {
      db,
      config,
      encryptionKey: "dev-encryption-key-32-bytes-long!!",
      whatsappProvider: provider,
      embeddedSignup: {
        appId: "flowdesk-meta-app-id",
        appSecret: "flowdesk-meta-app-secret",
        configId: "flowdesk-embedded-signup-config",
        systemUserAccessToken: "flowdesk-system-user-token",
        systemUserId: "flowdesk-system-user-id",
        adminSystemUserAccessToken: "flowdesk-admin-system-user-token",
        graphApiBaseUrl: "https://graph.facebook.com/v25.0"
      }
    }
  });

  const adminCookie = serializeSessionCookie("admin-token-12345", false);

  it("GET /api/v1/organizations/:orgId/channels lists tenant channels", async () => {
    const res = (await request(app)
      .get(`/api/v1/organizations/${orgId}/channels`)
      .set("Cookie", adminCookie)) as unknown as { status: number; body: unknown };

    expect(res.status).toBe(200);
    const body = res.body as Array<{ id: string; name: string; phoneNumberId: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.name).toBe("Main Support WhatsApp");
    expect(body[0]?.phoneNumberId).toBe("10987654321");
  });

  it("completes Embedded Signup server-side and only activates after Meta validation and subscription", async () => {
    const start = (await request(app)
      .post(`/api/v1/organizations/${orgId}/channels/whatsapp/embedded-signup/start`)
      .set("Cookie", adminCookie)) as unknown as { status: number; body: unknown };
    expect(start.status).toBe(201);
    const startBody = start.body as {
      attemptId: string;
      state: string;
      appId: string;
      appSecret?: string;
    };
    expect(startBody.appId).toBe("flowdesk-meta-app-id");
    expect(startBody.state.length).toBeGreaterThanOrEqual(32);
    expect(startBody.appSecret).toBeUndefined();

    const exchangeCode = vi.spyOn(provider, "exchangeEmbeddedSignupCode");
    const assignSystemUser = vi.spyOn(provider, "assignWhatsAppBusinessAccountSystemUser");
    const subscribe = vi.spyOn(provider, "subscribeWhatsAppBusinessAccount");
    const complete = (await request(app)
      .post(`/api/v1/organizations/${orgId}/channels/whatsapp/embedded-signup/complete`)
      .set("Cookie", adminCookie)
      .send({
        attemptId: startBody.attemptId,
        state: startBody.state,
        code: "one-time-meta-code",
        phoneNumberId: "10987654399",
        wabaId: "9876543299"
      })) as unknown as { status: number; body: unknown };

    expect(complete.status).toBe(201);
    expect(complete.body).toMatchObject({
      channel: { status: "active", phoneNumberId: "10987654399" }
    });
    expect(exchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({ code: "one-time-meta-code", appSecret: "flowdesk-meta-app-secret" })
    );
    expect(verifyPhoneNumber).toHaveBeenNthCalledWith(1, {
      phoneNumberId: "10987654399",
      wabaId: "9876543299",
      accessToken: "fake-embedded-signup-one-time-meta-code"
    });
    expect(assignSystemUser).toHaveBeenCalledWith(
      expect.objectContaining({
        wabaId: "9876543299",
        systemUserId: "flowdesk-system-user-id",
        adminAccessToken: "flowdesk-admin-system-user-token"
      })
    );
    expect(verifyPhoneNumber).toHaveBeenNthCalledWith(2, {
      phoneNumberId: "10987654399",
      wabaId: "9876543299",
      accessToken: "flowdesk-system-user-token"
    });
    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ wabaId: "9876543299", accessToken: "flowdesk-system-user-token" })
    );

    const replay = await request(app)
      .post(`/api/v1/organizations/${orgId}/channels/whatsapp/embedded-signup/complete`)
      .set("Cookie", adminCookie)
      .send({
        attemptId: startBody.attemptId,
        state: startBody.state,
        code: "one-time-meta-code",
        phoneNumberId: "10987654399",
        wabaId: "9876543299"
      });
    expect(replay.status).toBe(409);
  });

  it("retires the manual credential endpoint", async () => {
    const response = await request(app)
      .post(`/api/v1/organizations/${orgId}/channels`)
      .set("Cookie", adminCookie)
      .send({
        name: "No longer accepted",
        phoneNumberId: "10987654399",
        wabaId: "9876543299",
        accessToken: "EAAG_TEST_TOKEN_XYZ"
      });
    expect(response.status).toBe(410);
  });

  it("POST /api/v1/organizations/:orgId/channels/:channelId/verify verifies credentials", async () => {
    const res = (await request(app)
      .post(`/api/v1/organizations/${orgId}/channels/c1/verify`)
      .set("Cookie", adminCookie)) as unknown as { status: number; body: unknown };

    expect(res.status).toBe(200);
    const body = res.body as { verified: boolean; status: string };
    expect(body.verified).toBe(true);
    expect(body.status).toBe("active");
    expect(verifyPhoneNumber).toHaveBeenCalledWith({
      phoneNumberId: "10987654321",
      wabaId: "9876543210",
      accessToken: "EAAG123456789"
    });
  });

  it("DELETE /api/v1/organizations/:orgId/channels/:channelId deletes channel", async () => {
    const res = (await request(app)
      .delete(`/api/v1/organizations/${orgId}/channels/c1`)
      .set("Cookie", adminCookie)) as unknown as { status: number; body: unknown };

    expect(res.status).toBe(200);
    const body = res.body as { success: boolean; channelId: string };
    expect(body.success).toBe(true);
    expect(body.channelId).toBe("c1");
  });
});
