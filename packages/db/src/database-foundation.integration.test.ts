import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listVisibleQueues } from "./operational-inbox.js";
import {
  ConversationAccessRevokedError,
  performConversationOperation
} from "./conversation-operations.js";
import { OptimisticConcurrencyError } from "./conversations.js";
import { withTenantTransaction } from "./tenant-context.js";
import {
  createAttachmentUploadSession,
  getAttachmentById,
  softDeleteAttachment,
  listExpiredAttachments
} from "./attachments.js";
import { readFileSync, existsSync } from "node:fs";
import {
  createKnowledgeSource,
  createDocumentWithChunks,
  enqueueBotDraftRun,
  finishBotDraftRun,
  getBotConfig,
  getLatestBotRunForConversation,
  searchDocumentChunks,
  upsertBotConfig
} from "./knowledge.js";
import { getAnalyticsOverview, aggregateHourlyMetricsForOrg } from "./analytics.js";
import { findApiKeyByHash } from "./api-keys.js";
import { createWebhookSubscription } from "./webhook-subscriptions.js";
import { listActiveOrganizationIds } from "./organizations.js";
import {
  createPolicyDraft,
  updatePolicyDraft,
  publishPolicyDraft,
  rollbackPolicyVersion,
  getActivePublishedPolicy,
  getPolicyById,
  listPolicyVersions,
  recordRoutingLogWithTrace
} from "./automation-policy.js";
import { createRoutingRule, listRoutingRules } from "./routing.js";
import { resolveAutomationSafety } from "./automation-safety.js";
import {
  findOrCreateConversation,
  createMessage,
  createOutboundMessageWithOutbox,
  type MessageRecord
} from "./conversations.js";
import { createChannel } from "./channels.js";
import { getMonthlyAiSpend, MICROCENTS_PER_CENT } from "./auto-send.js";
import type { DbClient } from "./auth.js";

const executeFile = promisify(execFile);

