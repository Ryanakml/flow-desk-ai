import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTransaction } from "./tenant-context.js";

const executeFile = promisify(execFile);
const connectionString = process.env["DATABASE_MIGRATOR_URL"];
const migrationScript = fileURLToPath(new URL("../scripts/migrate.mjs", import.meta.url));

if (!connectionString)
  throw new Error("DATABASE_MIGRATOR_URL is required for database integration tests.");

const admin = new Client({ connectionString });

beforeAll(async () => {
  await admin.connect();
  await executeFile(process.execPath, [migrationScript], { env: process.env });
  // A second execution models an environment already at the prior schema version.
  await executeFile(process.execPath, [migrationScript], { env: process.env });
});

afterAll(async () => admin.end());

describe("database foundation", () => {
  it("records a stable migration and required extensions", async () => {
    const migrations = await admin.query<{ version: string }>(
      "SELECT version FROM flowdesk_meta.schema_migrations ORDER BY version"
    );
    const extensions = await admin.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto', 'vector') ORDER BY extname"
    );

    expect(migrations.rows.map((row) => row.version)).toEqual([
      "0001_database_foundation.sql",
      "0002_m1_core_schema.sql",
      "0003_tenant_rls.sql",
      "0004_auth_sessions.sql",
      "0005_invitations.sql",
      "0006_channels.sql"
    ]);
    expect(extensions.rows.map((row) => row.extname)).toEqual(["pgcrypto", "vector"]);
  });

  it("denies schema, role, RLS, and data privileges to the runtime role", async () => {
    await admin.query("SET ROLE flowdesk_runtime");
    try {
      await expect(admin.query("CREATE SCHEMA runtime_must_not_create")).rejects.toThrow();
      await expect(admin.query("CREATE ROLE runtime_must_not_create LOGIN")).rejects.toThrow();
      await expect(
        admin.query("ALTER TABLE flowdesk_meta.schema_migrations DISABLE ROW LEVEL SECURITY")
      ).rejects.toThrow();
      await expect(
        admin.query("SELECT * FROM flowdesk_meta.break_glass_access_log")
      ).rejects.toThrow();
    } finally {
      await admin.query("RESET ROLE");
    }
  });

  it("keeps runtime, reporting, and migration roles unable to bypass RLS", async () => {
    const result = await admin.query<{ rolname: string; rolbypassrls: boolean }>(
      `SELECT rolname, rolbypassrls
       FROM pg_roles
       WHERE rolname IN ('flowdesk_migrator', 'flowdesk_runtime', 'flowdesk_reporting', 'flowdesk_break_glass')
       ORDER BY rolname`
    );
    expect(result.rows).toEqual([
      { rolname: "flowdesk_break_glass", rolbypassrls: true },
      { rolname: "flowdesk_migrator", rolbypassrls: false },
      { rolname: "flowdesk_reporting", rolbypassrls: false },
      { rolname: "flowdesk_runtime", rolbypassrls: false }
    ]);
  });

  it("creates the core tables with tenant keys and required indexes", async () => {
    const tables = await admin.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'flowdesk' ORDER BY table_name`
    );
    const tenantColumns = await admin.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'flowdesk' AND column_name = 'organization_id' AND is_nullable = 'NO'`
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "audit_logs",
      "auth_sessions",
      "channels",
      "idempotency_keys",
      "identities",
      "invitations",
      "memberships",
      "oidc_authorization_transactions",
      "organization_settings",
      "organizations",
      "outbox_events",
      "roles",
      "users"
    ]);
    expect(tenantColumns.rows.map((row) => row.table_name).sort()).toEqual([
      "audit_logs",
      "channels",
      "idempotency_keys",
      "invitations",
      "memberships",
      "organization_settings",
      "outbox_events",
      "roles"
    ]);
  });

  it("fails closed without context and denies organization B from organization A", async () => {
    const organizationA = "00000000-0000-7000-8000-0000000000a1";
    const organizationB = "00000000-0000-7000-8000-0000000000b2";
    await admin.query(
      `INSERT INTO flowdesk.organizations (id, slug, display_name) VALUES
        ($1, 'tenant-a', 'Tenant A'), ($2, 'tenant-b', 'Tenant B') ON CONFLICT (id) DO NOTHING`,
      [organizationA, organizationB]
    );
    await admin.query("BEGIN");
    try {
      await admin.query("SET ROLE flowdesk_runtime");
      expect((await admin.query("SELECT id FROM flowdesk.organizations")).rows).toEqual([]);
      await admin.query("SELECT set_config('app.organization_id', $1, true)", [organizationA]);
      expect((await admin.query("SELECT id FROM flowdesk.organizations ORDER BY id")).rows).toEqual(
        [{ id: organizationA }]
      );
      await expect(
        admin.query(
          "INSERT INTO flowdesk.organizations (id, slug, display_name) VALUES ($1, 'tenant-b-write', 'Denied')",
          [organizationB]
        )
      ).rejects.toThrow();
    } finally {
      await admin.query("ROLLBACK");
      await admin.query("RESET ROLE");
    }
  });

  it("clears TenantContext after a transaction returns a pooled connection", async () => {
    const pool = new Pool({ connectionString });
    try {
      const rows = await withTenantTransaction(
        pool,
        { organizationId: "00000000-0000-7000-8000-0000000000a1" },
        async (client) => {
          await client.query("SET LOCAL ROLE flowdesk_runtime");
          return client.query<{ id: string }>("SELECT id FROM flowdesk.organizations ORDER BY id");
        }
      );
      expect(rows.rows).toEqual([{ id: "00000000-0000-7000-8000-0000000000a1" }]);
      const client = await pool.connect();
      try {
        expect(
          (
            await client.query(
              "SELECT NULLIF(current_setting('app.organization_id', true), '') AS organization_id"
            )
          ).rows
        ).toEqual([{ organization_id: null }]);
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  });
});
