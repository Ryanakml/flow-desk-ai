import { describe, expect, it } from "vitest";
import type { WhatsAppTemplateComponent } from "@flowdesk/contracts";
import type { DbClient } from "./index.js";
import {
  idempotentSyncTemplate,
  getTemplateByNameAndLanguage,
  getTemplateSyncCursor,
  setTemplateSyncCursor,
  getTemplateStatusHistory
} from "./whatsapp-templates.js";

function createMockDb(): {
  client: DbClient;
  queries: Array<{ text: string; values: unknown[] }>;
} {
  const queries: Array<{ text: string; values: unknown[] }> = [];

  // In-memory tables
  const templates: Array<{
    id: string;
    organization_id: string;
    channel_id: string;
    name: string;
    category: string;
    created_at: Date;
    updated_at: Date;
  }> = [];

  const versions: Array<{
    id: string;
    template_id: string;
    organization_id: string;
    provider_template_id: string;
    language: string;
    status: string;
    rejected_reason: string | null;
    components: WhatsAppTemplateComponent[];
    variable_count: number;
    payload_hash: string;
    version: number;
    created_at: Date;
    updated_at: Date;
  }> = [];

  const history: Array<{
    id: string;
    template_version_id: string;
    organization_id: string;
    from_status: string | null;
    to_status: string;
    reason: string | null;
    created_at: Date;
  }> = [];

  const cursors = new Map<string, string | null>();

  let idCounter = 1;

  const client = {
    async query(queryText: string, values: unknown[] = []) {
      await Promise.resolve();
      queries.push({ text: queryText, values });
      const sql = queryText.replace(/\s+/g, " ").trim();

      // 1. Insert/Upsert whatsapp_templates
      if (sql.includes("INSERT INTO flowdesk.whatsapp_templates")) {
        const [orgId, chanId, name, category] = values as [string, string, string, string];
        let tpl = templates.find((t) => t.channel_id === chanId && t.name === name);
        if (!tpl) {
          tpl = {
            id: `tpl-${idCounter++}`,
            organization_id: orgId,
            channel_id: chanId,
            name,
            category,
            created_at: new Date(),
            updated_at: new Date()
          };
          templates.push(tpl);
        } else {
          tpl.category = category;
          tpl.updated_at = new Date();
        }
        return { rows: [tpl], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      // 2. Select existing version FOR UPDATE
      if (sql.includes("FROM flowdesk.whatsapp_template_versions") && sql.includes("FOR UPDATE")) {
        const [templateId, language] = values as [string, string];
        const v = versions.find(
          (ver) => ver.template_id === templateId && ver.language === language
        );
        return { rows: v ? [v] : [], rowCount: v ? 1 : 0, command: "SELECT", oid: 0, fields: [] };
      }

      // 3. Update existing version
      if (sql.includes("UPDATE flowdesk.whatsapp_template_versions")) {
        const [providerTplId, status, rejectedReason, compJson, varCount, hash, verNum, vId] =
          values as [string, string, string | null, string, number, string, number, string];
        const v = versions.find((ver) => ver.id === vId);
        if (v) {
          v.provider_template_id = providerTplId;
          v.status = status;
          v.rejected_reason = rejectedReason;
          v.components = JSON.parse(compJson) as WhatsAppTemplateComponent[];
          v.variable_count = varCount;
          v.payload_hash = hash;
          v.version = verNum;
          v.updated_at = new Date();
        }
        return { rows: v ? [v] : [], rowCount: v ? 1 : 0, command: "UPDATE", oid: 0, fields: [] };
      }

      // 4. Insert new version
      if (sql.includes("INSERT INTO flowdesk.whatsapp_template_versions")) {
        const [
          templateId,
          orgId,
          providerTplId,
          language,
          status,
          rejectedReason,
          compJson,
          varCount,
          hash
        ] = values as [
          string,
          string,
          string,
          string,
          string,
          string | null,
          string,
          number,
          string
        ];

        const newVersion = {
          id: `ver-${idCounter++}`,
          template_id: templateId,
          organization_id: orgId,
          provider_template_id: providerTplId,
          language,
          status,
          rejected_reason: rejectedReason,
          components: JSON.parse(compJson) as WhatsAppTemplateComponent[],
          variable_count: varCount,
          payload_hash: hash,
          version: 1,
          created_at: new Date(),
          updated_at: new Date()
        };
        versions.push(newVersion);
        return { rows: [newVersion], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      // 5. Insert status history
      if (sql.includes("INSERT INTO flowdesk.whatsapp_template_status_history")) {
        const [versionId, orgId, fromStatus, toStatus, reason] = values as [
          string,
          string,
          string | null,
          string,
          string | null
        ];
        const item = {
          id: `hist-${idCounter++}`,
          template_version_id: versionId,
          organization_id: orgId,
          from_status: fromStatus,
          to_status: toStatus,
          reason,
          created_at: new Date()
        };
        history.push(item);
        return { rows: [item], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      // 6. Select template by name and language
      if (
        sql.includes("FROM flowdesk.whatsapp_templates t") &&
        sql.includes("JOIN flowdesk.whatsapp_template_versions v")
      ) {
        const [chanId, name, language] = values as [string, string, string];
        const tpl = templates.find((t) => t.channel_id === chanId && t.name === name);
        if (!tpl) return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };

        const ver = versions.find((v) => v.template_id === tpl.id && v.language === language);
        if (!ver) return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };

        return {
          rows: [
            {
              t_id: tpl.id,
              t_org_id: tpl.organization_id,
              t_channel_id: tpl.channel_id,
              t_name: tpl.name,
              t_category: tpl.category,
              t_created_at: tpl.created_at,
              t_updated_at: tpl.updated_at,
              v_id: ver.id,
              v_provider_template_id: ver.provider_template_id,
              v_language: ver.language,
              v_status: ver.status,
              v_rejected_reason: ver.rejected_reason,
              v_components: ver.components,
              v_variable_count: ver.variable_count,
              v_payload_hash: ver.payload_hash,
              v_version: ver.version,
              v_created_at: ver.created_at,
              v_updated_at: ver.updated_at
            }
          ],
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }

      // 7. Cursors
      if (sql.includes("SELECT cursor FROM flowdesk.whatsapp_template_sync_cursors")) {
        const [chanId] = values as [string];
        const cursor = cursors.get(chanId) ?? null;
        return {
          rows: cursor ? [{ cursor }] : [],
          rowCount: cursor ? 1 : 0,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }

      if (sql.includes("INSERT INTO flowdesk.whatsapp_template_sync_cursors")) {
        const [, chanId, cursor] = values as [string, string, string | null];
        cursors.set(chanId, cursor);
        return { rows: [], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      // 8. Status history query
      if (sql.includes("FROM flowdesk.whatsapp_template_status_history")) {
        const [vId] = values as [string];
        const items = history.filter((h) => h.template_version_id === vId);
        return { rows: items, rowCount: items.length, command: "SELECT", oid: 0, fields: [] };
      }

      return { rows: [], rowCount: 0, command: "UNKNOWN", oid: 0, fields: [] };
    }
  } as unknown as DbClient;

  return { client, queries };
}

describe("WhatsApp Templates DB Access (M3-04)", () => {
  const orgId = "00000000-0000-7000-8000-000000000001";
  const channelId = "00000000-0000-7000-8000-000000000002";

  it("idempotently creates new template and version on initial sync", async () => {
    const { client } = createMockDb();

    const components: WhatsAppTemplateComponent[] = [
      { type: "BODY", text: "Halo {{1}}, pesanan Anda telah dikirim." }
    ];

    const result = await idempotentSyncTemplate(client, {
      organizationId: orgId,
      channelId,
      providerTemplateId: "prov-123",
      name: "shipping_notice",
      category: "UTILITY",
      language: "id",
      status: "APPROVED",
      components,
      variableCount: 1,
      payloadHash: "hash-v1"
    });

    expect(result.template.name).toBe("shipping_notice");
    expect(result.template.category).toBe("UTILITY");
    expect(result.version.status).toBe("APPROVED");
    expect(result.version.version).toBe(1);
    expect(result.statusChanged).toBe(true);
    expect(result.payloadChanged).toBe(true);

    // Verify initial status history was logged
    const history = await getTemplateStatusHistory(client, result.version.id);
    expect(history.length).toBe(1);
    expect(history[0]?.fromStatus).toBeNull();
    expect(history[0]?.toStatus).toBe("APPROVED");
  });

  it("handles duplicate replay idempotently without bumping version or status", async () => {
    const { client } = createMockDb();

    const params = {
      organizationId: orgId,
      channelId,
      providerTemplateId: "prov-123",
      name: "shipping_notice",
      category: "UTILITY" as const,
      language: "id",
      status: "APPROVED" as const,
      components: [{ type: "BODY" as const, text: "Halo {{1}}." }],
      variableCount: 1,
      payloadHash: "hash-v1"
    };

    const first = await idempotentSyncTemplate(client, params);
    expect(first.version.version).toBe(1);

    // Replay identical sync
    const replay = await idempotentSyncTemplate(client, params);
    expect(replay.version.version).toBe(1);
    expect(replay.statusChanged).toBe(false);
    expect(replay.payloadChanged).toBe(false);

    // Status history remains exactly 1 entry
    const history = await getTemplateStatusHistory(client, first.version.id);
    expect(history.length).toBe(1);
  });

  it("records status transition when status changes from APPROVED to REJECTED", async () => {
    const { client } = createMockDb();

    const base = {
      organizationId: orgId,
      channelId,
      providerTemplateId: "prov-123",
      name: "promo_blast",
      category: "MARKETING" as const,
      language: "id",
      status: "PENDING" as const,
      components: [{ type: "BODY" as const, text: "Diskon 50%!" }],
      variableCount: 0,
      payloadHash: "hash-promo"
    };

    const initial = await idempotentSyncTemplate(client, base);
    expect(initial.version.status).toBe("PENDING");

    // Status transition: REJECTED with reason
    const rejected = await idempotentSyncTemplate(client, {
      ...base,
      status: "REJECTED",
      rejectedReason: "Prohibited promotional category"
    });

    expect(rejected.version.status).toBe("REJECTED");
    expect(rejected.version.rejectedReason).toBe("Prohibited promotional category");
    expect(rejected.statusChanged).toBe(true);
    expect(rejected.payloadChanged).toBe(false);
    expect(rejected.version.version).toBe(1); // version not bumped because content didn't change

    const history = await getTemplateStatusHistory(client, initial.version.id);
    expect(history.length).toBe(2);
    expect(history[1]?.fromStatus).toBe("PENDING");
    expect(history[1]?.toStatus).toBe("REJECTED");
    expect(history[1]?.reason).toBe("Prohibited promotional category");
  });

  it("increments version number when components/payload hash changes", async () => {
    const { client } = createMockDb();

    const initial = await idempotentSyncTemplate(client, {
      organizationId: orgId,
      channelId,
      providerTemplateId: "prov-123",
      name: "account_alert",
      category: "UTILITY",
      language: "en_US",
      status: "APPROVED",
      components: [{ type: "BODY", text: "Security alert: code {{1}}." }],
      variableCount: 1,
      payloadHash: "hash-v1"
    });
    expect(initial.version.version).toBe(1);

    // Update text and hash
    const updated = await idempotentSyncTemplate(client, {
      organizationId: orgId,
      channelId,
      providerTemplateId: "prov-123",
      name: "account_alert",
      category: "UTILITY",
      language: "en_US",
      status: "APPROVED",
      components: [
        { type: "HEADER", format: "TEXT", text: "Important Security Notice" },
        { type: "BODY", text: "Security alert: your verification code is {{1}}." }
      ],
      variableCount: 1,
      payloadHash: "hash-v2"
    });

    expect(updated.version.version).toBe(2);
    expect(updated.payloadChanged).toBe(true);
  });

  it("retrieves template by name and language", async () => {
    const { client } = createMockDb();

    await idempotentSyncTemplate(client, {
      organizationId: orgId,
      channelId,
      providerTemplateId: "prov-id",
      name: "welcome_user",
      category: "MARKETING",
      language: "id",
      status: "APPROVED",
      components: [{ type: "BODY", text: "Selamat datang!" }],
      variableCount: 0,
      payloadHash: "hash-id"
    });

    const found = await getTemplateByNameAndLanguage(client, {
      channelId,
      name: "welcome_user",
      language: "id"
    });

    expect(found).not.toBeNull();
    expect(found?.template.name).toBe("welcome_user");
    expect(found?.version.language).toBe("id");
    expect(found?.version.status).toBe("APPROVED");

    const notFound = await getTemplateByNameAndLanguage(client, {
      channelId,
      name: "welcome_user",
      language: "en_US"
    });
    expect(notFound).toBeNull();
  });

  it("stores and retrieves template sync cursors", async () => {
    const { client } = createMockDb();

    expect(await getTemplateSyncCursor(client, { channelId })).toBeNull();

    await setTemplateSyncCursor(client, {
      organizationId: orgId,
      channelId,
      cursor: "cursor_page_2_xyz"
    });

    expect(await getTemplateSyncCursor(client, { channelId })).toBe("cursor_page_2_xyz");

    await setTemplateSyncCursor(client, {
      organizationId: orgId,
      channelId,
      cursor: null
    });

    expect(await getTemplateSyncCursor(client, { channelId })).toBeNull();
  });
});
