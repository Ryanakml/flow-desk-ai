import type { HealthCheckedProvider, ProviderHealth } from "./index.js";
import {
  AiProviderError,
  classifyAiProviderHttpError,
  normalizeAiProviderFetchError
} from "./ai-error.js";

export interface AiChatResponse {
  content: string;
  reasoning?: string;
  confidence?: number;
  promptTokens: number;
  completionTokens: number;
}

export interface AiChatProvider extends HealthCheckedProvider {
  generateReplyDraft(systemPrompt: string, userMessage: string): Promise<AiChatResponse>;
}

/**
 * Fake AI Chat Provider returning evidence-backed responses for unit and integration testing.
 */
export class FakeAiChatProvider implements AiChatProvider {
  readonly name = "fake-ai-chat-provider";

  async checkHealth(): Promise<ProviderHealth> {
    await Promise.resolve();
    return { status: "available", checkedAt: new Date().toISOString() };
  }

  async generateReplyDraft(systemPrompt: string, userMessage: string): Promise<AiChatResponse> {
    await Promise.resolve();

    if (systemPrompt.includes("No relevant knowledge base documents found")) {
      return {
        content:
          "Maaf, kami belum memiliki informasi mengenai hal tersebut. Mohon tunggu, staf kami akan segera membantu Anda.",
        reasoning: "No knowledge evidence matched similarity threshold",
        confidence: 0.2,
        promptTokens: 100,
        completionTokens: 25
      };
    }

    return {
      content: `Berdasarkan dokumentasi resmi FlowDesk: ${userMessage.slice(0, 100)} dapat dibantu oleh tim support kami.`,
      reasoning: "Matched customer query with knowledge context",
      confidence: 0.92,
      promptTokens: 250,
      completionTokens: 40
    };
  }
}

export interface OpenAiChatProviderConfig {
  apiKey: string;
  model?: string; // Default gpt-4o-mini
  baseUrl?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  customFetcher?: typeof fetch;
}

/**
 * OpenAI Chat Provider adapter for gpt-4o-mini.
 */
export class OpenAiChatProvider implements AiChatProvider {
  readonly name = "openai-chat-provider";
  readonly modelId: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;
  private readonly fetcher: typeof fetch;

  constructor(config: OpenAiChatProviderConfig) {
    this.apiKey = config.apiKey;
    this.modelId = config.model ?? "gpt-4o-mini";
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.maxOutputTokens = config.maxOutputTokens ?? 512;
    this.fetcher = config.customFetcher ?? fetch;
  }

  async checkHealth(): Promise<ProviderHealth> {
    await Promise.resolve();
    if (!this.apiKey) {
      return { status: "unavailable", checkedAt: new Date().toISOString() };
    }
    return { status: "available", checkedAt: new Date().toISOString() };
  }

  async generateReplyDraft(systemPrompt: string, userMessage: string): Promise<AiChatResponse> {
    if (!this.apiKey) {
      throw new AiProviderError("AI_PROVIDER_CONFIGURATION");
    }

    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.modelId,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage }
          ],
          temperature: 0.2,
          max_tokens: this.maxOutputTokens
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

    if (!body || typeof body !== "object") {
      throw new AiProviderError("AI_PROVIDER_INVALID_RESPONSE");
    }

    const parsed = body as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };

    const rawContent = parsed.choices?.[0]?.message?.content;
    const content = typeof rawContent === "string" ? rawContent.trim() : "";
    if (!content) {
      throw new AiProviderError("AI_PROVIDER_INVALID_RESPONSE");
    }
    const promptTokens =
      typeof parsed.usage?.prompt_tokens === "number" && parsed.usage.prompt_tokens >= 0
        ? parsed.usage.prompt_tokens
        : 0;
    const completionTokens =
      typeof parsed.usage?.completion_tokens === "number" && parsed.usage.completion_tokens >= 0
        ? parsed.usage.completion_tokens
        : 0;

    return {
      content,
      reasoning: "Generated via OpenAI Chat Completions",
      confidence: 0.9,
      promptTokens,
      completionTokens
    };
  }
}

export interface GeminiChatProviderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  customFetcher?: typeof fetch;
}

/**
 * Gemini Generate Content adapter for the stable Gemini Flash API.
 */
export class GeminiChatProvider implements AiChatProvider {
  readonly name = "gemini-chat-provider";
  readonly modelId: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;
  private readonly fetcher: typeof fetch;

  constructor(config: GeminiChatProviderConfig) {
    this.apiKey = config.apiKey;
    this.modelId = config.model ?? "gemini-3.7-flash";
    this.baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(
      /\/$/,
      ""
    );
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.maxOutputTokens = config.maxOutputTokens ?? 512;
    this.fetcher = config.customFetcher ?? fetch;
  }

  async checkHealth(): Promise<ProviderHealth> {
    await Promise.resolve();
    return {
      status: this.apiKey ? "available" : "unavailable",
      checkedAt: new Date().toISOString()
    };
  }

  async generateReplyDraft(systemPrompt: string, userMessage: string): Promise<AiChatResponse> {
    if (!this.apiKey) {
      throw new AiProviderError("AI_PROVIDER_CONFIGURATION");
    }

    let response: Response;
    try {
      response = await this.fetcher(
        `${this.baseUrl}/models/${encodeURIComponent(this.modelId)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userMessage }] }],
            generationConfig: {
              maxOutputTokens: this.maxOutputTokens
            }
          }),
          signal: AbortSignal.timeout(this.timeoutMs)
        }
      );
    } catch (error) {
      throw normalizeAiProviderFetchError(error);
    }

    if (!response.ok) {
      let responseBody: string | undefined;
      try {
        responseBody = await response.text();
      } catch {
        // ignore
      }
      throw classifyAiProviderHttpError(response.status, responseBody);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new AiProviderError("AI_PROVIDER_INVALID_RESPONSE", {
        cause: error,
        httpStatus: response.status
      });
    }

    if (!body || typeof body !== "object") {
      throw new AiProviderError("AI_PROVIDER_INVALID_RESPONSE", {
        httpStatus: response.status
      });
    }

    const parsed = body as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: unknown; thought?: unknown }> };
      }>;
      usageMetadata?: {
        promptTokenCount?: unknown;
        candidatesTokenCount?: unknown;
        thoughtsTokenCount?: unknown;
      };
    };
    const content =
      parsed.candidates?.[0]?.content?.parts
        ?.filter((part) => part.thought !== true && typeof part.text === "string")
        .map((part) => part.text as string)
        .join("")
        .trim() ?? "";
    if (!content) {
      throw new AiProviderError("AI_PROVIDER_INVALID_RESPONSE");
    }

    const promptTokens =
      typeof parsed.usageMetadata?.promptTokenCount === "number" &&
      parsed.usageMetadata.promptTokenCount >= 0
        ? parsed.usageMetadata.promptTokenCount
        : 0;
    const candidateTokens =
      typeof parsed.usageMetadata?.candidatesTokenCount === "number" &&
      parsed.usageMetadata.candidatesTokenCount >= 0
        ? parsed.usageMetadata.candidatesTokenCount
        : 0;
    const thoughtTokens =
      typeof parsed.usageMetadata?.thoughtsTokenCount === "number" &&
      parsed.usageMetadata.thoughtsTokenCount >= 0
        ? parsed.usageMetadata.thoughtsTokenCount
        : 0;

    return {
      content,
      reasoning: "Generated via Gemini Generate Content",
      confidence: 0.9,
      promptTokens,
      completionTokens: candidateTokens + thoughtTokens
    };
  }
}
