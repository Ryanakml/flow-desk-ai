import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadAuthConfig } from "@flowdesk/config";
import { createChannel, withTenantTransaction } from "@flowdesk/db";
import { hashSessionToken, serializeSessionCookie } from "@flowdesk/security";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApp } from "./app.js";

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
let organizationA = "";
let organizationB = "";

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

  await pool.query("DELETE FROM flowdesk.channels WHERE organization_id = ANY($1::uuid[])", [
    [organizationA, organizationB]
  ]);
  await pool.query("DELETE FROM flowdesk.audit_logs WHERE organization_id = ANY($1::uuid[])", [
    [organizationA, organizationB]
  ]);
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
  const app = pool
    ? createApiApp({
        service: "api",
        version: "integration",
        gitSha: "integration",
        environment: "local",
        auth: { db: pool, config }
      })
    : undefined;
  const ownerCookie = serializeSessionCookie(sessionToken, false);

  it("creates for an authorized organization as flowdesk_runtime", async () => {
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
        name: "Authorized WhatsApp",
        phoneNumberId: `phone-${randomUUID()}`,
        wabaId: `waba-${randomUUID()}`,
        accessToken: "integration-access-token"
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      organizationId: organizationA,
      name: "Authorized WhatsApp",
      status: "active"
    });
    expect(
      (
        await pool.query<{ count: string }>(
          "SELECT count(*) FROM flowdesk.channels WHERE organization_id = $1",
          [organizationA]
        )
      ).rows[0]?.count
    ).toBe("1");
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
