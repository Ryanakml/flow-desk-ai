import { createHash } from "node:crypto";
import type { HealthCheckedProvider, ProviderHealth } from "./index.js";

export interface GeneratedEmbedding {
  embedding: number[];
  tokenCount: number;
}

export interface AiEmbeddingProvider extends HealthCheckedProvider {
  readonly dimensions: number;
  generateEmbeddings(texts: string[]): Promise<GeneratedEmbedding[]>;
}

/**
 * Fake AI Embedding Provider producing deterministic 1536d normalized vectors for testing.
 */
export class FakeEmbeddingProvider implements AiEmbeddingProvider {
  readonly name = "fake-embedding-provider";
  readonly dimensions = 1536;

  async checkHealth(): Promise<ProviderHealth> {
    await Promise.resolve();
    return { status: "available", checkedAt: new Date().toISOString() };
  }

  async generateEmbeddings(texts: string[]): Promise<GeneratedEmbedding[]> {
    await Promise.resolve();
    return texts.map((text) => {
      const hash = createHash("sha256").update(text, "utf-8").digest();
      const rawVector: number[] = new Array<number>(this.dimensions);

      // Deterministically populate 1536 dimensions from hash seed
      for (let i = 0; i < this.dimensions; i++) {
        const seedByte = hash[i % hash.length]!;
        rawVector[i] = Math.sin(seedByte + i);
      }

      // L2 Normalize vector so ||v|| = 1 for cosine distance operations
      const norm = Math.sqrt(rawVector.reduce((sum, val) => sum + val * val, 0)) || 1;
      const normalizedVector = rawVector.map((val) => Number((val / norm).toFixed(6)));

      const tokenCount = Math.ceil(text.length / 4);
      return {
        embedding: normalizedVector,
        tokenCount
      };
    });
  }
}

export interface OpenAiEmbeddingProviderConfig {
  apiKey: string;
  model?: string; // Default text-embedding-3-small
  baseUrl?: string;
  customFetcher?: typeof fetch;
}

/**
 * OpenAI AI Embedding Provider adapter for text-embedding-3-small (1536d).
 */
export class OpenAiEmbeddingProvider implements AiEmbeddingProvider {
  readonly name = "openai-embedding-provider";
  readonly dimensions = 1536;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(config: OpenAiEmbeddingProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "text-embedding-3-small";
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.fetcher = config.customFetcher ?? fetch;
  }

  async checkHealth(): Promise<ProviderHealth> {
    await Promise.resolve();
    if (!this.apiKey) {
      return { status: "unavailable", checkedAt: new Date().toISOString() };
    }
    return { status: "available", checkedAt: new Date().toISOString() };
  }

  async generateEmbeddings(texts: string[]): Promise<GeneratedEmbedding[]> {
    if (texts.length === 0) return [];
    if (!this.apiKey) {
      throw new Error("OpenAI API key is not configured for OpenAiEmbeddingProvider.");
    }

    const response = await this.fetcher(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI Embedding API error (${response.status}): ${errorText || response.statusText}`
      );
    }

    const body = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
      usage?: { total_tokens?: number };
    };

    if (!body.data || !Array.isArray(body.data)) {
      throw new Error("Invalid response schema returned by OpenAI Embedding API.");
    }

    // Sort by original input index
    const sorted = [...body.data].sort((a, b) => a.index - b.index);

    return sorted.map((item, idx) => ({
      embedding: item.embedding,
      tokenCount: Math.ceil((texts[idx] || "").length / 4)
    }));
  }
}
