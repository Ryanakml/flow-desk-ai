import { createHash } from "node:crypto";
import type { HealthCheckedProvider, ProviderHealth } from "./index.js";
import {
  AiProviderError,
  classifyAiProviderHttpError,
  normalizeAiProviderFetchError
} from "./ai-error.js";

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
  timeoutMs?: number;
  customFetcher?: typeof fetch;
}

/**
 * OpenAI AI Embedding Provider adapter for text-embedding-3-small (1536d).
 */
export class OpenAiEmbeddingProvider implements AiEmbeddingProvider {
  readonly name = "openai-embedding-provider";
  readonly dimensions = 1536;
  readonly modelId: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(config: OpenAiEmbeddingProviderConfig) {
    this.apiKey = config.apiKey;
    this.modelId = config.model ?? "text-embedding-3-small";
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs ?? 15_000;
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
      throw new AiProviderError("AI_PROVIDER_CONFIGURATION");
    }

    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.modelId,
          input: texts,
          dimensions: this.dimensions
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw normalizeAiProviderFetchError(error);
    }

    if (!response.ok) {
      throw classifyAiProviderHttpError(response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new AiProviderError("AI_PROVIDER_INVALID_RESPONSE", { cause: error });
    }

    const parsed = body as {
      data?: Array<{ embedding?: unknown; index?: unknown }>;
      usage?: { total_tokens?: number };
    };

    if (!Array.isArray(parsed.data) || parsed.data.length !== texts.length) {
      throw new AiProviderError("AI_PROVIDER_INVALID_RESPONSE");
    }

    // Sort by original input index
    const sorted = [...parsed.data].sort(
      (a, b) =>
        (typeof a.index === "number" ? a.index : -1) - (typeof b.index === "number" ? b.index : -1)
    );

    return sorted.map((item, idx) => {
      if (
        item.index !== idx ||
        !Array.isArray(item.embedding) ||
        item.embedding.length !== this.dimensions ||
        item.embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))
      ) {
        throw new AiProviderError("AI_PROVIDER_INVALID_RESPONSE");
      }
      return {
        embedding: item.embedding as number[],
        tokenCount: Math.ceil((texts[idx] || "").length / 4)
      };
    });
  }
}

export interface GeminiEmbeddingProviderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  customFetcher?: typeof fetch;
}

/**
 * Gemini batch embedding adapter using a 1536d projection compatible with the existing pgvector
 * index.
 */
export class GeminiEmbeddingProvider implements AiEmbeddingProvider {
  readonly name = "gemini-embedding-provider";
  readonly dimensions = 1536;
  readonly modelId: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(config: GeminiEmbeddingProviderConfig) {
    this.apiKey = config.apiKey;
    this.modelId = config.model ?? "text-embedding-004";
    this.baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(
      /\/$/,
      ""
    );
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.fetcher = config.customFetcher ?? fetch;
  }

  async checkHealth(): Promise<ProviderHealth> {
    await Promise.resolve();
    return {
      status: this.apiKey ? "available" : "unavailable",
      checkedAt: new Date().toISOString()
    };
  }

  async generateEmbeddings(texts: string[]): Promise<GeneratedEmbedding[]> {
    if (texts.length === 0) return [];
    if (!this.apiKey) {
      throw new AiProviderError("AI_PROVIDER_CONFIGURATION");
    }

    const modelResource = `models/${this.modelId}`;
    let response: Response;
    try {
      response = await this.fetcher(
        `${this.baseUrl}/models/${encodeURIComponent(this.modelId)}:batchEmbedContents`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey
          },
          body: JSON.stringify({
            requests: texts.map((text) => ({
              model: modelResource,
              content: { parts: [{ text }] }
            }))
          }),
          signal: AbortSignal.timeout(this.timeoutMs)
        }
      );
    } catch (error) {
      throw normalizeAiProviderFetchError(error);
    }

    if (!response.ok) {
      throw classifyAiProviderHttpError(response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new AiProviderError("AI_PROVIDER_INVALID_RESPONSE", { cause: error });
    }

    const parsed = body as { embeddings?: Array<{ values?: unknown }> };
    if (!Array.isArray(parsed.embeddings) || parsed.embeddings.length !== texts.length) {
      throw new AiProviderError("AI_PROVIDER_INVALID_RESPONSE");
    }

    return parsed.embeddings.map((item, index) => {
      if (
        !Array.isArray(item.values) ||
        item.values.length === 0 ||
        item.values.some((value) => typeof value !== "number" || !Number.isFinite(value))
      ) {
        throw new AiProviderError("AI_PROVIDER_INVALID_RESPONSE");
      }
      const values = item.values as number[];
      const embedding =
        values.length === this.dimensions
          ? values
          : values.length < this.dimensions
            ? [...values, ...new Array<number>(this.dimensions - values.length).fill(0)]
            : values.slice(0, this.dimensions);

      return {
        embedding,
        tokenCount: Math.ceil((texts[index] ?? "").length / 4)
      };
    });
  }
}
