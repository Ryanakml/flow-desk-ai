import { describe, it, expect, vi } from "vitest";
import {
  createKnowledgeSource,
  getKnowledgeSourceById,
  listKnowledgeSources,
  updateKnowledgeSourceStatus,
  createDocumentWithChunks,
  searchDocumentChunks,
  getBotConfig,
  upsertBotConfig,
  recordBotRun,
  updateBotRunAction
} from "./knowledge.js";
import type { DbClient } from "./auth.js";

describe("M4 Knowledge Base & Vector Database Repository", () => {
  const orgId = "11111111-1111-1111-1111-111111111111";
  const sourceId = "22222222-2222-2222-2222-222222222222";
  const docId = "33333333-3333-3333-3333-333333333333";
  const convId = "44444444-4444-4444-4444-444444444444";
  const botConfigId = "55555555-5555-5555-5555-555555555555";
  const botRunId = "66666666-6666-6666-6666-666666666666";

  it("creates and retrieves a knowledge source", async () => {
    const mockRow = {
      id: sourceId,
      organization_id: orgId,
      type: "url" as const,
      name: "FlowDesk Docs",
      source_uri: "https://docs.flowdesk.dev/faq",
      status: "pending" as const,
      status_reason: null,
      content_hash: "abc123hash",
      byte_size: "1024",
      metadata: { author: "admin" },
      last_indexed_at: null,
      created_by_user_id: null,
      created_at: new Date("2026-08-29T12:00:00Z"),
      updated_at: new Date("2026-08-29T12:00:00Z"),
      deleted_at: null
    };

    const query = vi.fn().mockResolvedValue({ rows: [mockRow] });
    const mockDb = { query } as unknown as DbClient;

    const source = await createKnowledgeSource(mockDb, {
      organizationId: orgId,
      type: "url",
      name: "FlowDesk Docs",
      sourceUri: "https://docs.flowdesk.dev/faq",
      contentHash: "abc123hash",
      byteSize: 1024,
      metadata: { author: "admin" }
    });

    expect(source.id).toBe(sourceId);
    expect(source.byteSize).toBe(1024);
    expect(source.type).toBe("url");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO flowdesk.knowledge_sources"),
      expect.arrayContaining([orgId, "url", "FlowDesk Docs", "https://docs.flowdesk.dev/faq"])
    );

    const fetched = await getKnowledgeSourceById(mockDb, sourceId);
    expect(fetched?.id).toBe(sourceId);
  });

  it("lists knowledge sources and updates status", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: sourceId,
            organization_id: orgId,
            type: "text",
            name: "Return Policy",
            source_uri: null,
            status: "active",
            status_reason: null,
            content_hash: "hash1",
            byte_size: "500",
            metadata: {},
            last_indexed_at: new Date(),
            created_by_user_id: null,
            created_at: new Date(),
            updated_at: new Date(),
            deleted_at: null
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });
    const mockDb = { query } as unknown as DbClient;

    const list = await listKnowledgeSources(mockDb, orgId);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("Return Policy");

    await updateKnowledgeSourceStatus(mockDb, sourceId, "active");
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("UPDATE flowdesk.knowledge_sources"),
      ["active", null, sourceId]
    );
  });

  it("creates documents with chunks and vector embeddings", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: docId }] });
    const mockDb = { query } as unknown as DbClient;

    const res = await createDocumentWithChunks(mockDb, {
      organizationId: orgId,
      sourceId,
      title: "FAQ Guide",
      contentHash: "hash_doc",
      rawContent: "Full guide text",
      chunks: [
        {
          chunkIndex: 0,
          content: "Section 1: Returns are free within 30 days.",
          contentHash: "chunk_hash_0",
          embedding: [0.1, 0.2, 0.3],
          tokenCount: 10
        },
        {
          chunkIndex: 1,
          content: "Section 2: Contact support for custom enterprise pricing.",
          contentHash: "chunk_hash_1",
          embedding: [0.4, 0.5, 0.6],
          tokenCount: 12
        }
      ]
    });

    expect(res.documentId).toBe(docId);
    expect(res.chunkCount).toBe(2);
    expect(query).toHaveBeenCalledTimes(3); // 1 doc insert + 2 chunk inserts
  });

  it("executes semantic search query with cosine similarity calculation", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "chunk-1",
          organization_id: orgId,
          document_id: docId,
          source_id: sourceId,
          chunk_index: 0,
          content: "Returns are accepted within 30 days.",
          content_hash: "hash0",
          token_count: 8,
          metadata: {},
          created_at: new Date(),
          similarity: "0.89"
        }
      ]
    });
    const mockDb = { query } as unknown as DbClient;

    const results = await searchDocumentChunks(mockDb, {
      organizationId: orgId,
      queryEmbedding: [0.1, 0.2, 0.3],
      topK: 3,
      similarityThreshold: 0.75
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.similarity).toBe(0.89);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY embedding <=> $1::vector ASC"),
      ["[0.1,0.2,0.3]", orgId, 0.75, 3]
    );
  });

  it("manages bot configs and records bot runs", async () => {
    const mockBotRow = {
      id: botConfigId,
      organization_id: orgId,
      mode: "draft" as const,
      name: "FlowDesk AI Assistant",
      instructions: "Assist customer politely.",
      tone: "friendly" as const,
      language: "id" as const,
      model: "gpt-4o-mini",
      confidence_threshold: "0.75",
      top_k: 5,
      emergency_disabled: false,
      metadata: {},
      created_at: new Date(),
      updated_at: new Date()
    };

    const mockRunRow = {
      id: botRunId,
      organization_id: orgId,
      conversation_id: convId,
      trigger_message_id: null,
      bot_config_id: botConfigId,
      knowledge_version_id: null,
      mode: "draft" as const,
      status: "completed" as const,
      suggested_content: "Halo, ada yang bisa kami bantu?",
      citations: [],
      reasoning: "Matched greeting intent",
      confidence: "0.95",
      prompt_tokens: 150,
      completion_tokens: 30,
      total_tokens: 180,
      latency_ms: 450,
      cost_estimate_microcents: "250",
      operator_action: null,
      operator_action_at: null,
      operator_user_id: null,
      error_detail: null,
      metadata: {},
      created_at: new Date()
    };

    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [mockBotRow] }) // getBotConfig
      .mockResolvedValueOnce({ rows: [mockBotRow] }) // upsertBotConfig
      .mockResolvedValueOnce({ rows: [mockRunRow] }) // recordBotRun
      .mockResolvedValueOnce({ rows: [] }); // updateBotRunAction
    const mockDb = { query } as unknown as DbClient;

    const botConfig = await getBotConfig(mockDb, orgId);
    expect(botConfig?.confidenceThreshold).toBe(0.75);

    const upserted = await upsertBotConfig(mockDb, {
      organizationId: orgId,
      mode: "draft",
      tone: "friendly"
    });
    expect(upserted.tone).toBe("friendly");

    const run = await recordBotRun(mockDb, {
      organizationId: orgId,
      conversationId: convId,
      botConfigId,
      mode: "draft",
      status: "completed",
      suggestedContent: "Halo, ada yang bisa kami bantu?",
      confidence: 0.95,
      totalTokens: 180
    });
    expect(run.confidence).toBe(0.95);
    expect(run.costEstimateMicrocents).toBe(250);

    await updateBotRunAction(mockDb, {
      botRunId,
      action: "approved",
      userId: "user-123"
    });
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("UPDATE flowdesk.bot_runs"), [
      "approved",
      "user-123",
      botRunId
    ]);
  });
});
