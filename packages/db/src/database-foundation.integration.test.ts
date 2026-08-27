import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
      "0002_m1_core_schema.sql"
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

  it("creates the M1 core tables with tenant keys and required indexes", async () => {
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
      "idempotency_keys",
      "identities",
      "memberships",
      "organization_settings",
      "organizations",
      "outbox_events",
      "roles",
      "users"
    ]);
    expect(tenantColumns.rows.map((row) => row.table_name).sort()).toEqual([
      "audit_logs",
      "idempotency_keys",
      "memberships",
      "organization_settings",
      "outbox_events",
      "roles"
    ]);
  });
});