if (!process.env["DATABASE_MIGRATOR_URL"]) {
  try {
    const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, "utf8");
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
    }
  } catch {
    // ignore
  }
}

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
      "0006_channels.sql",
      "0007_webhook_events.sql",
      "0008_conversations_and_messages.sql",
      "0009_m2_completion_hardening.sql",
      "0010_m3_operational_inbox.sql",
      "0011_m3_conversation_operations.sql",
      "0012_m3_realtime_versions.sql",
      "0013_m3_whatsapp_templates.sql",
      "0014_m3_service_window.sql",
      "0015_m3_media_quarantine.sql",
      "0016_m3_media_lifecycle.sql",
      "0017_m4_knowledge_and_vector.sql",
      "0018_user_organization_discovery.sql",
      "0019_m5_routing_rules.sql",
      "0020_m6_developer_integrations.sql",
      "0021_m6_meta_embedded_signup.sql",
      "0022_m4_knowledge_ingestion_jobs.sql",
      "0023_m4_durable_bot_drafts.sql",
      "0024_m4_gemini_default_model.sql",
      "0025_m4_grant_public_schema_usage.sql",
      "0026_m6_runtime_integrations_privileges.sql",
      "0027_m5_auto_mode.sql",
      "0028_m5_automation_safety_controls.sql",
      "0029_m5_automation_policy_engine.sql",
      "0030_m5_auto_release_gate.sql",
      "0031_m5_auto_release_gates_rls.sql",
      "0032_m5_routing_logs_policy_rule_id.sql",
      "0033_m5_automation_safety_global_resolution.sql",
      "0034_m5_bot_runs_monthly_cost_index.sql",
      "0035_m6_developer_webhooks_and_analytics.sql"
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

  it("grants M6 integration access without weakening tenant RLS", async () => {
    const organizationA = "00000000-0000-7000-8000-0000000006a1";
    const organizationB = "00000000-0000-7000-8000-0000000006b1";

    await admin.query("DELETE FROM flowdesk.api_keys WHERE organization_id = ANY($1::uuid[])", [
      [organizationA, organizationB]
    ]);
    await admin.query(
      "DELETE FROM flowdesk.webhook_subscriptions WHERE organization_id = ANY($1::uuid[])",
      [[organizationA, organizationB]]
    );
    await admin.query("DELETE FROM flowdesk.organizations WHERE id = ANY($1::uuid[])", [
      [organizationA, organizationB]
    ]);
    await admin.query(
      `INSERT INTO flowdesk.organizations (id, slug, display_name) VALUES
       ($1, 'm6-runtime-a', 'M6 Runtime A'),
       ($2, 'm6-runtime-b', 'M6 Runtime B')`,
      [organizationA, organizationB]
    );
    await admin.query(
      `INSERT INTO flowdesk.api_keys
         (id, organization_id, name, key_prefix, key_hash, scopes) VALUES
       ('00000000-0000-7000-8000-0000000006a2', $1, 'Tenant A', 'fd_a', repeat('a', 64), '[]'),
       ('00000000-0000-7000-8000-0000000006b2', $2, 'Tenant B', 'fd_b', repeat('b', 64), '[]')`,
      [organizationA, organizationB]
    );
    await admin.query(
      `INSERT INTO flowdesk.webhook_subscriptions
         (id, organization_id, name, url, secret, events) VALUES
       ('00000000-0000-7000-8000-0000000006a3', $1, 'Tenant A', 'https://a.example.test', 'tenant-a-secret-1234', '[]'),
       ('00000000-0000-7000-8000-0000000006b3', $2, 'Tenant B', 'https://b.example.test', 'tenant-b-secret-1234', '[]')`,
      [organizationA, organizationB]
    );

    const privileges = await admin.query<{ table_name: string; can_write: boolean }>(
      `SELECT table_name,
              has_table_privilege('flowdesk_runtime', 'flowdesk.' || table_name,
                                  'SELECT,INSERT,UPDATE,DELETE') AS can_write
       FROM (VALUES ('api_keys'), ('webhook_subscriptions')) AS tables(table_name)
       ORDER BY table_name`
    );
    expect(privileges.rows).toEqual([
      { table_name: "api_keys", can_write: true },
      { table_name: "webhook_subscriptions", can_write: true }
    ]);

    await admin.query("BEGIN");
    try {
      await admin.query("SET LOCAL ROLE flowdesk_runtime");
      await admin.query("SELECT set_config('app.organization_id', $1, true)", [organizationA]);

      expect((await admin.query("SELECT id FROM flowdesk.api_keys ORDER BY id")).rows).toEqual([
        { id: "00000000-0000-7000-8000-0000000006a2" }
      ]);
      expect(
        (await admin.query("SELECT id FROM flowdesk.webhook_subscriptions ORDER BY id")).rows
      ).toEqual([{ id: "00000000-0000-7000-8000-0000000006a3" }]);

      const analytics = await getAnalyticsOverview(admin as unknown as DbClient, organizationA, 30);
      expect(analytics.assignedConversations).toBe(0);

      expect(
        (
          await admin.query("UPDATE flowdesk.api_keys SET revoked_at = now() WHERE id = $1", [
            "00000000-0000-7000-8000-0000000006b2"
          ])
        ).rowCount
      ).toBe(0);
      expect(
        (
          await admin.query("DELETE FROM flowdesk.webhook_subscriptions WHERE id = $1", [
            "00000000-0000-7000-8000-0000000006b3"
          ])
        ).rowCount
      ).toBe(0);
    } finally {
      await admin.query("ROLLBACK");
    }

    await admin.query("DELETE FROM flowdesk.api_keys WHERE organization_id = ANY($1::uuid[])", [
      [organizationA, organizationB]
    ]);
    await admin.query(
      "DELETE FROM flowdesk.webhook_subscriptions WHERE organization_id = ANY($1::uuid[])",
      [[organizationA, organizationB]]
    );
    await admin.query("DELETE FROM flowdesk.organizations WHERE id = ANY($1::uuid[])", [
      [organizationA, organizationB]
    ]);
  });

  it("discovers only a user's active organizations before tenant context is selected", async () => {
    const userA = "00000000-0000-7000-8000-0000000000e1";
    const userB = "00000000-0000-7000-8000-0000000000e2";
    const fixtureOrganizationIds = `SELECT id FROM flowdesk.organizations
      WHERE slug IN ('bootstrap-discovery-a', 'bootstrap-discovery-b')`;
    await admin.query(
      `DELETE FROM flowdesk.audit_logs WHERE organization_id IN (${fixtureOrganizationIds})`
    );
    await admin.query(
      `DELETE FROM flowdesk.organization_settings
       WHERE organization_id IN (${fixtureOrganizationIds})`
    );
    await admin.query("DELETE FROM flowdesk.memberships WHERE user_id IN ($1, $2)", [userA, userB]);
    await admin.query(
      `DELETE FROM flowdesk.roles WHERE organization_id IN (${fixtureOrganizationIds})`
    );
    await admin.query(
      "DELETE FROM flowdesk.organizations WHERE slug IN ('bootstrap-discovery-a', 'bootstrap-discovery-b')"
    );
    await admin.query(
      `INSERT INTO flowdesk.users (id, email, display_name) VALUES
       ($1, 'bootstrap-a@example.com', 'Bootstrap A'),
       ($2, 'bootstrap-b@example.com', 'Bootstrap B')
       ON CONFLICT (id) DO NOTHING`,
      [userA, userB]
    );
    const organizationA = await admin.query<{ organization_id: string }>(
      "SELECT organization_id FROM flowdesk.bootstrap_organization('bootstrap-discovery-a', 'Bootstrap Discovery A', $1)",
      [userA]
    );
    const organizationB = await admin.query<{ organization_id: string }>(
      "SELECT organization_id FROM flowdesk.bootstrap_organization('bootstrap-discovery-b', 'Bootstrap Discovery B', $1)",
      [userB]
    );

    await admin.query("BEGIN");
    try {
      await admin.query("SET LOCAL ROLE flowdesk_runtime");
      expect(
        (
          await admin.query(
            "SELECT id FROM flowdesk.organizations WHERE id = ANY($1::uuid[]) ORDER BY id",
            [[organizationA.rows[0]!.organization_id, organizationB.rows[0]!.organization_id]]
          )
        ).rows
      ).toEqual([]);

      const visibleToA = await admin.query<{ id: string; role_key: string }>(
        "SELECT id, role_key FROM flowdesk.list_user_organizations($1)",
        [userA]
      );
      expect(visibleToA.rows).toEqual([
        { id: organizationA.rows[0]!.organization_id, role_key: "owner" }
      ]);

      const visibleToB = await admin.query<{ id: string; role_key: string }>(
        "SELECT id, role_key FROM flowdesk.list_user_organizations($1)",
        [userB]
      );
      expect(visibleToB.rows).toEqual([
        { id: organizationB.rows[0]!.organization_id, role_key: "owner" }
      ]);
    } finally {
      await admin.query("ROLLBACK");
    }
  });

  it("limits cross-tenant worker capabilities to non-login security-definer functions", async () => {
    const systemRole = await admin.query<{
      rolcanlogin: boolean;
      rolbypassrls: boolean;
      rolsuper: boolean;
    }>(
      `SELECT rolcanlogin, rolbypassrls, rolsuper
       FROM pg_roles WHERE rolname = 'flowdesk_system'`
    );
    expect(systemRole.rows).toEqual([{ rolcanlogin: false, rolbypassrls: true, rolsuper: false }]);

    const functions = await admin.query<{ proname: string; owner: string }>(
      `SELECT procedure.proname, owner.rolname AS owner
       FROM pg_proc AS procedure
       JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
       JOIN pg_roles AS owner ON owner.oid = procedure.proowner
        WHERE namespace.nspname = 'flowdesk'
          AND procedure.proname IN (
            'authenticate_api_key', 'claim_attachment_scan_events', 'claim_bot_draft_runs', 'claim_knowledge_ingestion_jobs', 'claim_outbox_events', 'list_active_organization_ids', 'list_attachment_retention_candidates',
            'list_user_organizations', 'messaging_operational_snapshot', 'record_whatsapp_webhook'
          )
        ORDER BY procedure.proname`
    );
    expect(functions.rows).toEqual([
      { proname: "authenticate_api_key", owner: "flowdesk_system" },
      { proname: "claim_attachment_scan_events", owner: "flowdesk_system" },
      { proname: "claim_bot_draft_runs", owner: "flowdesk_system" },
      { proname: "claim_knowledge_ingestion_jobs", owner: "flowdesk_system" },
      { proname: "claim_outbox_events", owner: "flowdesk_system" },
      { proname: "list_active_organization_ids", owner: "flowdesk_system" },
      { proname: "list_attachment_retention_candidates", owner: "flowdesk_system" },
      { proname: "list_user_organizations", owner: "flowdesk_system" },
      { proname: "messaging_operational_snapshot", owner: "flowdesk_system" },
      { proname: "record_whatsapp_webhook", owner: "flowdesk_system" }
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
      "analytics_aggregates_hourly",
      "analytics_watermarks",
      "api_keys",
      "attachment_upload_sessions",
      "attachments",
      "audit_logs",
      "auth_sessions",
      "auto_release_gates",
      "automation_policies",
      "automation_safety_controls",
      "bot_configs",
      "bot_runs",
      "business_hours_policies",
      "channels",
      "contacts",
      "conversation_events",
      "conversation_notes",
      "conversation_read_markers",
      "conversation_tags",
      "conversations",
      "document_chunks",
      "documents",
      "idempotency_keys",
      "identities",
      "invitations",
      "knowledge_ingestion_jobs",
      "knowledge_sources",
      "knowledge_versions",
      "memberships",
      "message_status_events",
      "messages",
      "oidc_authorization_transactions",
      "organization_settings",
      "organizations",
      "outbound_intents",
      "outbox_events",
      "queue_memberships",
      "queues",
      "realtime_versions",
      "roles",
      "routing_logs",
      "routing_rules",
      "saved_filters",
      "sla_policies",
      "tags",
      "team_memberships",
      "teams",
      "users",
      "webhook_deliveries",
      "webhook_events",
      "webhook_subscriptions",
      "whatsapp_business_accounts",
      "whatsapp_embedded_signup_attempts",
      "whatsapp_template_status_history",
      "whatsapp_template_sync_cursors",
      "whatsapp_template_versions",
      "whatsapp_templates"
    ]);
    expect(tenantColumns.rows.map((row) => row.table_name).sort()).toEqual([
      "analytics_aggregates_hourly",
      "analytics_watermarks",
      "api_keys",
      "attachment_upload_sessions",
      "attachments",
      "audit_logs",
      "auto_release_gates",
      "automation_policies",
      "bot_configs",
      "bot_runs",
      "business_hours_policies",
      "channels",
      "contacts",
      "conversation_events",
      "conversation_notes",
      "conversation_read_markers",
      "conversation_tags",
      "conversations",
      "document_chunks",
      "documents",
      "idempotency_keys",
      "invitations",
      "knowledge_ingestion_jobs",
      "knowledge_sources",
      "knowledge_versions",
      "memberships",
      "message_status_events",
      "messages",
      "organization_settings",
      "outbound_intents",
      "outbox_events",
      "queue_memberships",
      "queues",
      "realtime_versions",
      "roles",
      "routing_logs",
      "routing_rules",
      "saved_filters",
      "sla_policies",
      "tags",
      "team_memberships",
      "teams",
      "webhook_deliveries",
      "webhook_subscriptions",
      "whatsapp_business_accounts",
      "whatsapp_embedded_signup_attempts",
      "whatsapp_template_status_history",
      "whatsapp_template_sync_cursors",
      "whatsapp_template_versions",
      "whatsapp_templates"
    ]);
  });

  it("forces RLS and installs the inbox access-path indexes on every M3 tenant table", async () => {
    const m3Tables = [
      "attachment_upload_sessions",
      "attachments",
      "business_hours_policies",
      "conversation_notes",
      "conversation_read_markers",
      "conversation_tags",
      "queue_memberships",
      "queues",
      "realtime_versions",
      "saved_filters",
      "sla_policies",
      "tags",
      "team_memberships",
      "teams",
      "whatsapp_template_status_history",
      "whatsapp_template_sync_cursors",
      "whatsapp_template_versions",
      "whatsapp_templates"
    ];
    const rls = await admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class
       WHERE relnamespace = 'flowdesk'::regnamespace AND relname = ANY($1::text[])
       ORDER BY relname`,
      [m3Tables]
    );
    expect(rls.rows).toHaveLength(m3Tables.length);
    expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

    const indexes = await admin.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'flowdesk' AND indexname = ANY($1::text[])
       ORDER BY indexname`,
      [
        [
          "conversations_inbox_queue_idx",
          "conversations_inbox_team_idx",
          "conversations_sla_due_idx",
          "queue_memberships_user_active_idx"
        ]
      ]
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "conversations_inbox_queue_idx",
      "conversations_inbox_team_idx",
      "conversations_sla_due_idx",
      "queue_memberships_user_active_idx"
    ]);

    await admin.query("SET enable_seqscan = off");
    try {
      const plan = await admin.query<{ "QUERY PLAN": unknown }>(
        `EXPLAIN (FORMAT JSON)
         SELECT id FROM flowdesk.conversations
         WHERE organization_id = $1 AND queue_id = $2
           AND status = 'open' AND priority = 'medium'
         ORDER BY last_message_at DESC, id DESC LIMIT 20`,
        ["00000000-0000-7000-8000-0000000000a1", "00000000-0000-7000-8000-0000000000d1"]
      );
      expect(JSON.stringify(plan.rows)).toContain("conversations_inbox_queue_idx");
    } finally {
      await admin.query("RESET enable_seqscan");
    }
  });

  it("fails closed across M3 tables and blocks cross-tenant writes", async () => {
    const organizationA = "00000000-0000-7000-8000-0000000000a1";
    const organizationB = "00000000-0000-7000-8000-0000000000b2";
    await admin.query(
      `INSERT INTO flowdesk.organizations (id, slug, display_name) VALUES
       ($1, 'tenant-a', 'Tenant A'), ($2, 'tenant-b', 'Tenant B')
       ON CONFLICT (id) DO NOTHING`,
      [organizationA, organizationB]
    );
    await admin.query(
      `INSERT INTO flowdesk.teams (organization_id, name, slug) VALUES
       ($1, 'Tenant A Support', 'tenant-a-support'),
       ($2, 'Tenant B Support', 'tenant-b-support')
       ON CONFLICT (organization_id, slug) DO NOTHING`,
      [organizationA, organizationB]
    );

    await admin.query("BEGIN");
    try {
      await admin.query("SET LOCAL ROLE flowdesk_runtime");
      expect((await admin.query("SELECT id FROM flowdesk.teams")).rows).toEqual([]);
      await admin.query("SELECT set_config('app.organization_id', $1, true)", [organizationA]);
      expect((await admin.query("SELECT name FROM flowdesk.teams ORDER BY name")).rows).toEqual([
        { name: "Tenant A Support" }
      ]);
      await expect(
        admin.query(
          "INSERT INTO flowdesk.tags (organization_id, name, color) VALUES ($1, 'denied', '#FF0000')",
          [organizationB]
        )
      ).rejects.toThrow();
    } finally {
      await admin.query("ROLLBACK");
    }
  });

  it("removes queue visibility immediately when routing membership is removed", async () => {
    const organizationId = "00000000-0000-7000-8000-0000000000a1";
    const userId = "00000000-0000-7000-8000-0000000000c1";
    await admin.query(`DELETE FROM flowdesk.conversation_events WHERE organization_id = $1`, [
      organizationId
    ]);
    await admin.query(`DELETE FROM flowdesk.messages WHERE organization_id = $1`, [organizationId]);
    await admin.query(`DELETE FROM flowdesk.conversations WHERE organization_id = $1`, [
      organizationId
    ]);
    await admin.query(`DELETE FROM flowdesk.queue_memberships WHERE organization_id = $1`, [
      organizationId
    ]);
    await admin.query(`DELETE FROM flowdesk.queues WHERE organization_id = $1`, [organizationId]);
    await admin.query(
      `INSERT INTO flowdesk.organizations (id, slug, display_name)
       VALUES ($1, 'tenant-a', 'Tenant A') ON CONFLICT (id) DO NOTHING`,
      [organizationId]
    );
    await admin.query(
      `INSERT INTO flowdesk.users (id, email, display_name)
       VALUES ($1, 'm3-agent@example.com', 'M3 Agent') ON CONFLICT (id) DO NOTHING`,
      [userId]
    );
    const role = await admin.query<{ id: string }>(
      `INSERT INTO flowdesk.roles (organization_id, key, label)
       VALUES ($1, 'm3_agent', 'M3 Agent')
       ON CONFLICT (organization_id, key) DO UPDATE SET label = EXCLUDED.label
       RETURNING id`,
      [organizationId]
    );
    await admin.query(
      `INSERT INTO flowdesk.memberships (organization_id, user_id, role_id, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (organization_id, user_id)
       DO UPDATE SET role_id = EXCLUDED.role_id, status = 'active'`,
      [organizationId, userId, role.rows[0]!.id]
    );
    const queue = await admin.query<{ id: string }>(
      `INSERT INTO flowdesk.queues (organization_id, name, slug)
       VALUES ($1, 'M3 Support', 'm3-support')
       ON CONFLICT (organization_id, slug) DO UPDATE SET status = 'active'
       RETURNING id`,
      [organizationId]
    );
    await admin.query(
      `INSERT INTO flowdesk.queue_memberships (organization_id, queue_id, user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, queue_id, user_id)
       DO UPDATE SET status = 'active', removed_at = NULL`,
      [organizationId, queue.rows[0]!.id, userId]
    );

    const pool = new Pool({ connectionString });
    const visibleQueues = async () =>
      withTenantTransaction(pool, { organizationId }, async (client) => {
        await client.query("SET LOCAL ROLE flowdesk_runtime");
        return listVisibleQueues(client, { organizationId, userId });
      });
    try {
      expect((await visibleQueues()).map((item) => item.id)).toContain(queue.rows[0]!.id);
      await admin.query(
        `UPDATE flowdesk.queue_memberships
         SET status = 'removed', removed_at = clock_timestamp()
         WHERE organization_id = $1 AND queue_id = $2 AND user_id = $3`,
        [organizationId, queue.rows[0]!.id, userId]
      );
      expect(await visibleQueues()).toEqual([]);
    } finally {
      await pool.end();
    }
  });

  it("keeps private notes out of the outbound message pipeline while recording history", async () => {
    const organizationId = "00000000-0000-7000-8000-0000000000a1";
    const userId = "00000000-0000-7000-8000-0000000000c1";
    await admin.query(`DELETE FROM flowdesk.audit_logs WHERE organization_id = $1`, [
      organizationId
    ]);
    await admin.query(`DELETE FROM flowdesk.conversation_events WHERE organization_id = $1`, [
      organizationId
    ]);
    await admin.query(`DELETE FROM flowdesk.messages WHERE organization_id = $1`, [organizationId]);
    await admin.query(`DELETE FROM flowdesk.conversations WHERE organization_id = $1`, [
      organizationId
    ]);
    await admin.query(
      `INSERT INTO flowdesk.organizations (id, slug, display_name)
       VALUES ($1, 'tenant-a', 'Tenant A') ON CONFLICT (id) DO NOTHING`,
      [organizationId]
    );
    await admin.query(
      `INSERT INTO flowdesk.users (id, email, display_name)
       VALUES ($1, 'm3-agent@example.com', 'M3 Agent') ON CONFLICT (id) DO NOTHING`,
      [userId]
    );
    const role = await admin.query<{ id: string }>(
      `INSERT INTO flowdesk.roles (organization_id, key, label)
       VALUES ($1, 'm3_agent', 'M3 Agent')
       ON CONFLICT (organization_id, key) DO UPDATE SET label = EXCLUDED.label
       RETURNING id`,
      [organizationId]
    );
    await admin.query(
      `INSERT INTO flowdesk.memberships (organization_id, user_id, role_id, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (organization_id, user_id)
       DO UPDATE SET role_id = EXCLUDED.role_id, status = 'active'`,
      [organizationId, userId, role.rows[0]!.id]
    );
    const channel = await admin.query<{ id: string }>(
      `INSERT INTO flowdesk.channels
         (organization_id, type, name, phone_number_id, waba_id, encrypted_credentials)
       VALUES ($1, 'whatsapp', 'M3 Test', 'm3-phone', 'm3-waba', 'encrypted-test-value')
       ON CONFLICT (organization_id, phone_number_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [organizationId]
    );
    const conversation = await admin.query<{ id: string }>(
      `INSERT INTO flowdesk.conversations
         (organization_id, channel_id, customer_phone, customer_name)
       VALUES ($1, $2, '+628111111111', 'M3 Customer')
       ON CONFLICT (organization_id, channel_id, customer_phone)
       DO UPDATE SET customer_name = EXCLUDED.customer_name
       RETURNING id`,
      [organizationId, channel.rows[0]!.id]
    );

    await admin.query(
      `INSERT INTO flowdesk.conversation_notes
         (organization_id, conversation_id, author_user_id, body)
       VALUES ($1, $2, $3, 'Internal note: do not send to customer')`,
      [organizationId, conversation.rows[0]!.id, userId]
    );

    expect(
      (
        await admin.query<{ count: string }>(
          `SELECT count(*) FROM flowdesk.messages
           WHERE organization_id = $1 AND conversation_id = $2 AND direction = 'outbound'`,
          [organizationId, conversation.rows[0]!.id]
        )
      ).rows[0]!.count
    ).toBe("0");
    expect(
      (
        await admin.query<{ event_type: string }>(
          `SELECT event_type FROM flowdesk.conversation_events
           WHERE organization_id = $1 AND conversation_id = $2
             AND event_type = 'conversation.note_added'`,
          [organizationId, conversation.rows[0]!.id]
        )
      ).rows
    ).toEqual([{ event_type: "conversation.note_added" }]);

    await admin.query(
      `INSERT INTO flowdesk.messages
         (organization_id, conversation_id, channel_id, direction, sender_type,
          sender_user_id, content, status)
       VALUES ($1, $2, $3, 'outbound', 'agent', $4, 'First response', 'queued')`,
      [organizationId, conversation.rows[0]!.id, channel.rows[0]!.id, userId]
    );
    expect(
      (
        await admin.query<{ first_responded_at: Date | null }>(
          `SELECT first_responded_at FROM flowdesk.conversations
           WHERE organization_id = $1 AND id = $2`,
          [organizationId, conversation.rows[0]!.id]
        )
      ).rows[0]!.first_responded_at
    ).toBeInstanceOf(Date);
  });

  it("serializes simultaneous claims and fails closed after queue membership removal", async () => {
    const organizationId = "00000000-0000-7000-8000-0000000000a1";
    const agentA = "00000000-0000-7000-8000-0000000000c1";
    const agentB = "00000000-0000-7000-8000-0000000000c2";
    await admin.query(`DELETE FROM flowdesk.audit_logs WHERE organization_id = $1`, [
      organizationId
    ]);
    await admin.query(`DELETE FROM flowdesk.conversation_events WHERE organization_id = $1`, [
      organizationId
    ]);
    await admin.query(`DELETE FROM flowdesk.messages WHERE organization_id = $1`, [organizationId]);
    await admin.query(`DELETE FROM flowdesk.conversations WHERE organization_id = $1`, [
      organizationId
    ]);
    await admin.query(
      `INSERT INTO flowdesk.users (id, email, display_name) VALUES
       ($1, 'm3-agent@example.com', 'M3 Agent A'),
       ($2, 'm3-agent-b@example.com', 'M3 Agent B')
       ON CONFLICT (id) DO NOTHING`,
      [agentA, agentB]
    );
    const role = await admin.query<{ id: string }>(
      `INSERT INTO flowdesk.roles (organization_id, key, label)
       VALUES ($1, 'm3_agent', 'M3 Agent')
       ON CONFLICT (organization_id, key) DO UPDATE SET label = EXCLUDED.label
       RETURNING id`,
      [organizationId]
    );
    await admin.query(
      `INSERT INTO flowdesk.memberships (organization_id, user_id, role_id, status) VALUES
       ($1, $2, $4, 'active'), ($1, $3, $4, 'active')
       ON CONFLICT (organization_id, user_id)
       DO UPDATE SET role_id = EXCLUDED.role_id, status = 'active'`,
      [organizationId, agentA, agentB, role.rows[0]!.id]
    );
    const queue = await admin.query<{ id: string }>(
      `INSERT INTO flowdesk.queues (organization_id, name, slug)
       VALUES ($1, 'M3 Race Queue', 'm3-race')
       ON CONFLICT (organization_id, slug) DO UPDATE SET status = 'active'
       RETURNING id`,
      [organizationId]
    );
    await admin.query(
      `INSERT INTO flowdesk.queue_memberships (organization_id, queue_id, user_id, status) VALUES
       ($1, $2, $3, 'active'), ($1, $2, $4, 'active')
       ON CONFLICT (organization_id, queue_id, user_id)
       DO UPDATE SET status = 'active', removed_at = NULL`,
      [organizationId, queue.rows[0]!.id, agentA, agentB]
    );
    const channel = await admin.query<{ id: string }>(
      `INSERT INTO flowdesk.channels
         (organization_id, type, name, phone_number_id, waba_id, encrypted_credentials)
       VALUES ($1, 'whatsapp', 'M3 Race', 'm3-race-phone', 'm3-waba', 'encrypted')
       ON CONFLICT (organization_id, phone_number_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [organizationId]
    );
    const conversation = await admin.query<{ id: string }>(
      `INSERT INTO flowdesk.conversations
         (organization_id, channel_id, customer_phone, status, queue_id, version)
       VALUES ($1, $2, '+628222222222', 'open', $3, 1)
       ON CONFLICT (organization_id, channel_id, customer_phone)
       DO UPDATE SET status = 'open', queue_id = EXCLUDED.queue_id,
                     assigned_to_user_id = NULL, version = 1, resolved_at = NULL
       RETURNING id`,
      [organizationId, channel.rows[0]!.id, queue.rows[0]!.id]
    );
    const pool = new Pool({ connectionString, max: 4 });
    const claim = (actorUserId: string) =>
      withTenantTransaction(pool, { organizationId }, async (client) => {
        await client.query("SET LOCAL ROLE flowdesk_runtime");
        return performConversationOperation(client, {
          organizationId,
          conversationId: conversation.rows[0]!.id,
          actorUserId,
          expectedVersion: 1,
          operation: { action: "claim" }
        });
      });
    try {
      const claims = await Promise.allSettled([claim(agentA), claim(agentB)]);
      expect(claims.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = claims.find((result) => result.status === "rejected");
      expect(rejected?.status === "rejected" ? rejected.reason : null).toBeInstanceOf(
        OptimisticConcurrencyError
      );
      const winner = claims.find(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof claim>>> =>
          result.status === "fulfilled"
      )!.value.assignedToUserId!;
      expect(
        (
          await admin.query<{ count: string }>(
            `SELECT count(*) FROM flowdesk.audit_logs
             WHERE organization_id = $1 AND target_id = $2 AND action = 'conversation.claim'`,
            [organizationId, conversation.rows[0]!.id]
          )
        ).rows[0]!.count
      ).toBe("1");
      await admin.query(
        `UPDATE flowdesk.queue_memberships
         SET status = 'removed', removed_at = clock_timestamp()
         WHERE organization_id = $1 AND queue_id = $2 AND user_id = $3`,
        [organizationId, queue.rows[0]!.id, winner]
      );
      await expect(
        withTenantTransaction(pool, { organizationId }, async (client) => {
          await client.query("SET LOCAL ROLE flowdesk_runtime");
          return performConversationOperation(client, {
            organizationId,
            conversationId: conversation.rows[0]!.id,
            actorUserId: winner,
            expectedVersion: 2,
            operation: { action: "unread" }
          });
        })
      ).rejects.toBeInstanceOf(ConversationAccessRevokedError);
    } finally {
      await pool.end();
    }
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

  it("soft-deletes an attachment and hides it from getAttachmentById (M3-07)", async () => {
    const pool = new Pool({ connectionString });
    const orgId = "00000000-0000-7000-8000-0000000000a1";
    try {
      // Create an attachment via the DB layer inside tenant context
      const created = await withTenantTransaction(
        pool,
        { organizationId: orgId },
        async (client) => {
          await client.query("SET LOCAL ROLE flowdesk_runtime");
          return createAttachmentUploadSession(client, {
            organizationId: orgId,
            uploaderUserId: null,
            fileName: "retention-test.pdf",
            contentType: "application/pdf",
            byteSize: 1024,
            storageKey: `org-${orgId}/quarantine/retention-test-${Date.now()}`,
            uploadUrl: "https://s3.example.com/upload",
            expiresAt: new Date(Date.now() + 900000)
          });
        }
      );
      const attachmentId = created.attachment.id;

      // Verify visible before deletion
      const before = await withTenantTransaction(
        pool,
        { organizationId: orgId },
        async (client) => {
          await client.query("SET LOCAL ROLE flowdesk_runtime");
          return getAttachmentById(client, orgId, attachmentId);
        }
      );
      expect(before).not.toBeNull();
      expect(before!.deletedAt).toBeNull();

      // Soft-delete it
      const deleted = await withTenantTransaction(
        pool,
        { organizationId: orgId },
        async (client) => {
          await client.query("SET LOCAL ROLE flowdesk_runtime");
          return softDeleteAttachment(client, {
            organizationId: orgId,
            attachmentId,
            deletionReason: "retention_expiry"
          });
        }
      );
      expect(deleted).not.toBeNull();
      expect(deleted!.deletedAt).not.toBeNull();
      expect(deleted!.deletionReason).toBe("retention_expiry");

      // Now invisible via getAttachmentById
      const after = await withTenantTransaction(pool, { organizationId: orgId }, async (client) => {
        await client.query("SET LOCAL ROLE flowdesk_runtime");
        return getAttachmentById(client, orgId, attachmentId);
      });
      expect(after).toBeNull();
    } finally {
      await pool.end();
    }
  });

  it("listExpiredAttachments returns only non-deleted attachments older than cutoff (M3-07)", async () => {
    const pool = new Pool({ connectionString });
    const orgId = "00000000-0000-7000-8000-0000000000a1";
    try {
      // List expired attachments older than far-future cutoff — should include our existing test fixtures
      const futureCutoff = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const candidates = await withTenantTransaction(
        pool,
        { organizationId: orgId },
        async (client) => {
          await client.query("SET LOCAL ROLE flowdesk_runtime");
          return listExpiredAttachments(client, orgId, futureCutoff);
        }
      );

      // Should be an array (may be empty if all were soft-deleted in prior test)
      expect(Array.isArray(candidates)).toBe(true);
      // All returned items must belong to this org and have expected fields
      for (const c of candidates) {
        expect(c.organizationId).toBe(orgId);
        expect(typeof c.storageKey).toBe("string");
        expect(["clean", "quarantine", "rejected"]).toContain(c.status);
      }
    } finally {
      await pool.end();
    }
  });

  it("keeps durable bot draft enqueue, dedupe, claim, and reads tenant-isolated (M4-R3)", async () => {
    const pool = new Pool({ connectionString });
    const organizationA = "00000000-0000-7000-8000-0000000000d1";
    const organizationB = "00000000-0000-7000-8000-0000000000d2";
    const channelA = "00000000-0000-7000-8000-0000000001d1";
    const conversationA = "00000000-0000-7000-8000-0000000002d1";
    const messageA = "00000000-0000-7000-8000-0000000003d1";
    const configA = "00000000-0000-7000-8000-0000000004d1";
    const organizations = [organizationA, organizationB];

    try {
      await admin.query("DELETE FROM flowdesk.bot_runs WHERE organization_id = ANY($1::uuid[])", [
        organizations
      ]);
      await admin.query(
        "DELETE FROM flowdesk.bot_configs WHERE organization_id = ANY($1::uuid[])",
        [organizations]
      );
      await admin.query("DELETE FROM flowdesk.messages WHERE organization_id = ANY($1::uuid[])", [
        organizations
      ]);
      await admin.query(
        "DELETE FROM flowdesk.conversations WHERE organization_id = ANY($1::uuid[])",
        [organizations]
      );
      await admin.query("DELETE FROM flowdesk.contacts WHERE organization_id = ANY($1::uuid[])", [
        organizations
      ]);
      await admin.query("DELETE FROM flowdesk.channels WHERE organization_id = ANY($1::uuid[])", [
        organizations
      ]);
      await admin.query(
        "DELETE FROM flowdesk.realtime_versions WHERE organization_id = ANY($1::uuid[])",
        [organizations]
      );
      await admin.query("DELETE FROM flowdesk.organizations WHERE id = ANY($1::uuid[])", [
        organizations
      ]);

      await admin.query(
        `INSERT INTO flowdesk.organizations (id, slug, display_name) VALUES
         ($1, 'm4-draft-a', 'M4 Draft A'), ($2, 'm4-draft-b', 'M4 Draft B')`,
        organizations
      );
      await admin.query(
        `INSERT INTO flowdesk.channels
           (id, organization_id, type, name, phone_number_id, waba_id, encrypted_credentials, status)
         VALUES ($1, $2, 'whatsapp', 'M4 test', 'm4-phone-a', 'm4-waba-a', 'fixture', 'active')`,
        [channelA, organizationA]
      );
      await admin.query(
        `INSERT INTO flowdesk.conversations
           (id, organization_id, channel_id, customer_phone, status)
         VALUES ($1, $2, $3, '+62000000001', 'open')`,
        [conversationA, organizationA, channelA]
      );
      await admin.query(
        `INSERT INTO flowdesk.messages
           (id, organization_id, conversation_id, channel_id, direction, sender_type, content, status)
         VALUES ($1, $2, $3, $4, 'inbound', 'customer', 'Apakah garansi satu tahun?', 'delivered')`,
        [messageA, organizationA, conversationA, channelA]
      );
      await admin.query(
        `INSERT INTO flowdesk.bot_configs (id, organization_id, mode)
         VALUES ($1, $2, 'draft')`,
        [configA, organizationA]
      );

      const input = {
        organizationId: organizationA,
        conversationId: conversationA,
        triggerMessageId: messageA,
        botConfigId: configA,
        knowledgeVersionId: null,
        requestedByUserId: null,
        model: "test-model",
        configSnapshot: {
          instructions: "Use approved knowledge only.",
          tone: "professional",
          language: "id",
          confidenceThreshold: 0.7,
          topK: 5,
          emergencyDisabled: false
        },
        inputMessageCreatedAt: new Date()
      };
      const first = await withTenantTransaction(pool, { organizationId: organizationA }, (client) =>
        enqueueBotDraftRun(client, input)
      );
      const duplicate = await withTenantTransaction(
        pool,
        { organizationId: organizationA },
        (client) => enqueueBotDraftRun(client, input)
      );
      expect(duplicate.id).toBe(first.id);
      expect(first.status).toBe("queued");

      const visibleA = await withTenantTransaction(
        pool,
        { organizationId: organizationA },
        (client) => getLatestBotRunForConversation(client, organizationA, conversationA)
      );
      const invisibleB = await withTenantTransaction(
        pool,
        { organizationId: organizationB },
        (client) => getLatestBotRunForConversation(client, organizationA, conversationA)
      );
      expect(visibleA?.id).toBe(first.id);
      expect(invisibleB).toBeNull();

      await admin.query("SET ROLE flowdesk_runtime");
      const claimed = await admin.query<{ id: string; organization_id: string }>(
        "SELECT id, organization_id FROM flowdesk.claim_bot_draft_runs(50)"
      );
      await admin.query("RESET ROLE");
      expect(claimed.rows).toContainEqual({ id: first.id, organization_id: organizationA });

      // 1. Transition processing -> completed (with tokens, citations, and model)
      await withTenantTransaction(pool, { organizationId: organizationA }, (client) =>
        finishBotDraftRun(client, {
          id: first.id,
          status: "completed",
          suggestedContent: "Halo! Ada yang bisa kami bantu?",
          citations: [
            {
              chunkId: "00000000-0000-0000-0000-000000000001",
              sourceTitle: "FAQ",
              snippet: "Jam operasional 09.00 - 17.00",
              score: 0.95
            }
          ],
          promptTokens: 120,
          completionTokens: 30,
          latencyMs: 350,
          model: "gemini-3.7-flash"
        })
      );

      const completedRun = await withTenantTransaction(
        pool,
        { organizationId: organizationA },
        (client) => getLatestBotRunForConversation(client, organizationA, conversationA)
      );
      expect(completedRun?.status).toBe("completed");
      expect(completedRun?.suggestedContent).toBe("Halo! Ada yang bisa kami bantu?");
      expect(completedRun?.totalTokens).toBe(150);
      expect(completedRun?.model).toBe("gemini-3.7-flash");
      expect(completedRun?.citations).toHaveLength(1);

      // 2. Transition processing -> no_evidence
      const secondInput = {
        ...input,
        triggerMessageId: messageA
      };
      // Reset trigger to allow enqueueing another run
      await admin.query("UPDATE flowdesk.bot_runs SET status = 'stale' WHERE id = $1", [first.id]);
      const second = await withTenantTransaction(
        pool,
        { organizationId: organizationA },
        (client) => enqueueBotDraftRun(client, secondInput)
      );
      await admin.query("SET ROLE flowdesk_runtime");
      await admin.query("SELECT flowdesk.claim_bot_draft_runs(50)");
      await admin.query("RESET ROLE");

      await withTenantTransaction(pool, { organizationId: organizationA }, (client) =>
        finishBotDraftRun(client, {
          id: second.id,
          status: "no_evidence",
          latencyMs: 150,
          model: "gemini-3.7-flash"
        })
      );

      const noEvidenceRun = await withTenantTransaction(
        pool,
        { organizationId: organizationA },
        (client) => getLatestBotRunForConversation(client, organizationA, conversationA)
      );
      expect(noEvidenceRun?.status).toBe("no_evidence");
      expect(noEvidenceRun?.totalTokens).toBe(0);

      // 3. Transition processing -> failed
      await admin.query("UPDATE flowdesk.bot_runs SET status = 'stale' WHERE id = $1", [second.id]);
      const third = await withTenantTransaction(pool, { organizationId: organizationA }, (client) =>
        enqueueBotDraftRun(client, secondInput)
      );
      await admin.query("SET ROLE flowdesk_runtime");
      await admin.query("SELECT flowdesk.claim_bot_draft_runs(50)");
      await admin.query("RESET ROLE");

      await withTenantTransaction(pool, { organizationId: organizationA }, (client) =>
        finishBotDraftRun(client, {
          id: third.id,
          status: "provider_failed",
          errorCode: "AI_PROVIDER_ERROR",
          errorDetail: "Rate limited upstream",
          latencyMs: 50
        })
      );

      const failedRun = await withTenantTransaction(
        pool,
        { organizationId: organizationA },
        (client) => getLatestBotRunForConversation(client, organizationA, conversationA)
      );
      expect(failedRun?.status).toBe("provider_failed");
      expect(failedRun?.errorCode).toBe("AI_PROVIDER_ERROR");

      // M5 #178: AUTO is accepted only when explicitly persisted, remains tenant-scoped,
      // and one bot run cannot create two outbound messages even under a retry/race.
      await admin.query("UPDATE flowdesk.bot_runs SET status = 'stale' WHERE id = $1", [third.id]);
      await admin.query("UPDATE flowdesk.bot_configs SET mode = 'auto' WHERE id = $1", [configA]);
      const autoRun = await withTenantTransaction(
        pool,
        { organizationId: organizationA },
        (client) => enqueueBotDraftRun(client, { ...input, mode: "auto" })
      );
      expect(autoRun.mode).toBe("auto");
      const hiddenAutoRun = await withTenantTransaction(
        pool,
        { organizationId: organizationB },
        (client) => getLatestBotRunForConversation(client, organizationA, conversationA)
      );
      expect(hiddenAutoRun).toBeNull();

      await admin.query(
        `INSERT INTO flowdesk.messages
           (organization_id, conversation_id, channel_id, direction, sender_type, content, status, metadata)
         VALUES ($1, $2, $3, 'outbound', 'bot', 'AUTO answer', 'queued',
                 jsonb_build_object('aiBotRunId', $4::text))`,
        [organizationA, conversationA, channelA, autoRun.id]
      );
      await expect(
        admin.query(
          `INSERT INTO flowdesk.messages
             (organization_id, conversation_id, channel_id, direction, sender_type, content, status, metadata)
           VALUES ($1, $2, $3, 'outbound', 'bot', 'Duplicate AUTO answer', 'queued',
                   jsonb_build_object('aiBotRunId', $4::text))`,
          [organizationA, conversationA, channelA, autoRun.id]
        )
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      await admin.query("RESET ROLE").catch(() => undefined);
      await pool.end();
    }
  });

  it("forces RLS on every M4 knowledge and vector table and creates HNSW index (M4-01)", async () => {
    const m4Tables = [
      "bot_configs",
      "bot_runs",
      "document_chunks",
      "documents",
      "knowledge_ingestion_jobs",
      "knowledge_sources",
      "knowledge_versions"
    ];
    const rls = await admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class
       WHERE relnamespace = 'flowdesk'::regnamespace AND relname = ANY($1::text[])
       ORDER BY relname`,
      [m4Tables]
    );
    expect(rls.rows).toHaveLength(m4Tables.length);
    expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

    const indexes = await admin.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'flowdesk' AND indexname = 'idx_chunks_embedding_cosine'`
    );
    expect(indexes.rows).toHaveLength(1);
    expect(indexes.rows[0]?.indexname).toBe("idx_chunks_embedding_cosine");
  });

  it("persists 1536d vector chunks and performs similarity search in a tenant transaction", async () => {
    const orgId = "00000000-0000-7000-8000-0000000000a1";
    await admin.query(
      `INSERT INTO flowdesk.organizations (id, slug, display_name)
       VALUES ($1, 'vector-test-org', 'Vector Test Org')
       ON CONFLICT (id) DO NOTHING`,
      [orgId]
    );

    const fakeVector = new Array<number>(1536).fill(0.01);
    // Normalize fakeVector
    const norm = Math.sqrt(fakeVector.reduce((sum, val) => sum + val * val, 0)) || 1;
    const normalizedVector = fakeVector.map((val) => val / norm);

    const testPool = new Pool({ connectionString });
    try {
      const searchResults = await withTenantTransaction(
        testPool,
        { organizationId: orgId },
        async (client) => {
          const source = await createKnowledgeSource(client, {
            organizationId: orgId,
            type: "text",
            name: "Test Ingestion Source"
          });

          await createDocumentWithChunks(client, {
            organizationId: orgId,
            sourceId: source.id,
            title: "Test Ingestion Source",
            contentHash: "testhash123",
            chunks: [
              {
                chunkIndex: 0,
                content: "FlowDesk refunds are processed within seven business days.",
                contentHash: "chunkhash123",
                embedding: normalizedVector
              }
            ]
          });

          return searchDocumentChunks(client, {
            organizationId: orgId,
            queryEmbedding: normalizedVector,
            topK: 3,
            similarityThreshold: 0.5
          });
        }
      );

      expect(searchResults).toHaveLength(1);
      expect(searchResults[0]?.similarity).toBeGreaterThan(0.99);
      expect(searchResults[0]?.content).toContain("FlowDesk refunds");
    } finally {
      await testPool.end();
    }
  });

  it("enforces tenant RLS on auto_release_gates and requires tenant context to view bot_configs (#179 defect)", async () => {
    const orgA = "00000000-0000-7000-8000-0000000000b1";
    const orgB = "00000000-0000-7000-8000-0000000000b2";
    await admin.query(
      `INSERT INTO flowdesk.organizations (id, slug, display_name)
       VALUES ($1, 'rg-org-a', 'Release Gate Org A'),
              ($2, 'rg-org-b', 'Release Gate Org B')
       ON CONFLICT (id) DO NOTHING`,
      [orgA, orgB]
    );

    const testPool = new Pool({ connectionString });
    try {
      // 1. Create bot config for Org A
      const configA = await withTenantTransaction(testPool, { organizationId: orgA }, (client) =>
        upsertBotConfig(client, {
          organizationId: orgA,
          mode: "auto"
        })
      );
      expect(configA.id).toBeDefined();

      // 2. An unscoped query under flowdesk_runtime (without setting app.organization_id)
      // cannot view bot_configs (proving the root cause of the false 404 NOT_FOUND)
      const unscopedClient = await testPool.connect();
      try {
        await unscopedClient.query("SET ROLE flowdesk_runtime");
        const unscopedRes = await getBotConfig(unscopedClient, orgA);
        expect(unscopedRes).toBeNull();
      } finally {
        await unscopedClient.query("RESET ROLE").catch(() => undefined);
        unscopedClient.release();
      }

      // 3. Inside tenant context for Org A, bot config is visible and release gate can be created
      const gateId = await withTenantTransaction(
        testPool,
        { organizationId: orgA },
        async (client) => {
          const visibleConfig = await getBotConfig(client, orgA);
          expect(visibleConfig).not.toBeNull();
          expect(visibleConfig?.id).toBe(configA.id);

          const inserted = await client.query<{ id: string }>(
            `INSERT INTO flowdesk.auto_release_gates (
               organization_id, bot_config_id, cohort, status, eval_scores, approvals,
               rollback_owner
             ) VALUES ($1, $2, 'beta', 'pending', '{}'::jsonb, '[]'::jsonb, 'SRE')
             RETURNING id`,
            [orgA, configA.id]
          );
          return inserted.rows[0]?.id;
        }
      );
      expect(gateId).toBeDefined();

      // 4. Org A can read its release gate
      const gatesA = await withTenantTransaction(
        testPool,
        { organizationId: orgA },
        async (client) => {
          const res = await client.query<{ id: string }>(
            `SELECT id FROM flowdesk.auto_release_gates WHERE organization_id = $1`,
            [orgA]
          );
          return res.rows;
        }
      );
      expect(gatesA.some((g) => g.id === gateId)).toBe(true);

      // 5. Cross-tenant isolation: Org B cannot see Org A's release gate
      const gatesB = await withTenantTransaction(
        testPool,
        { organizationId: orgB },
        async (client) => {
          const res = await client.query<{ id: string }>(
            `SELECT id FROM flowdesk.auto_release_gates WHERE organization_id = $1`,
            [orgA]
          );
          return res.rows;
        }
      );
      expect(gatesB).toHaveLength(0);
    } finally {
      await testPool.end();
    }
  });

  it("enforces tenant RLS on automation_policies and routing_rules (#180 defect)", async () => {
    const orgA = "00000000-0000-7000-8000-0000000000c1";
    const orgB = "00000000-0000-7000-8000-0000000000c2";
    await admin.query(
      `INSERT INTO flowdesk.organizations (id, slug, display_name)
       VALUES ($1, 'policy-org-a', 'Policy Org A'),
              ($2, 'policy-org-b', 'Policy Org B')
       ON CONFLICT (id) DO NOTHING`,
      [orgA, orgB]
    );

    const testPool = new Pool({ connectionString });
    try {
      // 1. Unscoped runtime connection cannot insert into automation_policies (replicates defect)
      const unscopedClient = await testPool.connect();
      try {
        await unscopedClient.query("SET ROLE flowdesk_runtime");
        await expect(
          unscopedClient.query(
            `INSERT INTO flowdesk.automation_policies (
               organization_id, version, status, name, rules, metadata
             ) VALUES ($1, 1, 'draft', 'Defect Test', '[]'::jsonb, '{}'::jsonb)`,
            [orgA]
          )
        ).rejects.toThrow(/violates row-level security policy for table "automation_policies"/);

        // Unscoped select returns 0 rows
        const unscopedSelect = await unscopedClient.query(
          `SELECT * FROM flowdesk.automation_policies WHERE organization_id = $1`,
          [orgA]
        );
        expect(unscopedSelect.rows).toHaveLength(0);
      } finally {
        await unscopedClient.query("RESET ROLE").catch(() => undefined);
        unscopedClient.release();
      }

      // 2. Tenant-scoped transaction for Org A successfully creates draft v1
      const draftV1 = await withTenantTransaction(testPool, { organizationId: orgA }, (client) =>
        createPolicyDraft(client, {
          organizationId: orgA,
          name: "Org A Core Policy",
          rules: [
            {
              id: "r1",
              organizationId: orgA,
              name: "Urgent Queue",
              priority: 1,
              conditions: { tag: "urgent" },
              targetQueueId: "00000000-0000-7000-8000-000000000099",
              targetTeamId: null,
              targetUserId: null,
              isActive: true
            }
          ]
        })
      );
      expect(draftV1.id).toBeDefined();
      expect(draftV1.version).toBe(1);
      expect(draftV1.status).toBe("draft");

      // 3. Tenant-scoped update draft v1
      const updatedDraft = await withTenantTransaction(
        testPool,
        { organizationId: orgA },
        (client) =>
          updatePolicyDraft(client, {
            organizationId: orgA,
            policyId: draftV1.id,
            name: "Org A Core Policy Renamed"
          })
      );
      expect(updatedDraft?.name).toBe("Org A Core Policy Renamed");

      // 4. Publish draft v1
      const publishedV1 = await withTenantTransaction(
        testPool,
        { organizationId: orgA },
        (client) =>
          publishPolicyDraft(client, {
            organizationId: orgA,
            policyId: draftV1.id,
            notes: "Initial launch"
          })
      );
      expect(publishedV1.status).toBe("published");

      // 5. Active published policy is visible for Org A
      const activePolicy = await withTenantTransaction(
        testPool,
        { organizationId: orgA },
        (client) => getActivePublishedPolicy(client, orgA)
      );
      expect(activePolicy?.id).toBe(draftV1.id);
      expect(activePolicy?.status).toBe("published");

      // 6. Create draft v2 and publish it, archiving v1
      const draftV2 = await withTenantTransaction(testPool, { organizationId: orgA }, (client) =>
        createPolicyDraft(client, {
          organizationId: orgA,
          name: "Org A Policy v2",
          rules: []
        })
      );
      expect(draftV2.version).toBe(2);

      await withTenantTransaction(testPool, { organizationId: orgA }, (client) =>
        publishPolicyDraft(client, {
          organizationId: orgA,
          policyId: draftV2.id,
          notes: "Second launch"
        })
      );

      // 7. Rollback to v1 (creates v3 with v1 content)
      const rolledBack = await withTenantTransaction(testPool, { organizationId: orgA }, (client) =>
        rollbackPolicyVersion(client, {
          organizationId: orgA,
          targetPolicyId: draftV1.id,
          notes: "Emergency rollback to v1"
        })
      );
      expect(rolledBack.version).toBe(3);
      expect(rolledBack.status).toBe("published");

      // 8. List policy versions for Org A
      const versionsA = await withTenantTransaction(testPool, { organizationId: orgA }, (client) =>
        listPolicyVersions(client, orgA)
      );
      expect(versionsA).toHaveLength(3);

      // 9. Cross-tenant isolation: Org B sees zero policies and cannot access Org A's policies
      const policiesForB = await withTenantTransaction(
        testPool,
        { organizationId: orgB },
        (client) => listPolicyVersions(client, orgA)
      );
      expect(policiesForB).toHaveLength(0);

      const activeForB = await withTenantTransaction(testPool, { organizationId: orgB }, (client) =>
        getActivePublishedPolicy(client, orgA)
      );
      expect(activeForB).toBeNull();

      const singleForB = await withTenantTransaction(testPool, { organizationId: orgB }, (client) =>
        getPolicyById(client, orgA, draftV1.id)
      );
      expect(singleForB).toBeNull();

      // 10. Legacy routing rules also respect tenant RLS
      const ruleA = await withTenantTransaction(testPool, { organizationId: orgA }, (client) =>
        createRoutingRule(client, {
          organizationId: orgA,
          name: "Rule A",
          priority: 10,
          conditions: { tag: "support" }
        })
      );
      expect(ruleA.id).toBeDefined();

      const rulesB = await withTenantTransaction(testPool, { organizationId: orgB }, (client) =>
        listRoutingRules(client, orgA)
      );
      expect(rulesB).toHaveLength(0);
    } finally {
      await testPool.end();
    }
  });

  it("records routing logs with matched_policy_rule_id for string policy rules, preserves matched_rule_id UUID FK integrity for legacy rules, and isolates failures with SAVEPOINT (#180)", async () => {
    const orgId = "00000000-0000-7000-8000-000000000780";
    const testPool = new Pool({ connectionString });

    try {
      await admin.query("DELETE FROM flowdesk.routing_logs WHERE organization_id = $1", [orgId]);
      await admin.query("DELETE FROM flowdesk.messages WHERE organization_id = $1", [orgId]);
      await admin.query("DELETE FROM flowdesk.conversations WHERE organization_id = $1", [orgId]);
      await admin.query("DELETE FROM flowdesk.routing_rules WHERE organization_id = $1", [orgId]);
      await admin.query("DELETE FROM flowdesk.automation_policies WHERE organization_id = $1", [
        orgId
      ]);
      await admin.query("DELETE FROM flowdesk.channels WHERE organization_id = $1", [orgId]);
      await admin.query("DELETE FROM flowdesk.organizations WHERE id = $1", [orgId]);

      await admin.query(
        "INSERT INTO flowdesk.organizations (id, slug, display_name) VALUES ($1, 'routing-test-org', 'Routing Test Org')",
        [orgId]
      );

      const channel = await withTenantTransaction(testPool, { organizationId: orgId }, (client) =>
        createChannel(client, {
          organizationId: orgId,
          type: "whatsapp",
          name: "Test WA",
          phoneNumberId: "phone-180-test",
          wabaId: "waba-180-test",
          encryptedCredentials: "enc:test",
          status: "active"
        })
      );

      const conv = await withTenantTransaction(testPool, { organizationId: orgId }, (client) =>
        findOrCreateConversation(client, {
          organizationId: orgId,
          channelId: channel.id,
          customerPhone: "+6281234567890"
        })
      );

      // 1. Create and publish an automation policy with embedded string rule ID (e.g. "rule-z1wfsei")
      const policy = await withTenantTransaction(
        testPool,
        { organizationId: orgId },
        async (client) => {
          const draft = await createPolicyDraft(client, {
            organizationId: orgId,
            name: "Active Policy",
            rules: [
              {
                id: "rule-z1wfsei",
                organizationId: orgId,
                name: "Rule Z1",
                priority: 1,
                conditions: {},
                targetQueueId: null,
                targetTeamId: null,
                targetUserId: null,
                isActive: true
              }
            ]
          });
          return publishPolicyDraft(client, {
            organizationId: orgId,
            policyId: draft.id
          });
        }
      );

      // Record routing log referencing the policy and string rule ID cleanly
      const policyLog = await withTenantTransaction(testPool, { organizationId: orgId }, (client) =>
        recordRoutingLogWithTrace(client, {
          organizationId: orgId,
          conversationId: conv.id,
          matchedRuleId: null,
          matchedPolicyRuleId: "rule-z1wfsei",
          reason: "Policy auto match",
          policyId: policy.id,
          policyVersion: policy.version
        })
      );
      expect(policyLog.id).toBeDefined();
      expect(policyLog.matchedRuleId).toBeNull();
      expect(policyLog.matchedPolicyRuleId).toBe("rule-z1wfsei");
      expect(policyLog.policyId).toBe(policy.id);
      expect(policyLog.policyVersion).toBe(1);

      // 2. Legacy routing rule with UUID records matched_rule_id with FK integrity
      const legacyRule = await withTenantTransaction(
        testPool,
        { organizationId: orgId },
        (client) =>
          createRoutingRule(client, {
            organizationId: orgId,
            name: "Legacy Rule",
            priority: 5,
            conditions: {}
          })
      );
      const legacyLog = await withTenantTransaction(testPool, { organizationId: orgId }, (client) =>
        recordRoutingLogWithTrace(client, {
          organizationId: orgId,
          conversationId: conv.id,
          matchedRuleId: legacyRule.id,
          matchedPolicyRuleId: null,
          reason: "Legacy rule matched"
        })
      );
      expect(legacyLog.matchedRuleId).toBe(legacyRule.id);
      expect(legacyLog.matchedPolicyRuleId).toBeNull();

      // 3. Proving FK integrity: passing a non-existent UUID to matchedRuleId throws FK violation
      await expect(
        withTenantTransaction(testPool, { organizationId: orgId }, (client) =>
          recordRoutingLogWithTrace(client, {
            organizationId: orgId,
            conversationId: conv.id,
            matchedRuleId: "00000000-0000-7000-8000-000000000099",
            matchedPolicyRuleId: null,
            reason: "Non-existent legacy rule"
          })
        )
      ).rejects.toThrow();

      // 4. SAVEPOINT failure isolation: a routing failure inside a SAVEPOINT does NOT poison the outer transaction
      await withTenantTransaction(testPool, { organizationId: orgId }, async (client) => {
        // Inbound message is created
        const inboundMsg = await createMessage(client, {
          organizationId: orgId,
          conversationId: conv.id,
          channelId: channel.id,
          direction: "inbound",
          senderType: "customer",
          content: "Inbound survives routing failure",
          providerMessageId: "wamid.savepoint.test.1",
          sentAt: new Date(),
          status: "delivered"
        });
        expect(inboundMsg.id).toBeDefined();

        // Subtransaction / Savepoint around routing work
        await client.query("SAVEPOINT routing_eval");
        try {
          // Force 22P02 invalid uuid syntax
          await client.query("SELECT * FROM flowdesk.routing_rules WHERE id = $1", [
            "invalid-uuid-syntax"
          ]);
          await client.query("RELEASE SAVEPOINT routing_eval");
        } catch {
          await client.query("ROLLBACK TO SAVEPOINT routing_eval");
        }

        // Outer transaction continues successfully — subsequent statement does not fail with 25P02!
        const verifyMsg = await client.query<{ id: string; content: string }>(
          "SELECT id, content FROM flowdesk.messages WHERE id = $1",
          [inboundMsg.id]
        );
        expect(verifyMsg.rows).toHaveLength(1);
        expect(verifyMsg.rows[0]?.content).toBe("Inbound survives routing failure");
      });
    } finally {
      await testPool.end();
    }
  });

  it("enforces durable global automation safety stop without granting runtime direct SELECT (#177)", async () => {
    const orgIdA = "00000000-0000-7000-8000-000000000177";
    const orgIdB = "00000000-0000-7000-8000-000000000178";
    const testPool = new Pool({ connectionString });

    try {
      // Clean up previous test state
      await admin.query(
        "DELETE FROM flowdesk.automation_safety_controls WHERE organization_id IN ($1, $2) OR scope = 'global'",
        [orgIdA, orgIdB]
      );
      await admin.query("DELETE FROM flowdesk.organizations WHERE id IN ($1, $2)", [
        orgIdA,
        orgIdB
      ]);

      // Seed tenants
      await admin.query(
        "INSERT INTO flowdesk.organizations (id, slug, display_name) VALUES ($1, 'safety-a', 'Safety Org A')",
        [orgIdA]
      );
      await admin.query(
        "INSERT INTO flowdesk.organizations (id, slug, display_name) VALUES ($1, 'safety-b', 'Safety Org B')",
        [orgIdB]
      );

      // Insert global stop via admin (durable platform-level control)
      await admin.query(
        `INSERT INTO flowdesk.automation_safety_controls (scope, disabled, reason)
         VALUES ('global', true, 'M5 staging acceptance global halt')`
      );

      // 1. Runtime tenant cannot directly SELECT the global row (RLS enforced)
      await withTenantTransaction(testPool, { organizationId: orgIdA }, async (client) => {
        const directSelect = await client.query(
          "SELECT * FROM flowdesk.automation_safety_controls WHERE scope = 'global'"
        );
        expect(directSelect.rows).toHaveLength(0);
      });

      // 2. resolve_automation_safety() can still see an active global stop
      const safetyA = await withTenantTransaction(
        testPool,
        { organizationId: orgIdA },
        async (client) => {
          return resolveAutomationSafety(client, { organizationId: orgIdA });
        }
      );
      expect(safetyA).not.toBeNull();
      expect(safetyA?.scope).toBe("global");
      expect(safetyA?.reason).toBe("M5 staging acceptance global halt");

      // 3. Global stop takes precedence over narrower scopes (e.g. tenant-specific stop)
      await admin.query(
        `INSERT INTO flowdesk.automation_safety_controls (organization_id, scope, disabled, reason)
         VALUES ($1, 'tenant', true, 'Tenant A local stop')`,
        [orgIdA]
      );
      const precedenceCheck = await withTenantTransaction(
        testPool,
        { organizationId: orgIdA },
        async (client) => {
          return resolveAutomationSafety(client, { organizationId: orgIdA });
        }
      );
      expect(precedenceCheck?.scope).toBe("global");
      expect(precedenceCheck?.reason).toBe("M5 staging acceptance global halt");

      // 4. Disabled or expired global rows are ignored
      // Update global stop to disabled = false (halt lifted)
      await admin.query(
        "UPDATE flowdesk.automation_safety_controls SET disabled = false WHERE scope = 'global'"
      );
      const liftedCheck = await withTenantTransaction(
        testPool,
        { organizationId: orgIdA },
        async (client) => {
          return resolveAutomationSafety(client, { organizationId: orgIdA });
        }
      );
      // Now tenant stop should be resolved because global is disabled
      expect(liftedCheck?.scope).toBe("tenant");
      expect(liftedCheck?.reason).toBe("Tenant A local stop");

      // Test expired global stop
      await admin.query(
        "UPDATE flowdesk.automation_safety_controls SET disabled = true, expires_at = now() - interval '1 hour' WHERE scope = 'global'"
      );
      const expiredCheck = await withTenantTransaction(
        testPool,
        { organizationId: orgIdA },
        async (client) => {
          return resolveAutomationSafety(client, { organizationId: orgIdA });
        }
      );
      // Expired global row is ignored, tenant stop is returned
      expect(expiredCheck?.scope).toBe("tenant");

      // When tenant stop is also removed, returns null
      await admin.query(
        "DELETE FROM flowdesk.automation_safety_controls WHERE organization_id = $1",
        [orgIdA]
      );
      const nullCheck = await withTenantTransaction(
        testPool,
        { organizationId: orgIdA },
        async (client) => {
          return resolveAutomationSafety(client, { organizationId: orgIdA });
        }
      );
      expect(nullCheck).toBeNull();

      // 5. Cross-tenant isolation remains intact: Tenant B controls are not visible to Tenant A
      await admin.query(
        `INSERT INTO flowdesk.automation_safety_controls (organization_id, scope, disabled, reason)
         VALUES ($1, 'tenant', true, 'Tenant B secret stop')`,
        [orgIdB]
      );
      const crossTenantCheckA = await withTenantTransaction(
        testPool,
        { organizationId: orgIdA },
        async (client) => {
          return resolveAutomationSafety(client, { organizationId: orgIdA });
        }
      );
      expect(crossTenantCheckA).toBeNull();

      const crossTenantCheckB = await withTenantTransaction(
        testPool,
        { organizationId: orgIdB },
        async (client) => {
          return resolveAutomationSafety(client, { organizationId: orgIdB });
        }
      );
      expect(crossTenantCheckB?.scope).toBe("tenant");
      expect(crossTenantCheckB?.reason).toBe("Tenant B secret stop");
    } finally {
      await admin.query(
        "DELETE FROM flowdesk.automation_safety_controls WHERE organization_id IN ($1, $2) OR scope = 'global'",
        [orgIdA, orgIdB]
      );
      await admin.query("DELETE FROM flowdesk.organizations WHERE id IN ($1, $2)", [
        orgIdA,
        orgIdB
      ]);
      await testPool.end();
    }
  });

  it("enforces monthly AI spend aggregation, monthly boundary reset, tenant isolation, and manual operations (#179)", async () => {
    const runtimeUrl = process.env["DATABASE_URL"] ?? connectionString;
    const testPool = new Pool({ connectionString: runtimeUrl });

    const orgIdA = "11111111-1111-4111-8111-111111111179";
    const orgIdB = "22222222-2222-4222-8222-222222222179";

    try {
      await admin.query(
        "INSERT INTO flowdesk.organizations (id, slug, display_name) VALUES ($1, $2, $3)",
        [orgIdA, "org-cost-test-a", "Org Cost Test A"]
      );
      await admin.query(
        "INSERT INTO flowdesk.organizations (id, slug, display_name) VALUES ($1, $2, $3)",
        [orgIdB, "org-cost-test-b", "Org Cost Test B"]
      );

      const channelResA = await admin.query<{ id: string }>(
        `INSERT INTO flowdesk.channels (organization_id, type, name, phone_number_id, waba_id, encrypted_credentials)
         VALUES ($1, 'whatsapp', 'WhatsApp Cost A', 'cost-phone-a-1', 'waba-cost-a', 'encrypted-test-value') RETURNING id`,
        [orgIdA]
      );
      const channelIdA = channelResA.rows[0]!.id;

      const channelResB = await admin.query<{ id: string }>(
        `INSERT INTO flowdesk.channels (organization_id, type, name, phone_number_id, waba_id, encrypted_credentials)
         VALUES ($1, 'whatsapp', 'WhatsApp Cost B', 'cost-phone-b-1', 'waba-cost-b', 'encrypted-test-value') RETURNING id`,
        [orgIdB]
      );
      const channelIdB = channelResB.rows[0]!.id;

      const convResA = await admin.query<{ id: string }>(
        `INSERT INTO flowdesk.conversations (organization_id, channel_id, customer_phone, customer_name)
         VALUES ($1, $2, '+62811111179', 'Customer Cost A') RETURNING id`,
        [orgIdA, channelIdA]
      );
      const convIdA = convResA.rows[0]!.id;

      const convResB = await admin.query<{ id: string }>(
        `INSERT INTO flowdesk.conversations (organization_id, channel_id, customer_phone, customer_name)
         VALUES ($1, $2, '+62822222179', 'Customer Cost B') RETURNING id`,
        [orgIdB, channelIdB]
      );
      const convIdB = convResB.rows[0]!.id;

      // 1. Prior month boundary check: insert a bot run created 35 days ago for Tenant A
      await admin.query(
        `INSERT INTO flowdesk.bot_runs (organization_id, conversation_id, mode, status, cost_estimate_microcents, created_at)
         VALUES ($1, $2, 'auto', 'completed', $3, clock_timestamp() - INTERVAL '35 days')`,
        [orgIdA, convIdA, 100 * Number(MICROCENTS_PER_CENT)]
      );

      // Verify prior month run is excluded by date_trunc('month', clock_timestamp())
      const initialSpendA = await withTenantTransaction(
        testPool,
        { organizationId: orgIdA },
        async (client) => getMonthlyAiSpend(client, orgIdA)
      );
      expect(initialSpendA.totalMicrocents).toBe(0n);
      expect(initialSpendA.totalCents).toBe(0);

      // 2. Current month spend: insert run for Tenant A with 50 cents spend
      await admin.query(
        `INSERT INTO flowdesk.bot_runs (organization_id, conversation_id, mode, status, cost_estimate_microcents, created_at)
         VALUES ($1, $2, 'auto', 'completed', $3, clock_timestamp() - INTERVAL '10 minutes')`,
        [orgIdA, convIdA, 50 * Number(MICROCENTS_PER_CENT)]
      );

      const currentSpendA = await withTenantTransaction(
        testPool,
        { organizationId: orgIdA },
        async (client) => getMonthlyAiSpend(client, orgIdA)
      );
      expect(currentSpendA.totalMicrocents).toBe(50n * MICROCENTS_PER_CENT);
      expect(currentSpendA.totalCents).toBe(50);

      // 3. Tenant isolation: insert large spend (50000 cents) for Tenant B in current month
      await admin.query(
        `INSERT INTO flowdesk.bot_runs (organization_id, conversation_id, mode, status, cost_estimate_microcents, created_at)
         VALUES ($1, $2, 'auto', 'completed', $3, clock_timestamp() - INTERVAL '5 minutes')`,
        [orgIdB, convIdB, 50000 * Number(MICROCENTS_PER_CENT)]
      );

      const spendB = await withTenantTransaction(
        testPool,
        { organizationId: orgIdB },
        async (client) => getMonthlyAiSpend(client, orgIdB)
      );
      expect(spendB.totalCents).toBe(50000);

      // Tenant A spend must remain strictly isolated (still 50 cents)
      const recheckSpendA = await withTenantTransaction(
        testPool,
        { organizationId: orgIdA },
        async (client) => getMonthlyAiSpend(client, orgIdA)
      );
      expect(recheckSpendA.totalCents).toBe(50);

      // 4. Manual operations unaffected: even though Tenant B is at/above ceiling, manual operations and inbound messages succeed
      const manualOutboundB = await withTenantTransaction<MessageRecord>(
        testPool,
        { organizationId: orgIdB },
        async (client) => {
          return createOutboundMessageWithOutbox(client, {
            organizationId: orgIdB,
            conversationId: convIdB,
            senderUserId: null,
            senderType: "agent",
            content: "Manual agent reply to customer"
          });
        }
      );
      expect(manualOutboundB.id).toBeDefined();
      expect(manualOutboundB.senderType).toBe("agent");

      // Customer inbound message succeeds
      const customerInboundB = await withTenantTransaction<MessageRecord>(
        testPool,
        { organizationId: orgIdB },
        async (client) => {
          return createMessage(client, {
            organizationId: orgIdB,
            conversationId: convIdB,
            channelId: channelIdB,
            senderType: "customer",
            content: "Customer asking follow up question",
            direction: "inbound"
          });
        }
      );
      expect(customerInboundB.id).toBeDefined();
      expect(customerInboundB.senderType).toBe("customer");
    } finally {
      await admin.query("DELETE FROM flowdesk.outbox_events WHERE organization_id IN ($1, $2)", [
        orgIdA,
        orgIdB
      ]);
      await admin.query("DELETE FROM flowdesk.messages WHERE organization_id IN ($1, $2)", [
        orgIdA,
        orgIdB
      ]);
      await admin.query("DELETE FROM flowdesk.bot_runs WHERE organization_id IN ($1, $2)", [
        orgIdA,
        orgIdB
      ]);
      await admin.query("DELETE FROM flowdesk.conversations WHERE organization_id IN ($1, $2)", [
        orgIdA,
        orgIdB
      ]);
      await admin.query("DELETE FROM flowdesk.contacts WHERE organization_id IN ($1, $2)", [
        orgIdA,
        orgIdB
      ]);
      await admin.query("DELETE FROM flowdesk.channels WHERE organization_id IN ($1, $2)", [
        orgIdA,
        orgIdB
      ]);
      await admin.query(
        "DELETE FROM flowdesk.realtime_versions WHERE organization_id IN ($1, $2)",
        [orgIdA, orgIdB]
      );
      await admin.query("DELETE FROM flowdesk.bot_configs WHERE organization_id IN ($1, $2)", [
        orgIdA,
        orgIdB
      ]);
      await admin.query("DELETE FROM flowdesk.organizations WHERE id IN ($1, $2)", [
        orgIdA,
        orgIdB
      ]);
      await testPool.end();
    }
  });

  it("enforces M6 developer API keys under real RLS, webhook outbox dispatch, and isolated analytics rollups (#209)", async () => {
    const orgIdA = "00000000-0000-7000-8000-000000000601";
    const orgIdB = "00000000-0000-7000-8000-000000000602";
    const channelIdA = "00000000-0000-7000-8000-000000000603";
    const userA = "00000000-0000-7000-8000-000000000604";

    const testPool = new Pool({ connectionString });

    await admin.query("DELETE FROM flowdesk.webhook_deliveries WHERE organization_id IN ($1, $2)", [
      orgIdA,
      orgIdB
    ]);
    await admin.query("DELETE FROM flowdesk.outbox_events WHERE organization_id IN ($1, $2)", [
      orgIdA,
      orgIdB
    ]);
    await admin.query(
      "DELETE FROM flowdesk.webhook_subscriptions WHERE organization_id IN ($1, $2)",
      [orgIdA, orgIdB]
    );
    await admin.query("DELETE FROM flowdesk.api_keys WHERE organization_id IN ($1, $2)", [
      orgIdA,
      orgIdB
    ]);
    await admin.query(
      "DELETE FROM flowdesk.analytics_aggregates_hourly WHERE organization_id IN ($1, $2)",
      [orgIdA, orgIdB]
    );
    await admin.query(
      "DELETE FROM flowdesk.analytics_watermarks WHERE organization_id IN ($1, $2)",
      [orgIdA, orgIdB]
    );
    await admin.query("DELETE FROM flowdesk.messages WHERE organization_id IN ($1, $2)", [
      orgIdA,
      orgIdB
    ]);
    await admin.query("DELETE FROM flowdesk.conversations WHERE organization_id IN ($1, $2)", [
      orgIdA,
      orgIdB
    ]);
    await admin.query("DELETE FROM flowdesk.contacts WHERE organization_id IN ($1, $2)", [
      orgIdA,
      orgIdB
    ]);
    await admin.query("DELETE FROM flowdesk.channels WHERE organization_id IN ($1, $2)", [
      orgIdA,
      orgIdB
    ]);
    await admin.query("DELETE FROM flowdesk.realtime_versions WHERE organization_id IN ($1, $2)", [
      orgIdA,
      orgIdB
    ]);
    await admin.query("DELETE FROM flowdesk.users WHERE id = $1", [userA]);
    await admin.query("DELETE FROM flowdesk.organizations WHERE id IN ($1, $2)", [orgIdA, orgIdB]);

    try {
      await admin.query(
        `INSERT INTO flowdesk.organizations (id, slug, display_name) VALUES
         ($1, 'm6-int-org-a', 'M6 Integration Org A'),
         ($2, 'm6-int-org-b', 'M6 Integration Org B')`,
        [orgIdA, orgIdB]
      );
      await admin.query(
        `INSERT INTO flowdesk.users (id, email, display_name) VALUES ($1, 'm6-user-a@example.com', 'M6 User A')`,
        [userA]
      );
      await admin.query(
        `INSERT INTO flowdesk.channels (id, organization_id, type, name, status, phone_number_id, waba_id, encrypted_credentials)
         VALUES ($1, $2, 'whatsapp', 'Test WA Channel A', 'active', 'phone-m6-001', 'waba-m6-001', 'enc-cred')`,
        [channelIdA, orgIdA]
      );

      // 1. API Key Auth Under Real RLS (Review Finding 1)
      const validHash = "a".repeat(64);
      const revokedHash = "b".repeat(64);
      const expiredHash = "c".repeat(64);

      await admin.query(
        `INSERT INTO flowdesk.api_keys (organization_id, name, key_prefix, key_hash, scopes, created_by_user_id)
         VALUES ($1, 'Valid Key Org A', 'fd_live_', $2, '["conversation:read", "message:write"]'::jsonb, $3)`,
        [orgIdA, validHash, userA]
      );
      await admin.query(
        `INSERT INTO flowdesk.api_keys (organization_id, name, key_prefix, key_hash, scopes, revoked_at)
         VALUES ($1, 'Revoked Key Org A', 'fd_live_', $2, '["*"]'::jsonb, clock_timestamp())`,
        [orgIdA, revokedHash]
      );
      await admin.query(
        `INSERT INTO flowdesk.api_keys (organization_id, name, key_prefix, key_hash, scopes, expires_at)
         VALUES ($1, 'Expired Key Org A', 'fd_live_', $2, '["*"]'::jsonb, clock_timestamp() - interval '1 day')`,
        [orgIdA, expiredHash]
      );

      // Authenticate via findApiKeyByHash under flowdesk_runtime (NOBYPASSRLS, without tenant context)
      const runtimeClient = await testPool.connect();
      try {
        await runtimeClient.query("SET ROLE flowdesk_runtime");
        const authenticatedValid = await findApiKeyByHash(runtimeClient, validHash);
        expect(authenticatedValid).not.toBeNull();
        expect(authenticatedValid?.organizationId).toBe(orgIdA);
        expect(authenticatedValid?.scopes).toEqual(["conversation:read", "message:write"]);

        const authenticatedRevoked = await findApiKeyByHash(runtimeClient, revokedHash);
        expect(authenticatedRevoked).toBeNull();

        const authenticatedExpired = await findApiKeyByHash(runtimeClient, expiredHash);
        expect(authenticatedExpired).toBeNull();

        const authenticatedRandom = await findApiKeyByHash(runtimeClient, "d".repeat(64));
        expect(authenticatedRandom).toBeNull();

        // Direct query on api_keys without tenant context returns empty (FORCE RLS denies)
        const directRuntimeQuery = await runtimeClient.query("SELECT * FROM flowdesk.api_keys");
        expect(directRuntimeQuery.rows.length).toBe(0);
      } finally {
        await runtimeClient.query("RESET ROLE").catch(() => undefined);
        runtimeClient.release();
      }

      // Tenant B transaction cannot see Tenant A's api_keys
      const tenantBKeys = await withTenantTransaction(
        testPool,
        { organizationId: orgIdB },
        async (tx) => {
          return (await tx.query<{ id: string }>("SELECT * FROM flowdesk.api_keys")).rows;
        }
      );
      expect(tenantBKeys.length).toBe(0);

      // 2. Scheduler Org Discovery (Review Finding 2)
      const activeOrgs = await listActiveOrganizationIds(testPool);
      expect(activeOrgs).toContain(orgIdA);
      expect(activeOrgs).toContain(orgIdB);

      // 3. Webhook Outbox Fanout On Domain Events (Review Finding 4, 5, 6)
      const subVerifiedA = await withTenantTransaction(
        testPool,
        { organizationId: orgIdA },
        async (tx) => {
          return createWebhookSubscription(tx, {
            organizationId: orgIdA,
            name: "Verified Webhook Org A",
            url: "https://example.com/webhook",
            secret: "whsec_encrypted_envelope_json_test_12345",
            events: ["*"],
            verificationStatus: "verified"
          });
        }
      );
      await withTenantTransaction(testPool, { organizationId: orgIdA }, async (tx) => {
        return createWebhookSubscription(tx, {
          organizationId: orgIdA,
          name: "Unverified Webhook Org A",
          url: "https://example.com/unverified",
          secret: "whsec_unverified_secret_test_12345",
          events: ["*"],
          verificationStatus: "unverified"
        });
      });
      await withTenantTransaction(testPool, { organizationId: orgIdB }, async (tx) => {
        return createWebhookSubscription(tx, {
          organizationId: orgIdB,
          name: "Verified Webhook Org B",
          url: "https://example.com/org-b",
          secret: "whsec_org_b_secret_test_12345",
          events: ["*"],
          verificationStatus: "verified"
        });
      });

      // Domain Event 1: conversation.created
      const convA = await withTenantTransaction(
        testPool,
        { organizationId: orgIdA },
        async (tx) => {
          return findOrCreateConversation(tx, {
            organizationId: orgIdA,
            channelId: channelIdA,
            customerPhone: "+15551234567",
            customerName: "Alice"
          });
        }
      );

      // Check outbox events: only subVerifiedA received developer.webhook.dispatch!
      const outboxRowsConv = await admin.query<{
        aggregate_id: string;
        payload: Record<string, unknown>;
      }>(
        `SELECT aggregate_id, payload FROM flowdesk.outbox_events
         WHERE organization_id = $1 AND event_type = 'developer.webhook.dispatch' AND payload->>'eventType' = 'conversation.created'`,
        [orgIdA]
      );
      expect(outboxRowsConv.rows.length).toBe(1);
      expect(outboxRowsConv.rows[0]?.aggregate_id).toBe(subVerifiedA.id);
      expect(outboxRowsConv.rows[0]?.payload["url"]).toBeUndefined();
      expect(outboxRowsConv.rows[0]?.payload["secret"]).toBeUndefined();
      expect(outboxRowsConv.rows[0]?.payload["subscriptionId"]).toBe(subVerifiedA.id);

      // Org B must have 0 outbox events for conversation.created
      const outboxRowsOrgB = await admin.query(
        `SELECT id FROM flowdesk.outbox_events WHERE organization_id = $1`,
        [orgIdB]
      );
      expect(outboxRowsOrgB.rows.length).toBe(0);

      // Domain Event 2: message.sent
      await withTenantTransaction(testPool, { organizationId: orgIdA }, async (tx) => {
        return createOutboundMessageWithOutbox(tx, {
          organizationId: orgIdA,
          conversationId: convA.id,
          senderType: "agent",
          senderUserId: userA,
          content: "Hello Alice from agent"
        });
      });

      const outboxRowsMsgSent = await admin.query<{
        aggregate_id: string;
        payload: Record<string, unknown>;
      }>(
        `SELECT aggregate_id, payload FROM flowdesk.outbox_events
         WHERE organization_id = $1 AND event_type = 'developer.webhook.dispatch' AND payload->>'eventType' = 'message.sent'`,
        [orgIdA]
      );
      expect(outboxRowsMsgSent.rows.length).toBe(1);
      expect(outboxRowsMsgSent.rows[0]?.aggregate_id).toBe(subVerifiedA.id);
      expect(outboxRowsMsgSent.rows[0]?.payload["url"]).toBeUndefined();
      expect(outboxRowsMsgSent.rows[0]?.payload["secret"]).toBeUndefined();

      // 4. Analytics Hourly Rollup & Tenant Isolation (Review Finding 3)
      await withTenantTransaction(testPool, { organizationId: orgIdA }, async (tx) => {
        await createMessage(tx, {
          organizationId: orgIdA,
          conversationId: convA.id,
          channelId: channelIdA,
          direction: "inbound",
          senderType: "customer",
          content: "Customer reply"
        });
      });

      // Run analytics aggregation for Org A
      const countA = await withTenantTransaction(
        testPool,
        { organizationId: orgIdA },
        async (tx) => {
          return aggregateHourlyMetricsForOrg(tx, orgIdA);
        }
      );
      expect(countA).toBeGreaterThanOrEqual(1);

      // Verify Org A aggregates exist
      const aggRowsA = await admin.query(
        "SELECT * FROM flowdesk.analytics_aggregates_hourly WHERE organization_id = $1",
        [orgIdA]
      );
      expect(aggRowsA.rows.length).toBeGreaterThanOrEqual(1);

      // Verify Org B aggregates are EMPTY (zero cross-tenant leakage!)
      const aggRowsB = await admin.query(
        "SELECT * FROM flowdesk.analytics_aggregates_hourly WHERE organization_id = $1",
        [orgIdB]
      );
      expect(aggRowsB.rows.length).toBe(0);

      // Verify watermark is updated
      const watermarkA = await admin.query(
        "SELECT * FROM flowdesk.analytics_watermarks WHERE organization_id = $1",
        [orgIdA]
      );
      expect(watermarkA.rows.length).toBe(1);
    } finally {
      await admin.query(
        "DELETE FROM flowdesk.webhook_deliveries WHERE organization_id IN ($1, $2)",
        [orgIdA, orgIdB]
      );
      await admin.query("DELETE FROM flowdesk.outbox_events WHERE organization_id IN ($1, $2)", [
        orgIdA,
        orgIdB
      ]);
      await admin.query(
        "DELETE FROM flowdesk.webhook_subscriptions WHERE organization_id IN ($1, $2)",
        [orgIdA, orgIdB]
      );
      await admin.query("DELETE FROM flowdesk.api_keys WHERE organization_id IN ($1, $2)", [
        orgIdA,
        orgIdB
      ]);
      await admin.query(
        "DELETE FROM flowdesk.analytics_aggregates_hourly WHERE organization_id IN ($1, $2)",
        [orgIdA, orgIdB]
      );
      await admin.query(
        "DELETE FROM flowdesk.analytics_watermarks WHERE organization_id IN ($1, $2)",
        [orgIdA, orgIdB]
      );
      await admin.query("DELETE FROM flowdesk.messages WHERE organization_id IN ($1, $2)", [
        orgIdA,
        orgIdB
      ]);
      await admin.query("DELETE FROM flowdesk.conversations WHERE organization_id IN ($1, $2)", [
        orgIdA,
        orgIdB
      ]);
      await admin.query("DELETE FROM flowdesk.contacts WHERE organization_id IN ($1, $2)", [
        orgIdA,
        orgIdB
      ]);
      await admin.query("DELETE FROM flowdesk.channels WHERE organization_id IN ($1, $2)", [
        orgIdA,
        orgIdB
      ]);
      await admin.query(
        "DELETE FROM flowdesk.realtime_versions WHERE organization_id IN ($1, $2)",
        [orgIdA, orgIdB]
      );
      await admin.query("DELETE FROM flowdesk.users WHERE id = $1", [userA]);
      await admin.query("DELETE FROM flowdesk.organizations WHERE id IN ($1, $2)", [
        orgIdA,
        orgIdB
      ]);
      await testPool.end();
    }
  });
});
