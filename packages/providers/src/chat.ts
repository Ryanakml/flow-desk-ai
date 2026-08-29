import type { HealthCheckedProvider, ProviderHealth } from "./index.js";

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
  customFetcher?: typeof fetch;
}

/**
 * OpenAI Chat Provider adapter for gpt-4o-mini.
 */
export class OpenAiChatProvider implements AiChatProvider {
  readonly name = "openai-chat-provider";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(config: OpenAiChatProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "gpt-4o-mini";
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

  async generateReplyDraft(systemPrompt: string, userMessage: string): Promise<AiChatResponse> {
    if (!this.apiKey) {
      throw new Error("OpenAI API key is not configured for OpenAiChatProvider.");
    }

    const response = await this.fetcher(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI Chat API error (${response.status}): ${errorText || response.statusText}`
      );
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const content = body.choices?.[0]?.message?.content?.trim() || "";
    const promptTokens = body.usage?.prompt_tokens ?? 0;
    const completionTokens = body.usage?.completion_tokens ?? 0;

    return {
      content,
      reasoning: "Generated via OpenAI Chat Completions",
      confidence: 0.9,
      promptTokens,
      completionTokens
    };
  }
}
