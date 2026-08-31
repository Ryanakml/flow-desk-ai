import { describe, expect, it } from "vitest";
import { loadAiRuntimeConfig } from "@flowdesk/config";
import { createAiRuntime } from "./ai-runtime.js";

describe("createAiRuntime", () => {
  it("keeps AI unavailable when the safe disabled mode is selected", () => {
    expect(createAiRuntime(loadAiRuntimeConfig({ AI_PROVIDER: "disabled" }))).toBeUndefined();
  });

  it("requires explicit local selection before constructing fake providers", () => {
    const runtime = createAiRuntime(loadAiRuntimeConfig({ APP_ENV: "local", AI_PROVIDER: "fake" }));
    expect(runtime).toMatchObject({
      providerType: "fake",
      chatModel: "fake-ai-chat-provider",
      embeddingModel: "fake-embedding-provider"
    });
  });

  it("constructs the real OpenAI chat and embedding runtime from validated config", () => {
    const runtime = createAiRuntime(
      loadAiRuntimeConfig({
        APP_ENV: "staging",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-test-key-with-safe-length",
        OPENAI_CHAT_MODEL: "gpt-4o-mini",
        OPENAI_EMBEDDING_MODEL: "text-embedding-3-small"
      })
    );
    expect(runtime).toMatchObject({
      providerType: "openai",
      chatModel: "gpt-4o-mini",
      embeddingModel: "text-embedding-3-small"
    });
    expect(runtime?.chatProvider.name).toBe("openai-chat-provider");
    expect(runtime?.embeddingProvider.name).toBe("openai-embedding-provider");
  });
});
