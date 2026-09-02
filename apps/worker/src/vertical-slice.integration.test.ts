import { randomUUID } from "node:crypto";
import {
  createChannel,
  createMessage,
  createOutboundMessageWithOutbox,
  enqueueBotDraftRun,
  findOrCreateConversation,
  finishBotDraftRun,
  getConversationById,
  listMessagesByConversation,
  recordWebhookEvent,
  runInTenantTransaction,
  upsertBotConfig
} from "@flowdesk/db";
import { FakeWhatsAppProvider } from "@flowdesk/providers";
import { encryptWhatsAppChannelCredentials } from "@flowdesk/security";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processOutboxOutboundBatch } from "./dispatch.js";
import { processWebhookPayload } from "./normalization.js";
import { processCompletedAutoRun } from "./auto-send.js";

const connectionString = process.env["DATABASE_MIGRATOR_URL"];
const integration = connectionString ? describe : describe.skip;
const pool = connectionString ? new Pool({ connectionString }) : undefined;

const organizationA = randomUUID();
const organizationB = randomUUID();
const agentUserId = randomUUID();
const phoneNumberId = `phone-${randomUUID()}`;
const wabaId = `waba-${randomUUID()}`;
const encryptionKey = "m2-real-postgres-integration-key";

beforeAll(async () => {
  if (!pool) return;
  await pool.query(
    `INSERT INTO flowdesk.organizations (id, slug, display_name)
     VALUES ($1, $2, 'M2 Integration A'), ($3, $4, 'M2 Integration B')`,
    [
      organizationA,
      `m2-a-${organizationA.slice(0, 8)}`,
      organizationB,
      `m2-b-${organizationB.slice(0, 8)}`
    ]
  );
  await pool.query(
    `INSERT INTO flowdesk.users (id, email, display_name)
     VALUES ($1, $2, 'M2 Integration Agent')`,
    [agentUserId, `m2-${agentUserId}@flowdesk.test`]
  );
});

afterAll(async () => {
  await pool?.end();
});

