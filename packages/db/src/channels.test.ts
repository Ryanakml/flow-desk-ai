import { describe, expect, it } from "vitest";
import type { DbClient } from "./auth.js";
import {
  createChannel,
  getChannelById,
  getChannelByPhoneNumberId,
  listChannels,
  updateChannelCredentials,
  updateChannelStatus
} from "./channels.js";

interface MockChannelRow {
  id: string;
  organization_id: string;
  type: string;
  name: string;
  phone_number_id: string;
  waba_id: string;
  encrypted_credentials: string;
  status: string;
  status_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

function createMockDb(): DbClient {
  const channels = new Map<string, MockChannelRow>();

  return {
    async query(queryText: string, values: unknown[] = []) {
      await Promise.resolve();
      const sql = queryText.replace(/\s+/g, " ").trim();

      if (sql.includes("INSERT INTO flowdesk.channels")) {
        const id = "c0000000-0000-4000-8000-000000000001";
        const channel: MockChannelRow = {
          id,
          organization_id: values[0] as string,
          type: values[1] as string,
          name: values[2] as string,
          phone_number_id: values[3] as string,
          waba_id: values[4] as string,
          encrypted_credentials: values[5] as string,
          status: values[6] as string,
          status_reason: (values[7] as string | null) ?? null,
          metadata: JSON.parse(values[8] as string) as Record<string, unknown>,
          created_at: new Date(),
          updated_at: new Date()
        };
        channels.set(id, channel);
        return { rows: [channel], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
      }

      if (sql.includes("WHERE phone_number_id = $1")) {
        const phone = values[0] as string;
        for (const ch of channels.values()) {
          if (ch.phone_number_id === phone) {
            return { rows: [ch], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
          }
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      if (sql.includes("SELECT * FROM flowdesk.channels WHERE id = $1")) {
        const id = values[0] as string;
        const ch = channels.get(id);
        if (ch) {
          return { rows: [ch], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }

      if (sql.includes("SELECT * FROM flowdesk.channels WHERE organization_id = $1")) {
        const orgId = values[0] as string;
        const matching = Array.from(channels.values()).filter((c) => c.organization_id === orgId);
        return { rows: matching, rowCount: matching.length, command: "SELECT", oid: 0, fields: [] };
      }

      if (sql.includes("UPDATE flowdesk.channels SET status = $2")) {
        const id = values[0] as string;
        const targetStatus = values[1] as string;
        const reason = (values[2] as string | null) ?? null;
        const ch = channels.get(id);
        if (ch) {
          ch.status = targetStatus;
          ch.status_reason = reason;
          ch.updated_at = new Date();
          return { rows: [ch], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }
      }

      if (sql.includes("SET encrypted_credentials = $3")) {
        const id = values[0] as string;
        const organizationId = values[1] as string;
        const channel = channels.get(id);
        if (channel?.organization_id === organizationId) {
          channel.encrypted_credentials = values[2] as string;
          channel.updated_at = new Date();
          return { rows: [channel], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
        }
      }

      return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
    }
  } as unknown as DbClient;
}

describe("Channels Repository (M2-01)", () => {
  it("creates and retrieves a channel", async () => {
    const db = createMockDb();
    const created = await createChannel(db, {
      organizationId: "a0000000-0000-4000-8000-000000000001",
      name: "WhatsApp Support",
      phoneNumberId: "10987654321",
      wabaId: "waba-123456",
      encryptedCredentials: "mock-encrypted-envelope"
    });

    expect(created.name).toBe("WhatsApp Support");
    expect(created.type).toBe("whatsapp");
    expect(created.status).toBe("draft");

    const fetched = await getChannelById(db, created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.phoneNumberId).toBe("10987654321");

    const byPhone = await getChannelByPhoneNumberId(db, "10987654321");
    expect(byPhone).not.toBeNull();
    expect(byPhone?.id).toBe(created.id);
  });

  it("lists channels for an organization", async () => {
    const db = createMockDb();
    await createChannel(db, {
      organizationId: "a0000000-0000-4000-8000-000000000001",
      name: "Primary WhatsApp",
      phoneNumberId: "10000000001",
      wabaId: "waba-1",
      encryptedCredentials: "enc-1"
    });

    const list = await listChannels(db, "a0000000-0000-4000-8000-000000000001");
    expect(list.length).toBe(1);
    expect(list[0]?.name).toBe("Primary WhatsApp");
  });

  it("updates channel status through valid transitions and rejects invalid ones", async () => {
    const db = createMockDb();
    const channel = await createChannel(db, {
      organizationId: "a0000000-0000-4000-8000-000000000001",
      name: "Ops Line",
      phoneNumberId: "10000000002",
      wabaId: "waba-2",
      encryptedCredentials: "enc-2"
    });

    // Valid: draft -> connecting
    const connecting = await updateChannelStatus(db, channel.id, "connecting");
    expect(connecting.status).toBe("connecting");

    // Valid: connecting -> active
    const active = await updateChannelStatus(db, channel.id, "active");
    expect(active.status).toBe("active");

    // Invalid: active cannot go back to draft directly
    await expect(updateChannelStatus(db, channel.id, "draft")).rejects.toThrow(
      "Invalid channel status transition from 'active' to 'draft'."
    );
  });

  it("rotates only encrypted credentials while preserving channel identity", async () => {
    const db = createMockDb();
    const channel = await createChannel(db, {
      organizationId: "a0000000-0000-4000-8000-000000000001",
      name: "Rotation Line",
      phoneNumberId: "10000000003",
      wabaId: "waba-3",
      encryptedCredentials: "old-envelope"
    });
    const updated = await updateChannelCredentials(db, {
      id: channel.id,
      organizationId: channel.organizationId,
      encryptedCredentials: "new-envelope"
    });
    expect(updated).toMatchObject({
      id: channel.id,
      organizationId: channel.organizationId,
      phoneNumberId: channel.phoneNumberId,
      wabaId: channel.wabaId,
      encryptedCredentials: "new-envelope"
    });
  });
});
