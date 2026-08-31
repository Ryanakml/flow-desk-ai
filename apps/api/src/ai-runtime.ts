import type { AiRuntimeConfig } from "@flowdesk/config";
import {
  FakeAiChatProvider,
  FakeEmbeddingProvider,
  OpenAiChatProvider,
  OpenAiEmbeddingProvider,
  type AiChatProvider,
  type AiEmbeddingProvider
} from "@flowdesk/providers";

export interface AiRuntime {
  providerType: "fake" | "openai";
  chatModel: string;
  embeddingModel: string;
  chatProvider: AiChatProvider;
  embeddingProvider: AiEmbeddingProvider;
}

export function createAiRuntime(config: AiRuntimeConfig): AiRuntime | undefined {
  if (config.AI_PROVIDER === "disabled") return undefined;

  if (config.AI_PROVIDER === "fake") {
    return {
      providerType: "fake",
      chatModel: "fake-ai-chat-provider",
      embeddingModel: "fake-embedding-provider",
      chatProvider: new FakeAiChatProvider(),
      embeddingProvider: new FakeEmbeddingProvider()
    };
  }

  if (!config.OPENAI_API_KEY) {
    throw new Error("Validated OpenAI configuration is missing its credential");
  }

  return {
    providerType: "openai",
    chatModel: config.OPENAI_CHAT_MODEL,
    embeddingModel: config.OPENAI_EMBEDDING_MODEL,
    chatProvider: new OpenAiChatProvider({
      apiKey: config.OPENAI_API_KEY,
      baseUrl: config.OPENAI_BASE_URL,
      model: config.OPENAI_CHAT_MODEL,
      timeoutMs: config.AI_CHAT_TIMEOUT_MS,
      maxOutputTokens: config.AI_MAX_OUTPUT_TOKENS
    }),
    embeddingProvider: new OpenAiEmbeddingProvider({
      apiKey: config.OPENAI_API_KEY,
      baseUrl: config.OPENAI_BASE_URL,
      model: config.OPENAI_EMBEDDING_MODEL,
      timeoutMs: config.AI_EMBEDDING_TIMEOUT_MS
    })
  };
}