integration("M2 vertical slice against PostgreSQL RLS", () => {
  it("deduplicates 100 inbound replays, persists domain history, and dispatches once", async () => {
    if (!pool) throw new Error("integration pool unavailable");

    const provider = new FakeWhatsAppProvider();
    const channel = await runInTenantTransaction(pool, { organizationId: organizationA }, (db) =>
      createChannel(db, {
        organizationId: organizationA,
        name: "Integration WhatsApp",
        phoneNumberId,
        wabaId,
        encryptedCredentials: encryptWhatsAppChannelCredentials(
          {
            accessToken: "fake-access-token",
            phoneNumberId,
            wabaId
          },
          encryptionKey
        ),
        status: "active"
      })
    );

    const inbound = provider.createInboundTextWebhook({
      phoneNumberId,
      from: "+62 812-3456-7890",
      text: "Halo from the real database integration test",
      messageId: `wamid.inbound.${randomUUID()}`,
      senderName: "Budi"
    });

    const ingressHash = `sha256-${randomUUID()}`;
    const firstIngress = await recordWebhookEvent(pool, {
      provider: "whatsapp",
      payloadHash: ingressHash,
      rawPayload: JSON.stringify(inbound),
      phoneNumberId
    });
    const replayedIngress = await recordWebhookEvent(pool, {
      provider: "whatsapp",
      payloadHash: ingressHash,
      rawPayload: JSON.stringify(inbound),
      phoneNumberId
    });
    expect(firstIngress.deduplicated).toBe(false);
    expect(firstIngress.webhookEvent.organizationId).toBe(organizationA);
    expect(replayedIngress.deduplicated).toBe(true);
    expect(replayedIngress.webhookEvent.id).toBe(firstIngress.webhookEvent.id);

    const inboundResult = await runInTenantTransaction(
      pool,
      { organizationId: organizationA },
      async (db) => {
        let lastResult = await processWebhookPayload(db, {
          organizationId: organizationA,
          rawPayload: inbound
        });
        for (let replay = 1; replay < 100; replay += 1) {
          lastResult = await processWebhookPayload(db, {
            organizationId: organizationA,
            rawPayload: inbound
          });
        }
        return lastResult;
      }
    );

    expect(inboundResult.processedInboundCount).toBe(0);
    const conversationId = inboundResult.conversationIds[0]!;

    const outbound = await runInTenantTransaction(pool, { organizationId: organizationA }, (db) =>
      createOutboundMessageWithOutbox(db, {
        organizationId: organizationA,
        conversationId,
        senderUserId: agentUserId,
        content: "Balasan agent",
        correlationId: randomUUID()
      })
    );

    const competingWorkers = await Promise.all([
      processOutboxOutboundBatch(pool, { provider, encryptionKey }, 10),
      processOutboxOutboundBatch(pool, { provider, encryptionKey }, 10)
    ]);
    expect(competingWorkers.reduce((total, count) => total + count, 0)).toBe(1);
    expect(await processOutboxOutboundBatch(pool, { provider, encryptionKey }, 10)).toBe(0);

    const proof = await runInTenantTransaction(
      pool,
      { organizationId: organizationA },
      async (db) => {
        const conversation = await getConversationById(db, organizationA, conversationId);
        const messages = await listMessagesByConversation(db, organizationA, conversationId, 20);
        const contacts = await db.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM flowdesk.contacts WHERE organization_id = $1",
          [organizationA]
        );
        const statusEvents = await db.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM flowdesk.message_status_events WHERE organization_id = $1",
          [organizationA]
        );
        const intents = await db.query<{ state: string; provider_message_id: string | null }>(
          `SELECT state, provider_message_id FROM flowdesk.outbound_intents
           WHERE organization_id = $1 AND message_id = $2`,
          [organizationA, outbound.id]
        );
        return { conversation, messages, contacts, statusEvents, intents };
      }
    );

    expect(proof.conversation).not.toBeNull();
    expect(proof.conversation?.channelId).toBe(channel.id);
    expect(proof.messages.filter((message) => message.direction === "inbound")).toHaveLength(1);
    expect(proof.messages.filter((message) => message.direction === "outbound")).toHaveLength(1);
    expect(proof.contacts.rows[0]?.count).toBe("1");
    expect(Number(proof.statusEvents.rows[0]?.count)).toBeGreaterThanOrEqual(3);
    expect(proof.intents.rows).toHaveLength(1);
    expect(proof.intents.rows[0]?.state).toBe("sent");
    expect(proof.intents.rows[0]?.provider_message_id).toMatch(/^wamid\./);
    expect(provider.getSentMessages()).toHaveLength(1);

    const interrupted = await runInTenantTransaction(
      pool,
      { organizationId: organizationA },
      async (db) => {
        const message = await createOutboundMessageWithOutbox(db, {
          organizationId: organizationA,
          conversationId,
          senderUserId: agentUserId,
          content: "Must not be resent after an ambiguous crash",
          correlationId: randomUUID()
        });
        await db.query(
          `UPDATE flowdesk.outbound_intents
           SET state = 'dispatching', claimed_at = clock_timestamp() - interval '1 minute'
           WHERE organization_id = $1 AND message_id = $2`,
          [organizationA, message.id]
        );
        return message;
      }
    );
    expect(await processOutboxOutboundBatch(pool, { provider, encryptionKey }, 10)).toBe(1);
    expect(provider.getSentMessages()).toHaveLength(1);
    const interruptedIntent = await runInTenantTransaction(
      pool,
      { organizationId: organizationA },
      (db) =>
        db.query<{ state: string }>(
          `SELECT state FROM flowdesk.outbound_intents
           WHERE organization_id = $1 AND message_id = $2`,
          [organizationA, interrupted.id]
        )
    );
    expect(interruptedIntent.rows[0]?.state).toBe("reconcile_required");

    const tenantBView = await runInTenantTransaction(
      pool,
      { organizationId: organizationB },
      async (db) => ({
        conversation: await getConversationById(db, organizationB, conversationId),
        messages: await listMessagesByConversation(db, organizationB, conversationId, 20)
      })
    );
    expect(tenantBView).toEqual({ conversation: null, messages: [] });
  });
});

