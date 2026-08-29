import { describe, expect, it, vi } from "vitest";
import { FakeWhatsAppProvider, WhatsAppProviderError } from "@flowdesk/providers";
import type { DbClient } from "@flowdesk/db";
import { syncWhatsAppTemplates } from "./template-sync.js";

function createMockDb(): DbClient {
  const templates = new Map<string, { id: string; name: string; category: string }>();
  const versions = new Map<
    string,
    {
      id: string;
      status: string;
      payload_hash: string;
      version: number;
      rejected_reason: string | null;
    }
  >();
  const cursors = new Map<string, string | null>();
  let idCounter = 1;

  const client = {
    async query(queryText: string, values: unknown[] = []) {
      await Promise.resolve();
      const sql = queryText.replace(/\s+/g, " ").trim();

      if (sql.includes("INSERT INTO flowdesk.whatsapp_templates")) {
        const [, chanId, name, category] = values as [string, string, string, string];
        const key = `${chanId}:${name}`;
        let tpl = templates.get(key);
        if (!tpl) {
          tpl = { id: `tpl-${idCounter++}`, name, category };
          templates.set(key, tpl);
        }
        return {
          rows: [
            {
              id: tpl.id,
              organization_id: String(values[0]),
              channel_id: chanId,
              name: tpl.name,
              category: tpl.category,
              created_at: new Date(),
              updated_at: new Date()
            }
          ],
          rowCount: 1,
          command: "INSERT",
          oid: 0,
          fields: []
        };
      }

      if (sql.includes("FROM flowdesk.whatsapp_template_versions") && sql.includes("FOR UPDATE")) {
        const [templateId, language] = values as [string, string];
        const key = `${templateId}:${language}`;
        const ver = versions.get(key);
        return {
          rows: ver ? [ver] : [],
          rowCount: ver ? 1 : 0,
          command: "SELECT",
          oid: 0,
          fields: []
        };
      }

      if (sql.includes("UPDATE flowdesk.whatsapp_template_versions")) {
        const [provId, status, rejReason, comps, varCount, hash, verNum, vId] = values as [
          string,
          string,
          string | null,
          string,
          number,
          string,
          number,
          string
        ];
        for (const [k, v] of versions.entries()) {
          if (v.id === vId) {
            v.status = status;
            v.payload_hash = hash;
            v.version = verNum;
            v.rejected_reason = rejReason;
            return {
              rows: [
                {
                  id: v.id,
                  template_id: k.split(":")[0],
                  organization_id: "org-1",
                  provider_template_id: provId,
                  language: k.split(":")[1],
                  status: v.status,
                  rejected_reason: rejReason,
                  components: JSON.parse(comps) as unknown,
                  variable_count: varCount,
                  payload_hash: v.payload_hash,
                  version: v.version,
                  created_at: new Date(),
                  updated_at: new Date()
                }
              ],
              rowCount: 1,
              command: "UPDATE",
              oid: 0,
              fields: []
            };
          }
        }
      }

      if (sql.includes("INSERT INTO flowdesk.whatsapp_template_versions")) {
        const [templateId, orgId, provId, language, status, rejReason, comps, varCount, hash] =
          values as [string, string, string, string, string, string | null, string, number, string];
        const newVer = {
          id: `ver-${idCounter++}`,
          status,
          payload_hash: hash,
          version: 1,
          rejected_reason: rejReason
        };
        versions.set(`${templateId}:${language}`, newVer);
        return {
          rows: [
            {
              id: newVer.id,
              template_id: templateId,
              organization_id: orgId,
              provider_template_id: provId,
              language,
              status: newVer.status,
              rejected_reason: rejReason,
              components: JSON.parse(comps) as unknown,
              variable_count: varCount,
              payload_hash: newVer.payload_hash,
              version: 1,
              created_at: new Date(),
              updated_at: new Date()
            }
          ],
          rowCount: 1,
          command: "INSERT",
          oid: 0,
          fields: []
        };
      }

      if (sql.includes("INSERT INTO flowdesk.whatsapp_template_status_history")) {
        return { rows: [], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

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

      return { rows: [], rowCount: 0, command: "UNKNOWN", oid: 0, fields: [] };
    }
  } as unknown as DbClient;

  return client;
}

describe("WhatsApp Template Sync Worker (M3-04)", () => {
  const orgId = "00000000-0000-7000-8000-000000000001";
  const channelId = "00000000-0000-7000-8000-000000000002";
  const secretToken = "EAAGm0PXq12345secretTokenXYZ";

  it("synchronizes provider templates and records sync counters", async () => {
    const db = createMockDb();
    const provider = new FakeWhatsAppProvider();
    provider.setTemplates([
      {
        id: "prov-1",
        name: "delivery_alert",
        language: "id",
        category: "UTILITY",
        status: "APPROVED",
        components: [
          { type: "HEADER", format: "TEXT", text: "Status Pengiriman" },
          { type: "BODY", text: "Halo {{1}}, kurir sedang menuju ke alamat Anda." }
        ]
      },
      {
        id: "prov-2",
        name: "promo_weekend",
        language: "id",
        category: "MARKETING",
        status: "PENDING",
        components: [{ type: "BODY", text: "Promo spesial akhir pekan!" }]
      }
    ]);

    const result = await syncWhatsAppTemplates(
      {
        organizationId: orgId,
        channelId,
        wabaId: "waba-123",
        accessToken: secretToken
      },
      { db, provider }
    );

    expect(result.channelId).toBe(channelId);
    expect(result.totalFetched).toBe(2);
    expect(result.syncedCount).toBe(2);
    expect(result.statusChangedCount).toBe(2);
    expect(result.payloadChangedCount).toBe(2);
  });

  it("is idempotent on replay and detects subsequent provider status changes", async () => {
    const db = createMockDb();
    const provider = new FakeWhatsAppProvider();
    provider.setTemplates([
      {
        id: "prov-1",
        name: "account_verify",
        language: "en_US",
        category: "AUTHENTICATION",
        status: "PENDING",
        components: [{ type: "BODY", text: "Your verification code is {{1}}." }]
      }
    ]);

    // First sync
    const firstSync = await syncWhatsAppTemplates(
      {
        organizationId: orgId,
        channelId,
        wabaId: "waba-123",
        accessToken: secretToken
      },
      { db, provider }
    );
    expect(firstSync.statusChangedCount).toBe(1);

    // Replay with no changes
    const replaySync = await syncWhatsAppTemplates(
      {
        organizationId: orgId,
        channelId,
        wabaId: "waba-123",
        accessToken: secretToken
      },
      { db, provider }
    );
    expect(replaySync.statusChangedCount).toBe(0);
    expect(replaySync.payloadChangedCount).toBe(0);

    // Update status in provider
    provider.simulateTemplateStatusUpdate("prov-1", "APPROVED");

    const thirdSync = await syncWhatsAppTemplates(
      {
        organizationId: orgId,
        channelId,
        wabaId: "waba-123",
        accessToken: secretToken
      },
      { db, provider }
    );
    expect(thirdSync.statusChangedCount).toBe(1);
    expect(thirdSync.payloadChangedCount).toBe(0);
  });

  it("skips templates with invalid component hierarchies", async () => {
    const db = createMockDb();
    const provider = new FakeWhatsAppProvider();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    provider.setTemplates([
      {
        id: "prov-bad",
        name: "broken_template",
        language: "id",
        category: "UTILITY",
        status: "PENDING",
        components: [
          // Missing BODY component!
          { type: "HEADER", format: "TEXT", text: "Header only" }
        ]
      },
      {
        id: "prov-good",
        name: "valid_template",
        language: "id",
        category: "UTILITY",
        status: "APPROVED",
        components: [{ type: "BODY", text: "Valid body text" }]
      }
    ]);

    const result = await syncWhatsAppTemplates(
      {
        organizationId: orgId,
        channelId,
        wabaId: "waba-123",
        accessToken: secretToken
      },
      { db, provider, logger }
    );

    expect(result.totalFetched).toBe(2);
    expect(result.syncedCount).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipping invalid WhatsApp template"),
      expect.objectContaining({ templateName: "broken_template" })
    );
  });

  it("redacts access token when provider errors occur", async () => {
    const db = createMockDb();
    const provider = new FakeWhatsAppProvider();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    provider.simulateFailure = () => {
      return new WhatsAppProviderError({
        message: `Authentication failed with token ${secretToken}`,
        classification: "AUTH_FAILED",
        statusCode: 401
      });
    };

    await expect(
      syncWhatsAppTemplates(
        {
          organizationId: orgId,
          channelId,
          wabaId: "waba-123",
          accessToken: secretToken
        },
        { db, provider, logger }
      )
    ).rejects.toThrow("Authentication failed with token [REDACTED_ACCESS_TOKEN]");

    expect(logger.error).toHaveBeenCalledWith(
      "WhatsApp template synchronization failed",
      expect.objectContaining({
        error: expect.stringContaining("[REDACTED_ACCESS_TOKEN]") as unknown as string
      })
    );
  });
});
