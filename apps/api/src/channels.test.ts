import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadAuthConfig } from "@flowdesk/config";
import type { DbClient } from "@flowdesk/db";
import { hashSessionToken, serializeSessionCookie, encryptSecret } from "@flowdesk/security";
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
  const app = createApiApp({
    service: "api",
    version: "dev",
    gitSha: "dev",
    environment: "local",
    auth: { db, config }
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

  it("POST /api/v1/organizations/:orgId/channels creates and encrypts new channel", async () => {
    const res = (await request(app)
      .post(`/api/v1/organizations/${orgId}/channels`)
      .set("Cookie", adminCookie)
      .send({
        name: "Sales WhatsApp Line",
        phoneNumberId: "10987654399",
        wabaId: "9876543299",
        accessToken: "EAAG_TEST_TOKEN_XYZ"
      })) as unknown as { status: number; body: unknown };

    expect(res.status).toBe(201);
    const body = res.body as { id: string; name: string; status: string };
    expect(body.id).toBeDefined();
    expect(body.name).toBe("Sales WhatsApp Line");
    expect(body.status).toBe("active");
  });

  it("POST /api/v1/organizations/:orgId/channels/:channelId/verify verifies credentials", async () => {
    const res = (await request(app)
      .post(`/api/v1/organizations/${orgId}/channels/c1/verify`)
      .set("Cookie", adminCookie)) as unknown as { status: number; body: unknown };

    expect(res.status).toBe(200);
    const body = res.body as { verified: boolean; status: string };
    expect(body.verified).toBe(true);
    expect(body.status).toBe("active");
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