integration("M5 AUTO post-generation runtime against PostgreSQL RLS (#178)", () => {
  it("keeps OFF/DRAFT/no-evidence fail-closed and sends one eligible AUTO result exactly once", async () => {
    if (!pool) throw new Error("integration pool unavailable");

    const provider = new FakeWhatsAppProvider();
    const testId = randomUUID();
    const channel = await runInTenantTransaction(pool, { organizationId: organizationA }, (db) =>
      createChannel(db, {
        organizationId: organizationA,
        name: `AUTO regression ${testId}`,
        phoneNumberId: `phone-auto-${testId}`,
        wabaId: `waba-auto-${testId}`,
        encryptedCredentials: encryptWhatsAppChannelCredentials(
          {
            accessToken: "fake-auto-access-token",
            phoneNumberId: `phone-auto-${testId}`,
            wabaId: `waba-auto-${testId}`
          },
          encryptionKey
        ),
        status: "active"
      })
    );

    const setupCompletedRun = async (
      mode: "off" | "draft" | "auto",
      status: "completed" | "no_evidence",
      suffix: string
    ) =>
      runInTenantTransaction(pool, { organizationId: organizationA }, async (db) => {
        const config = await upsertBotConfig(db, {
          organizationId: organizationA,
          mode,
          confidenceThreshold: 0.9,
          emergencyDisabled: false
        });
        const conversation = await findOrCreateConversation(db, {
          organizationId: organizationA,
          channelId: channel.id,
          customerPhone: `+62812${suffix}`,
          customerName: `AUTO ${suffix}`
        });
        const inbound = await createMessage(db, {
          organizationId: organizationA,
          conversationId: conversation.id,
          channelId: channel.id,
          direction: "inbound",
          senderType: "customer",
          providerMessageId: `wamid.${suffix}.${testId}`,
          content: "Apakah garansi berlaku satu tahun?",
          status: "delivered",
          sentAt: new Date()
        });
        const run = await enqueueBotDraftRun(db, {
          organizationId: organizationA,
          conversationId: conversation.id,
          triggerMessageId: inbound.id,
          botConfigId: config.id,
          knowledgeVersionId: null,
          requestedByUserId: null,
          model: "fake-grounded-model",
          mode,
          configSnapshot: {
            botConfigUpdatedAt: config.updatedAt.toISOString(),
            confidenceThreshold: config.confidenceThreshold
          },
          inputMessageCreatedAt: inbound.createdAt
        });
        await finishBotDraftRun(db, {
          id: run.id,
          status,
          ...(status === "completed"
            ? {
                suggestedContent: "Garansi berlaku satu tahun.",
                citations: [
                  {
                    chunkId: randomUUID(),
                    sourceTitle: "FAQ garansi",
                    snippet: "Garansi produk berlaku selama satu tahun.",
                    score: 0.98
                  }
                ],
                confidence: 0.98
              }
            : { errorCode: "NO_KNOWLEDGE_EVIDENCE" })
        });
        return { runId: run.id, conversationId: conversation.id };
      });

    for (const scenario of [
      { mode: "off" as const, status: "completed" as const, suffix: "1001" },
      { mode: "draft" as const, status: "completed" as const, suffix: "1002" },
      { mode: "auto" as const, status: "no_evidence" as const, suffix: "1003" }
    ]) {
      const prepared = await setupCompletedRun(scenario.mode, scenario.status, scenario.suffix);
      const decision = await runInTenantTransaction(pool, { organizationId: organizationA }, (db) =>
        processCompletedAutoRun(db, {
          organizationId: organizationA,
          runId: prepared.runId
        })
      );
      expect(decision.autoSent).toBe(false);

      const outboundCount = await runInTenantTransaction(
        pool,
        { organizationId: organizationA },
        (db) =>
          db.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM flowdesk.messages
             WHERE organization_id = $1 AND conversation_id = $2 AND direction = 'outbound'`,
            [organizationA, prepared.conversationId]
          )
      );
      expect(outboundCount.rows[0]?.count).toBe("0");
    }

    const eligible = await setupCompletedRun("auto", "completed", "1004");
    const first = await runInTenantTransaction(pool, { organizationId: organizationA }, (db) =>
      processCompletedAutoRun(db, {
        organizationId: organizationA,
        runId: eligible.runId
      })
    );
    const replay = await runInTenantTransaction(pool, { organizationId: organizationA }, (db) =>
      processCompletedAutoRun(db, {
        organizationId: organizationA,
        runId: eligible.runId
      })
    );

    expect(first.autoSent).toBe(true);
    expect(replay).toMatchObject({ autoSent: true, messageId: first.messageId });

    const competingWorkers = await Promise.all([
      processOutboxOutboundBatch(pool, { provider, encryptionKey }, 10),
      processOutboxOutboundBatch(pool, { provider, encryptionKey }, 10)
    ]);
    expect(competingWorkers.reduce((total, count) => total + count, 0)).toBe(1);
    expect(provider.getSentMessages()).toHaveLength(1);

    const proof = await runInTenantTransaction(pool, { organizationId: organizationA }, (db) =>
      db.query<{
        messages: string;
        intents: string;
        outbox_events: string;
        sent_intents: string;
      }>(
        `SELECT
             count(DISTINCT message.id)::text AS messages,
             count(DISTINCT intent.id)::text AS intents,
             count(DISTINCT event.id)::text AS outbox_events,
             (count(DISTINCT intent.id) FILTER (WHERE intent.state = 'sent'))::text AS sent_intents
           FROM flowdesk.messages AS message
           LEFT JOIN flowdesk.outbound_intents AS intent
             ON intent.organization_id = message.organization_id AND intent.message_id = message.id
           LEFT JOIN flowdesk.outbox_events AS event
             ON event.organization_id = message.organization_id
            AND event.aggregate_id = message.id
            AND event.event_type = 'message.outbound.created'
           WHERE message.organization_id = $1
             AND message.direction = 'outbound'
             AND message.metadata->>'aiBotRunId' = $2`,
        [organizationA, eligible.runId]
      )
    );
    expect(proof.rows[0]).toEqual({
      messages: "1",
      intents: "1",
      outbox_events: "1",
      sent_intents: "1"
    });
  });
});
