import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadAuthConfig } from "@flowdesk/config";
import { createChannel, withTenantTransaction } from "@flowdesk/db";
import {
  decryptWhatsAppChannelCredentials,
  hashSessionToken,
  serializeSessionCookie
} from "@flowdesk/security";
import { FakeWhatsAppProvider, WhatsAppProviderError } from "@flowdesk/providers";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApp } from "./app.js";
import { resolveAccessToken } from "../../worker/src/dispatch.js";

const executeFile = promisify(execFile);
const connectionString = process.env["DATABASE_MIGRATOR_URL"];
const integration = connectionString ? describe : describe.skip;
const migrationScript = fileURLToPath(
  new URL("../../../packages/db/scripts/migrate.mjs", import.meta.url)
);

const pool = connectionString ? new Pool({ connectionString, max: 4 }) : undefined;
const ownerUserId = randomUUID();
const otherOwnerUserId = randomUUID();
const sessionToken = `channel-integration-${randomUUID()}`;
const encryptionKey = "channel-api-worker-integration-key";
const initialAccessToken = "integration-meta-system-user-token";
const rotatedAccessToken = "integration-meta-rotated-token";
const phoneNumberId = `phone-${randomUUID()}`;
const wabaId = `waba-${randomUUID()}`;
let organizationA = "";
let organizationB = "";
let channelId = "";
let conversationId = "";
let messageId = "";

beforeAll(async () => {
  if (!pool) return;

  await executeFile(process.execPath, [migrationScript], { env: process.env });
  await pool.query(
    `INSERT INTO flowdesk.users (id, email, display_name) VALUES
       ($1, $2, 'Channel Integration Owner'),
       ($3, $4, 'Other Tenant Owner')`,
    [
      ownerUserId,
      `channel-owner-${ownerUserId}@flowdesk.test`,
      otherOwnerUserId,
      `channel-other-${otherOwnerUserId}@flowdesk.test`
    ]
  );

  const createdA = await pool.query<{ organization_id: string }>(
    "SELECT organization_id FROM flowdesk.bootstrap_organization($1, $2, $3)",
    [`channel-a-${ownerUserId.slice(0, 8)}`, "Channel Integration A", ownerUserId]
  );
  const createdB = await pool.query<{ organization_id: string }>(
    "SELECT organization_id FROM flowdesk.bootstrap_organization($1, $2, $3)",
    [`channel-b-${otherOwnerUserId.slice(0, 8)}`, "Channel Integration B", otherOwnerUserId]
  );
  organizationA = createdA.rows[0]!.organization_id;
  organizationB = createdB.rows[0]!.organization_id;

  await pool.query(
    `INSERT INTO flowdesk.auth_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, clock_timestamp() + interval '1 hour')`,
    [ownerUserId, hashSessionToken(sessionToken)]
  );
});

afterAll(async () => {
  if (!pool) return;

  await pool.query(
    "DELETE FROM flowdesk.outbound_intents WHERE organization_id = ANY($1::uuid[])",
    [[organizationA, organizationB]]
  );
  await pool.query("DELETE FROM flowdesk.messages WHERE organization_id = ANY($1::uuid[])", [
    [organizationA, organizationB]
  ]);
  await pool.query("DELETE FROM flowdesk.conversations WHERE organization_id = ANY($1::uuid[])", [
    [organizationA, organizationB]
  ]);
  await pool.query("DELETE FROM flowdesk.contacts WHERE organization_id = ANY($1::uuid[])", [
    [organizationA, organizationB]
  ]);
  await pool.query("DELETE FROM flowdesk.channels WHERE organization_id = ANY($1::uuid[])", [
    [organizationA, organizationB]
  ]);
  await pool.query(
    "DELETE FROM flowdesk.whatsapp_embedded_signup_attempts WHERE organization_id = ANY($1::uuid[])",
    [[organizationA, organizationB]]
  );
  await pool.query(
    "DELETE FROM flowdesk.whatsapp_business_accounts WHERE organization_id = ANY($1::uuid[])",
    [[organizationA, organizationB]]
  );
  await pool.query("DELETE FROM flowdesk.audit_logs WHERE organization_id = ANY($1::uuid[])", [
    [organizationA, organizationB]
  ]);
  await pool.query(
    "DELETE FROM flowdesk.realtime_versions WHERE organization_id = ANY($1::uuid[])",
    [[organizationA, organizationB]]
  );
  await pool.query(
    "DELETE FROM flowdesk.organization_settings WHERE organization_id = ANY($1::uuid[])",
    [[organizationA, organizationB]]
  );
  await pool.query("DELETE FROM flowdesk.memberships WHERE organization_id = ANY($1::uuid[])", [
    [organizationA, organizationB]
  ]);
  await pool.query("DELETE FROM flowdesk.roles WHERE organization_id = ANY($1::uuid[])", [
    [organizationA, organizationB]
  ]);
  await pool.query("DELETE FROM flowdesk.organizations WHERE id = ANY($1::uuid[])", [
    [organizationA, organizationB]
  ]);
  await pool.query("DELETE FROM flowdesk.auth_sessions WHERE user_id = ANY($1::uuid[])", [
    [ownerUserId, otherOwnerUserId]
  ]);
  await pool.query("DELETE FROM flowdesk.users WHERE id = ANY($1::uuid[])", [
    [ownerUserId, otherOwnerUserId]
  ]);
  await pool.end();
});

