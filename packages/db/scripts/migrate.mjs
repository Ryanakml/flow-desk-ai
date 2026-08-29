import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
if (!process.env.DATABASE_MIGRATOR_URL) {
  try {
    const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
    const envContent = await readFile(envPath, "utf8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch {
    // ignore if .env does not exist
  }
}

const connectionString = process.env.DATABASE_MIGRATOR_URL;

if (!connectionString) {
  throw new Error("DATABASE_MIGRATOR_URL is required; migrations never fall back to DATABASE_URL.");
}

const migrationDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
const migrations = (await readdir(migrationDirectory))
  .filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
  .sort();

const client = new Client({ connectionString });
await client.connect();

try {
  await client.query("SELECT pg_advisory_lock(834532101)");
  await client.query("CREATE SCHEMA IF NOT EXISTS flowdesk_meta");
  await client.query(`
    CREATE TABLE IF NOT EXISTS flowdesk_meta.schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      applied_by name NOT NULL DEFAULT current_user
    )
  `);

  for (const version of migrations) {
    const sql = await readFile(join(migrationDirectory, version), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const result = await client.query(
      "SELECT checksum FROM flowdesk_meta.schema_migrations WHERE version = $1",
      [version]
    );
    const existing = result.rows[0]?.checksum;

    if (existing === checksum) {
      console.log(`migration ${version}: already applied`);
      continue;
    }
    if (existing)
      throw new Error(
        `Migration checksum mismatch for ${version}; create a new migration instead.`
      );

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO flowdesk_meta.schema_migrations (version, checksum) VALUES ($1, $2)",
        [version, checksum]
      );
      await client.query("COMMIT");
      console.log(`migration ${version}: applied`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(834532101)");
  await client.end();
}
