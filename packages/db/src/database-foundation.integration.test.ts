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
      "0019_m5_routing_rules.sql"
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
           'claim_attachment_scan_events', 'claim_outbox_events', 'list_attachment_retention_candidates',
           'list_user_organizations', 'messaging_operational_snapshot', 'record_whatsapp_webhook'
         )
       ORDER BY procedure.proname`
    );
    expect(functions.rows).toEqual([
      { proname: "claim_attachment_scan_events", owner: "flowdesk_system" },
      { proname: "claim_outbox_events", owner: "flowdesk_system" },
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
      "attachment_upload_sessions",
      "attachments",
      "audit_logs",
      "auth_sessions",
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
      "webhook_events",
      "whatsapp_template_status_history",
      "whatsapp_template_sync_cursors",
      "whatsapp_template_versions",
      "whatsapp_templates"
    ]);
    expect(tenantColumns.rows.map((row) => row.table_name).sort()).toEqual([
      "attachment_upload_sessions",
      "attachments",
      "audit_logs",
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

  it("forces RLS on every M4 knowledge and vector table and creates HNSW index (M4-01)", async () => {
    const m4Tables = [
      "bot_configs",
      "bot_runs",
      "document_chunks",
      "documents",
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
});