integration("POST /api/v1/organizations/:orgId/channels with PostgreSQL RLS", () => {
  const config = loadAuthConfig({ NODE_ENV: "test" });
  const provider = new FakeWhatsAppProvider();
  const app = pool
    ? createApiApp({
        service: "api",
        version: "integration",
        gitSha: "integration",
        environment: "local",
        auth: {
          db: pool,
          config,
          encryptionKey,
          whatsappProvider: provider,
          embeddedSignup: {
            appId: "integration-meta-app-id",
            appSecret: "integration-meta-app-secret",
            configId: "integration-meta-embedded-config",
            systemUserAccessToken: "integration-meta-system-user-token",
            systemUserId: "integration-meta-system-user-id",
            adminSystemUserAccessToken: "integration-meta-admin-system-user-token",
            graphApiBaseUrl: "https://graph.facebook.com/v25.0"
          }
        }
      })
    : undefined;
  const ownerCookie = serializeSessionCookie(sessionToken, false);

  it("connects with the exact verified customer token as flowdesk_runtime", async () => {
    if (!pool || !app) throw new Error("integration database unavailable");

    const runtimeIdentity = await withTenantTransaction(
      pool,
      { organizationId: organizationA },
      (db) => db.query<{ current_user: string }>("SELECT current_user")
    );
    expect(runtimeIdentity.rows[0]?.current_user).toBe("flowdesk_runtime");

    const response = await request(app)
      .post(`/api/v1/organizations/${organizationA}/channels`)
      .set("Cookie", ownerCookie)
      .send({
        name: "Integration WhatsApp",
        phoneNumberId,
        wabaId,
        accessToken: initialAccessToken
      });

    expect(response.status).toBe(201);
    const responseBody: unknown = response.body;
    expect(responseBody).toMatchObject({
      channel: { organizationId: organizationA, status: "active" }
    });
    if (
      typeof responseBody !== "object" ||
      responseBody === null ||
      !("channel" in responseBody) ||
      typeof responseBody.channel !== "object" ||
      responseBody.channel === null ||
      !("id" in responseBody.channel) ||
      typeof responseBody.channel.id !== "string"
    ) {
      throw new Error("Channel creation response did not contain a string ID");
    }
    channelId = responseBody.channel.id;
    const stored = await pool.query<{ encrypted_credentials: string }>(
      "SELECT encrypted_credentials FROM flowdesk.channels WHERE id = $1",
      [channelId]
    );
    expect(stored.rows[0]?.encrypted_credentials).not.toContain(initialAccessToken);
    expect(
      decryptWhatsAppChannelCredentials(stored.rows[0]!.encrypted_credentials, encryptionKey)
    ).toEqual({ accessToken: initialAccessToken, phoneNumberId, wabaId });
    expect(
      resolveAccessToken(stored.rows[0]!.encrypted_credentials, encryptionKey, {
        phoneNumberId,
        wabaId
      })
    ).toBe(initialAccessToken);
    expect(
      (
        await pool.query<{ count: string }>(
          "SELECT count(*) FROM flowdesk.channels WHERE organization_id = $1",
          [organizationA]
        )
      ).rows[0]?.count
    ).toBe("1");
  });

  it("rotates a verified token in place and preserves conversation/message links", async () => {
    if (!pool || !app) throw new Error("integration database unavailable");

    const contact = await pool.query<{ id: string }>(
      `INSERT INTO flowdesk.contacts (organization_id, channel_id, phone_number)
       VALUES ($1, $2, '+628123456789') RETURNING id`,
      [organizationA, channelId]
    );
    const conversation = await pool.query<{ id: string }>(
      `INSERT INTO flowdesk.conversations
         (organization_id, channel_id, contact_id, customer_phone, customer_name)
       VALUES ($1, $2, $3, '+628123456789', 'Credential Rotation Customer') RETURNING id`,
      [organizationA, channelId, contact.rows[0]!.id]
    );
    conversationId = conversation.rows[0]!.id;
    const message = await pool.query<{ id: string }>(
      `INSERT INTO flowdesk.messages
         (organization_id, conversation_id, channel_id, direction, sender_type, content, status)
       VALUES ($1, $2, $3, 'inbound', 'customer', 'Preserve me', 'delivered') RETURNING id`,
      [organizationA, conversationId, channelId]
    );
    messageId = message.rows[0]!.id;

    const response = await request(app)
      .patch(`/api/v1/organizations/${organizationA}/channels/${channelId}/credentials`)
      .set("Cookie", ownerCookie)
      .send({ accessToken: rotatedAccessToken });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      channelId,
      organizationId: organizationA
    });

    const persisted = await pool.query<{
      id: string;
      encrypted_credentials: string;
    }>("SELECT id, encrypted_credentials FROM flowdesk.channels WHERE id = $1", [channelId]);
    expect(persisted.rows[0]?.id).toBe(channelId);
    expect(
      resolveAccessToken(persisted.rows[0]!.encrypted_credentials, encryptionKey, {
        phoneNumberId,
        wabaId
      })
    ).toBe(rotatedAccessToken);
    expect(
      (
        await pool.query<{ channel_id: string }>(
          "SELECT channel_id FROM flowdesk.conversations WHERE id = $1",
          [conversationId]
        )
      ).rows[0]?.channel_id
    ).toBe(channelId);
    expect(
      (
        await pool.query<{ channel_id: string; conversation_id: string }>(
          "SELECT channel_id, conversation_id FROM flowdesk.messages WHERE id = $1",
          [messageId]
        )
      ).rows[0]
    ).toEqual({ channel_id: channelId, conversation_id: conversationId });
  });

  it("denies cross-tenant reconnect attempts", async () => {
    if (!pool || !app) throw new Error("integration database unavailable");
    const response = await request(app)
      .post(`/api/v1/organizations/${organizationB}/channels/whatsapp/embedded-signup/start`)
      .set("Cookie", ownerCookie);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: "NOT_A_MEMBER" });
  });

  it("denies every cross-tenant read, verify, status update, and delete operation", async () => {
    if (!pool || !app) throw new Error("integration database unavailable");

    const responses = await Promise.all([
      request(app)
        .get(`/api/v1/organizations/${organizationB}/channels`)
        .set("Cookie", ownerCookie),
      request(app)
        .post(`/api/v1/organizations/${organizationB}/channels/${channelId}/verify`)
        .set("Cookie", ownerCookie),
      request(app)
        .patch(`/api/v1/organizations/${organizationB}/channels/${channelId}`)
        .set("Cookie", ownerCookie)
        .send({ status: "inactive", statusReason: "must not be written" }),
      request(app)
        .delete(`/api/v1/organizations/${organizationB}/channels/${channelId}`)
        .set("Cookie", ownerCookie)
    ]);

    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ code: "NOT_A_MEMBER" });
    }

    const persisted = await pool.query<{ status: string }>(
      "SELECT status FROM flowdesk.channels WHERE id = $1",
      [channelId]
    );
    expect(persisted.rows[0]?.status).toBe("active");
  });

  it("uses Meta verification and returns revoked/expired state", async () => {
    if (!app) throw new Error("integration database unavailable");
    provider.simulateFailure = () =>
      new WhatsAppProviderError({
        message: "token redacted",
        classification: "AUTH_FAILED",
        statusCode: 401,
        providerCode: 190
      });
    const response = await request(app)
      .post(`/api/v1/organizations/${organizationA}/channels/${channelId}/verify`)
      .set("Cookie", ownerCookie);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      verified: false,
      state: "revoked_or_expired"
    });
    provider.simulateFailure = undefined;
  });

  it("denies cross-tenant creation before the handler and at the RLS boundary", async () => {
    if (!pool || !app) throw new Error("integration database unavailable");

    const response = await request(app)
      .post(`/api/v1/organizations/${organizationB}/channels`)
      .set("Cookie", ownerCookie)
      .send({
        name: "Forbidden WhatsApp",
        phoneNumberId: `phone-${randomUUID()}`,
        wabaId: `waba-${randomUUID()}`,
        accessToken: "must-not-be-written"
      });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: "NOT_A_MEMBER" });
    expect(
      (
        await pool.query<{ count: string }>(
          "SELECT count(*) FROM flowdesk.channels WHERE organization_id = $1",
          [organizationB]
        )
      ).rows[0]?.count
    ).toBe("0");

    await expect(
      withTenantTransaction(pool, { organizationId: organizationA }, (db) =>
        createChannel(db, {
          organizationId: organizationB,
          name: "RLS Backstop",
          phoneNumberId: `phone-${randomUUID()}`,
          wabaId: `waba-${randomUUID()}`,
          encryptedCredentials: "encrypted-test-value"
        })
      )
    ).rejects.toMatchObject({ code: "42501" });
  });
});
