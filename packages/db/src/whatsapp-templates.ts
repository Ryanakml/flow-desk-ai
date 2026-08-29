import type {
  WhatsAppTemplateCategory,
  WhatsAppTemplateComponent,
  WhatsAppTemplateStatus
} from "@flowdesk/contracts";
import type { DbClient } from "./index.js";

export interface SyncTemplateVersionParams {
  organizationId: string;
  channelId: string;
  providerTemplateId: string;
  name: string;
  category: WhatsAppTemplateCategory;
  language: string;
  status: WhatsAppTemplateStatus;
  rejectedReason?: string | null | undefined;
  components: WhatsAppTemplateComponent[];
  variableCount: number;
  payloadHash: string;
}

export interface WhatsAppTemplateRecord {
  id: string;
  organizationId: string;
  channelId: string;
  name: string;
  category: WhatsAppTemplateCategory;
  createdAt: Date;
  updatedAt: Date;
}

export interface WhatsAppTemplateVersionRecord {
  id: string;
  templateId: string;
  organizationId: string;
  providerTemplateId: string;
  language: string;
  status: WhatsAppTemplateStatus;
  rejectedReason: string | null;
  components: WhatsAppTemplateComponent[];
  variableCount: number;
  payloadHash: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncTemplateResult {
  template: WhatsAppTemplateRecord;
  version: WhatsAppTemplateVersionRecord;
  statusChanged: boolean;
  payloadChanged: boolean;
}

/**
 * Idempotently synchronizes a template item from a provider into the database.
 * If the template or version already exists:
 * - Records status transitions in flowdesk.whatsapp_template_status_history.
 * - Increments version number when components/payload hash change.
 * - Updates provider template ID and rejected reason.
 */
export async function idempotentSyncTemplate(
  client: DbClient,
  params: SyncTemplateVersionParams
): Promise<SyncTemplateResult> {
  const {
    organizationId,
    channelId,
    providerTemplateId,
    name,
    category,
    language,
    status,
    rejectedReason,
    components,
    variableCount,
    payloadHash
  } = params;

  // 1. Upsert template identity
  const templateResult = await client.query<{
    id: string;
    organization_id: string;
    channel_id: string;
    name: string;
    category: WhatsAppTemplateCategory;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO flowdesk.whatsapp_templates
       (organization_id, channel_id, name, category, updated_at)
     VALUES ($1, $2, $3, $4, clock_timestamp())
     ON CONFLICT (channel_id, name)
     DO UPDATE SET
       category = EXCLUDED.category,
       updated_at = clock_timestamp()
     RETURNING id, organization_id, channel_id, name, category, created_at, updated_at`,
    [organizationId, channelId, name, category]
  );

  const templateRow = templateResult.rows[0]!;
  const templateId = templateRow.id;

  // 2. Query existing template version
  const existingVersionResult = await client.query<{
    id: string;
    status: WhatsAppTemplateStatus;
    payload_hash: string;
    version: number;
    rejected_reason: string | null;
  }>(
    `SELECT id, status, payload_hash, version, rejected_reason
     FROM flowdesk.whatsapp_template_versions
     WHERE template_id = $1 AND language = $2
     FOR UPDATE`,
    [templateId, language]
  );

  let versionRecord: WhatsAppTemplateVersionRecord;
  let statusChanged = false;
  let payloadChanged = false;

  if (existingVersionResult.rows.length > 0) {
    const existing = existingVersionResult.rows[0]!;
    statusChanged = existing.status !== status;
    payloadChanged = existing.payload_hash !== payloadHash;

    const nextVersion = payloadChanged ? existing.version + 1 : existing.version;

    // Record status transition if changed
    if (statusChanged) {
      await client.query(
        `INSERT INTO flowdesk.whatsapp_template_status_history
           (template_version_id, organization_id, from_status, to_status, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [existing.id, organizationId, existing.status, status, rejectedReason ?? null]
      );
    }

    const updateResult = await client.query<{
      id: string;
      template_id: string;
      organization_id: string;
      provider_template_id: string;
      language: string;
      status: WhatsAppTemplateStatus;
      rejected_reason: string | null;
      components: WhatsAppTemplateComponent[];
      variable_count: number;
      payload_hash: string;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE flowdesk.whatsapp_template_versions
       SET
         provider_template_id = $1,
         status = $2,
         rejected_reason = $3,
         components = $4,
         variable_count = $5,
         payload_hash = $6,
         version = $7,
         updated_at = clock_timestamp()
       WHERE id = $8
       RETURNING *`,
      [
        providerTemplateId,
        status,
        rejectedReason ?? null,
        JSON.stringify(components),
        variableCount,
        payloadHash,
        nextVersion,
        existing.id
      ]
    );

    const row = updateResult.rows[0]!;
    versionRecord = {
      id: row.id,
      templateId: row.template_id,
      organizationId: row.organization_id,
      providerTemplateId: row.provider_template_id,
      language: row.language,
      status: row.status,
      rejectedReason: row.rejected_reason,
      components: row.components,
      variableCount: row.variable_count,
      payloadHash: row.payload_hash,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  } else {
    // New version insertion
    statusChanged = true;
    payloadChanged = true;

    const insertResult = await client.query<{
      id: string;
      template_id: string;
      organization_id: string;
      provider_template_id: string;
      language: string;
      status: WhatsAppTemplateStatus;
      rejected_reason: string | null;
      components: WhatsAppTemplateComponent[];
      variable_count: number;
      payload_hash: string;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO flowdesk.whatsapp_template_versions
         (template_id, organization_id, provider_template_id, language, status,
          rejected_reason, components, variable_count, payload_hash, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)
       RETURNING *`,
      [
        templateId,
        organizationId,
        providerTemplateId,
        language,
        status,
        rejectedReason ?? null,
        JSON.stringify(components),
        variableCount,
        payloadHash
      ]
    );

    const row = insertResult.rows[0]!;
    versionRecord = {
      id: row.id,
      templateId: row.template_id,
      organizationId: row.organization_id,
      providerTemplateId: row.provider_template_id,
      language: row.language,
      status: row.status,
      rejectedReason: row.rejected_reason,
      components: row.components,
      variableCount: row.variable_count,
      payloadHash: row.payload_hash,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };

    // Initial status log
    await client.query(
      `INSERT INTO flowdesk.whatsapp_template_status_history
         (template_version_id, organization_id, from_status, to_status, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [versionRecord.id, organizationId, null, status, rejectedReason ?? null]
    );
  }

  return {
    template: {
      id: templateRow.id,
      organizationId: templateRow.organization_id,
      channelId: templateRow.channel_id,
      name: templateRow.name,
      category: templateRow.category,
      createdAt: templateRow.created_at,
      updatedAt: templateRow.updated_at
    },
    version: versionRecord,
    statusChanged,
    payloadChanged
  };
}

/**
 * Retrieves a template by its name and language for a specific channel.
 */
export async function getTemplateByNameAndLanguage(
  client: DbClient,
  params: {
    channelId: string;
    name: string;
    language: string;
  }
): Promise<{
  template: WhatsAppTemplateRecord;
  version: WhatsAppTemplateVersionRecord;
} | null> {
  const result = await client.query<{
    t_id: string;
    t_org_id: string;
    t_channel_id: string;
    t_name: string;
    t_category: WhatsAppTemplateCategory;
    t_created_at: Date;
    t_updated_at: Date;
    v_id: string;
    v_provider_template_id: string;
    v_language: string;
    v_status: WhatsAppTemplateStatus;
    v_rejected_reason: string | null;
    v_components: WhatsAppTemplateComponent[];
    v_variable_count: number;
    v_payload_hash: string;
    v_version: number;
    v_created_at: Date;
    v_updated_at: Date;
  }>(
    `SELECT
       t.id AS t_id, t.organization_id AS t_org_id, t.channel_id AS t_channel_id,
       t.name AS t_name, t.category AS t_category, t.created_at AS t_created_at,
       t.updated_at AS t_updated_at,
       v.id AS v_id, v.provider_template_id AS v_provider_template_id,
       v.language AS v_language, v.status AS v_status,
       v.rejected_reason AS v_rejected_reason, v.components AS v_components,
       v.variable_count AS v_variable_count, v.payload_hash AS v_payload_hash,
       v.version AS v_version, v.created_at AS v_created_at,
       v.updated_at AS v_updated_at
     FROM flowdesk.whatsapp_templates t
     JOIN flowdesk.whatsapp_template_versions v ON v.template_id = t.id
     WHERE t.channel_id = $1 AND t.name = $2 AND v.language = $3`,
    [params.channelId, params.name, params.language]
  );

  if (result.rows.length === 0) return null;
  const row = result.rows[0]!;

  return {
    template: {
      id: row.t_id,
      organizationId: row.t_org_id,
      channelId: row.t_channel_id,
      name: row.t_name,
      category: row.t_category,
      createdAt: row.t_created_at,
      updatedAt: row.t_updated_at
    },
    version: {
      id: row.v_id,
      templateId: row.t_id,
      organizationId: row.t_org_id,
      providerTemplateId: row.v_provider_template_id,
      language: row.v_language,
      status: row.v_status,
      rejectedReason: row.v_rejected_reason,
      components: row.v_components,
      variableCount: row.v_variable_count,
      payloadHash: row.v_payload_hash,
      version: row.v_version,
      createdAt: row.v_created_at,
      updatedAt: row.v_updated_at
    }
  };
}

/**
 * Retrieves the stored pagination cursor for channel template synchronization.
 */
export async function getTemplateSyncCursor(
  client: DbClient,
  params: { channelId: string }
): Promise<string | null> {
  const result = await client.query<{ cursor: string | null }>(
    `SELECT cursor FROM flowdesk.whatsapp_template_sync_cursors WHERE channel_id = $1`,
    [params.channelId]
  );
  return result.rows[0]?.cursor ?? null;
}

/**
 * Updates the stored pagination cursor for channel template synchronization.
 */
export async function setTemplateSyncCursor(
  client: DbClient,
  params: {
    organizationId: string;
    channelId: string;
    cursor: string | null;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO flowdesk.whatsapp_template_sync_cursors
       (organization_id, channel_id, cursor, last_synced_at)
     VALUES ($1, $2, $3, clock_timestamp())
     ON CONFLICT (channel_id)
     DO UPDATE SET cursor = EXCLUDED.cursor, last_synced_at = clock_timestamp()`,
    [params.organizationId, params.channelId, params.cursor]
  );
}

/**
 * Retrieves status transition history for a template version.
 */
export async function getTemplateStatusHistory(
  client: DbClient,
  templateVersionId: string
): Promise<
  Array<{
    id: string;
    fromStatus: WhatsAppTemplateStatus | null;
    toStatus: WhatsAppTemplateStatus;
    reason: string | null;
    createdAt: Date;
  }>
> {
  const result = await client.query<{
    id: string;
    from_status: WhatsAppTemplateStatus | null;
    to_status: WhatsAppTemplateStatus;
    reason: string | null;
    created_at: Date;
  }>(
    `SELECT id, from_status, to_status, reason, created_at
     FROM flowdesk.whatsapp_template_status_history
     WHERE template_version_id = $1
     ORDER BY created_at ASC`,
    [templateVersionId]
  );

  return result.rows.map((r) => ({
    id: r.id,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    reason: r.reason,
    createdAt: r.created_at
  }));
}
