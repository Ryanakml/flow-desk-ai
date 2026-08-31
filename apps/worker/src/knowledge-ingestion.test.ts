import { describe, expect, it } from "vitest";
import type { DbClient } from "@flowdesk/db";
import {
  AiProviderError,
  FakeEmbeddingProvider,
  type AiEmbeddingProvider
} from "@flowdesk/providers";
import { processKnowledgeIngestionBatch } from "./knowledge-ingestion.js";

function createMockDb() {
  const state = {
    claimed: false,
    sourceStatus: "pending",
    jobStatus: "queued",
    attempts: 0,
    documents: 0,
    chunks: [] as number[][]
  };
  const now = new Date();
  const db = {
    async query(sql: string, params: unknown[] = []) {
      await Promise.resolve();
      if (sql.includes("claim_knowledge_ingestion_jobs")) {
        if (state.claimed) return result([]);
        state.claimed = true;
        state.attempts++;
        state.jobStatus = "processing";
        return result([
          {
            id: "job-1",
            organization_id: "org-1",
            source_id: "source-1",
            attempts: state.attempts,
            max_attempts: 3
          }
        ]);
      }
      if (sql.includes("FROM flowdesk.knowledge_ingestion_jobs WHERE id")) {
        return result([
          {
            id: "job-1",
            organization_id: "org-1",
            source_id: "source-1",
            dedupe_key: "dedupe-1",
            input_text: "FlowDesk refunds are available within seven days.",
            status: state.jobStatus,
            attempts: state.attempts,
            max_attempts: 3,
            available_at: now,
            error_code: null,
            error_detail: null
          }
        ]);
      }
      if (sql.includes("SELECT * FROM flowdesk.knowledge_sources")) {
        return result([
          {
            id: "source-1",
            organization_id: "org-1",
            type: "text",
            name: "Refund policy",
            source_uri: null,
            status: state.sourceStatus,
            status_reason: null,
            content_hash: null,
            dedupe_key: "dedupe-1",
            byte_size: "0",
            metadata: {},
            last_indexed_at: null,
            created_by_user_id: "user-1",
            created_at: now,
            updated_at: now,
            deleted_at: null
          }
        ]);
      }
      if (sql.includes("UPDATE flowdesk.knowledge_sources") && sql.includes("status = $1")) {
        state.sourceStatus = params[0] as string;
        return result([]);
      }
      if (sql.includes("DELETE FROM flowdesk.documents")) {
        state.documents = 0;
        state.chunks = [];
        return result([]);
      }
      if (sql.includes("INSERT INTO flowdesk.documents")) {
        state.documents++;
        return result([{ id: "document-1" }]);
      }
      if (sql.includes("INSERT INTO flowdesk.document_chunks")) {
        state.chunks.push(String(params[6]).slice(1, -1).split(",").map(Number));
        return result([]);
      }
      if (sql.includes("SET status = 'active'")) {
        state.sourceStatus = "active";
        return result([]);
      }
      if (sql.includes("UPDATE flowdesk.knowledge_ingestion_jobs")) {
        state.jobStatus = params[1] as string;
        return result([]);
      }
      return result([]);
    }
  } as unknown as DbClient;
  return { db, state };
}

function result(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
}

describe("knowledge ingestion worker", () => {
  it("atomically creates 1536d chunks and marks the source ready", async () => {
    const { db, state } = createMockDb();

    expect(
      await processKnowledgeIngestionBatch(db, { embeddingProvider: new FakeEmbeddingProvider() })
    ).toBe(1);

    expect(state.jobStatus).toBe("completed");
    expect(state.sourceStatus).toBe("active");
    expect(state.documents).toBe(1);
    expect(state.chunks).toHaveLength(1);
    expect(state.chunks[0]).toHaveLength(1536);
  });

  it("requeues retryable provider failures without creating orphan documents", async () => {
    const { db, state } = createMockDb();
    const unavailableProvider: AiEmbeddingProvider = {
      name: "unavailable",
      dimensions: 1536,
      checkHealth: async () => {
        await Promise.resolve();
        return { status: "unavailable", checkedAt: new Date().toISOString() };
      },
      generateEmbeddings: async () => {
        await Promise.resolve();
        throw new AiProviderError("AI_PROVIDER_RATE_LIMITED", { retryable: true });
      }
    };

    await processKnowledgeIngestionBatch(db, { embeddingProvider: unavailableProvider });

    expect(state.jobStatus).toBe("queued");
    expect(state.sourceStatus).toBe("pending");
    expect(state.documents).toBe(0);
    expect(state.chunks).toHaveLength(0);
  });

  it("marks permanent provider responses failed without orphan chunks", async () => {
    const { db, state } = createMockDb();
    const invalidProvider: AiEmbeddingProvider = {
      name: "invalid",
      dimensions: 1536,
      checkHealth: async () => {
        await Promise.resolve();
        return { status: "unavailable", checkedAt: new Date().toISOString() };
      },
      generateEmbeddings: async () => {
        await Promise.resolve();
        throw new AiProviderError("AI_PROVIDER_INVALID_RESPONSE");
      }
    };

    await processKnowledgeIngestionBatch(db, { embeddingProvider: invalidProvider });

    expect(state.jobStatus).toBe("failed");
    expect(state.sourceStatus).toBe("failed");
    expect(state.documents).toBe(0);
    expect(state.chunks).toHaveLength(0);
  });
});
