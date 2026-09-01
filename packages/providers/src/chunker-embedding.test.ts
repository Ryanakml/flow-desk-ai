import { describe, it, expect, vi } from "vitest";
import { chunkText } from "./chunker.js";
import {
  FakeEmbeddingProvider,
  GeminiEmbeddingProvider,
  OpenAiEmbeddingProvider
} from "./embedding.js";
import { AiProviderError } from "./ai-error.js";

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

    it("rejects a response whose embedding dimension does not match the vector index", async () => {
      const provider = new OpenAiEmbeddingProvider({
        apiKey: "test-openai-key-not-a-secret",
        customFetcher: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2], index: 0 }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        )
      });

      await expect(provider.generateEmbeddings(["FlowDesk documentation"])).rejects.toMatchObject({
        code: "AI_PROVIDER_INVALID_RESPONSE"
      } satisfies Partial<AiProviderError>);
    });

    it("rejects missing and duplicate indexes as an invalid response", async () => {
      const mockEmbedding = new Array<number>(1536).fill(0.01);
      const provider = new OpenAiEmbeddingProvider({
        apiKey: "test-openai-key-not-a-secret",
        customFetcher: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              data: [
                { embedding: mockEmbedding, index: 0 },
                { embedding: mockEmbedding, index: 0 }
              ]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        )
      });

      await expect(provider.generateEmbeddings(["first", "second"])).rejects.toMatchObject({
        code: "AI_PROVIDER_INVALID_RESPONSE"
      } satisfies Partial<AiProviderError>);
    });
  });

  describe("GeminiEmbeddingProvider", () => {
    it("requests and validates single Gemini embedding with real response shape", async () => {
      const mock1536Embedding = new Array<number>(1536).fill(0.02);
      const customFetcher = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            embedding: { values: mock1536Embedding }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
      const provider = new GeminiEmbeddingProvider({
        apiKey: "test-gemini-key-not-a-secret",
        customFetcher,
        model: "gemini-embedding-001"
      });

      const results = await provider.generateEmbeddings(["single document"]);

      expect(results).toHaveLength(1);
      expect(results[0]?.embedding).toHaveLength(1536);
      expect(results[0]?.embedding).toEqual(mock1536Embedding);
      expect(results[0]?.tokenCount).toBe(Math.ceil("single document".length / 4));

      const [url, init] = customFetcher.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent"
      );
      expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(
        "test-gemini-key-not-a-secret"
      );
      const requestBody = JSON.parse(init.body as string) as {
        content: { parts: Array<{ text: string }> };
        outputDimensionality: number;
      };
      expect(requestBody).toEqual({
        content: { parts: [{ text: "single document" }] },
        outputDimensionality: 1536
      });
    });

    it("requests and validates 1536d Gemini batch embeddings", async () => {
      const mock1536Embedding = new Array<number>(1536).fill(0.01);
      const customFetcher = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            embeddings: [{ values: mock1536Embedding }, { values: mock1536Embedding }]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
      const provider = new GeminiEmbeddingProvider({
        apiKey: "test-gemini-key-not-a-secret",
        customFetcher,
        model: "text-embedding-004"
      });

      const results = await provider.generateEmbeddings(["first document", "second document"]);

      expect(results).toHaveLength(2);
      expect(results[0]?.embedding).toHaveLength(1536);
      expect(results[0]?.embedding).toEqual(mock1536Embedding);
      const [url, init] = customFetcher.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents"
      );
      expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(
        "test-gemini-key-not-a-secret"
      );
      const requestBody = JSON.parse(init.body as string) as {
        requests: Array<{
          model: string;
          outputDimensionality: number;
        }>;
      };
      expect(requestBody.requests).toHaveLength(2);
      expect(requestBody.requests[0]).toMatchObject({
        model: "models/text-embedding-004",
        outputDimensionality: 1536
      });
    });

    it("rejects an invalid response with empty embedding values", async () => {
      const provider = new GeminiEmbeddingProvider({
        apiKey: "test-gemini-key-not-a-secret",
        customFetcher: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ embeddings: [{ values: [] }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        )
      });

      await expect(provider.generateEmbeddings(["document"])).rejects.toMatchObject({
        code: "AI_PROVIDER_INVALID_RESPONSE"
      } satisfies Partial<AiProviderError>);
    });

    it("rejects an embedding whose dimension does not match 1536", async () => {
      const provider = new GeminiEmbeddingProvider({
        apiKey: "test-gemini-key-not-a-secret",
        customFetcher: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] } }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        )
      });

      await expect(provider.generateEmbeddings(["document"])).rejects.toMatchObject({
        code: "AI_PROVIDER_INVALID_RESPONSE"
      } satisfies Partial<AiProviderError>);
    });

    it("maps retryable Gemini embedding failures without leaking response bodies", async () => {
      const upstreamSecret = "gemini-embedding-upstream-secret";
      const provider = new GeminiEmbeddingProvider({
        apiKey: "test-gemini-key-not-a-secret",
        customFetcher: vi.fn().mockResolvedValue(new Response(upstreamSecret, { status: 429 }))
      });

      let thrownError: unknown;
      try {
        await provider.generateEmbeddings(["document"]);
      } catch (error) {
        thrownError = error;
      }

      expect(thrownError).toBeInstanceOf(AiProviderError);
      const providerError = thrownError as AiProviderError;
      expect(providerError.code).toBe("AI_PROVIDER_RATE_LIMITED");
      expect(providerError.retryable).toBe(true);
      expect(providerError.message).not.toContain(upstreamSecret);
    });
  });
});
