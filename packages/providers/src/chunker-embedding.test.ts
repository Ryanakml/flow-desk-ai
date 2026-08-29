import { describe, it, expect, vi } from "vitest";
import { chunkText } from "./chunker.js";
import { FakeEmbeddingProvider, OpenAiEmbeddingProvider } from "./embedding.js";

describe("Document Chunker & Embedding Providers", () => {
  describe("chunkText", () => {
    it("chunks text into token-bounded blocks with unique content hashes", () => {
      const sampleText = `Paragraph 1: Welcome to FlowDesk support.
      
Paragraph 2: FlowDesk is a multi-tenant messaging SaaS platform.

Paragraph 3: All tenant data is isolated via Row-Level Security.`;

      const chunks = chunkText(sampleText, { maxChunkTokens: 20, overlapTokens: 5 });

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]?.chunkIndex).toBe(0);
      expect(chunks[0]?.contentHash).toHaveLength(64); // SHA-256 hex string
      expect(typeof chunks[0]?.tokenCount).toBe("number");
    });

    it("returns empty array for empty input", () => {
      expect(chunkText("")).toEqual([]);
      expect(chunkText("   \n\n   ")).toEqual([]);
    });
  });

  describe("FakeEmbeddingProvider", () => {
    it("generates 1536-dimensional normalized vectors deterministically", async () => {
      const provider = new FakeEmbeddingProvider();
      const results = await provider.generateEmbeddings([
        "FlowDesk SLA Policy",
        "WhatsApp Business API Integration"
      ]);

      expect(results).toHaveLength(2);
      expect(results[0]?.embedding).toHaveLength(1536);

      // Verify L2 norm is approximately 1.0
      const norm = Math.sqrt(results[0]!.embedding.reduce((sum, val) => sum + val * val, 0));
      expect(norm).toBeCloseTo(1.0, 2);

      // Verify deterministic output for same text
      const reRun = await provider.generateEmbeddings(["FlowDesk SLA Policy"]);
      expect(reRun[0]?.embedding).toEqual(results[0]?.embedding);
    });
  });

  describe("OpenAiEmbeddingProvider", () => {
    it("formats OpenAI request payload and parses 1536d response", async () => {
      const mockEmbedding = new Array<number>(1536).fill(0.01);
      const mockFetcher = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ embedding: mockEmbedding, index: 0 }],
            usage: { total_tokens: 15 }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const provider = new OpenAiEmbeddingProvider({
        apiKey: "sk-test-key",
        customFetcher: mockFetcher
      });

      const results = await provider.generateEmbeddings(["FlowDesk documentation"]);

      expect(results).toHaveLength(1);
      expect(results[0]?.embedding).toHaveLength(1536);
      expect(mockFetcher).toHaveBeenCalledTimes(1);

      const [calledUrl, calledInit] = mockFetcher.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toBe("https://api.openai.com/v1/embeddings");
      expect(calledInit.method).toBe("POST");
      expect((calledInit.headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer sk-test-key"
      );
    });
  });
});
