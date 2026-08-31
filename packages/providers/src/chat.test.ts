import { describe, expect, it, vi } from "vitest";
import { AiProviderError } from "./ai-error.js";
import { OpenAiChatProvider } from "./chat.js";

function providerWithResponse(response: Response) {
  const customFetcher = vi.fn().mockResolvedValue(response);
  return {
    customFetcher,
    provider: new OpenAiChatProvider({
      apiKey: "test-openai-key-not-a-secret",
      customFetcher,
      maxOutputTokens: 321,
      model: "gpt-4o-mini"
    })
  };
}

async function captureProviderError(operation: () => Promise<unknown>): Promise<AiProviderError> {
  try {
    await operation();
    throw new Error("Expected provider operation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(AiProviderError);
    return error as AiProviderError;
  }
}

describe("OpenAiChatProvider", () => {
  it("sends a bounded request and parses content plus token usage", async () => {
    const { customFetcher, provider } = providerWithResponse(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "  Evidence-backed draft  " } }],
          usage: { prompt_tokens: 11, completion_tokens: 7 }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await provider.generateReplyDraft("system rules", "customer question");

    expect(result).toMatchObject({
      content: "Evidence-backed draft",
      promptTokens: 11,
      completionTokens: 7
    });
    const [url, init] = customFetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(typeof init.body).toBe("string");
    const requestBody = JSON.parse(init.body as string) as {
      model: string;
      max_tokens: number;
    };
    expect(requestBody).toMatchObject({ model: "gpt-4o-mini", max_tokens: 321 });
  });

  it.each([
    [401, "AI_PROVIDER_AUTHENTICATION", false],
    [429, "AI_PROVIDER_RATE_LIMITED", true],
    [503, "AI_PROVIDER_UNAVAILABLE", true]
  ] as const)("maps HTTP %s to safe error %s", async (status, code, retryable) => {
    const upstreamSecret = "upstream-body-must-never-leak";
    const { provider } = providerWithResponse(new Response(upstreamSecret, { status }));

    const error = await captureProviderError(() =>
      provider.generateReplyDraft("system rules", "customer question")
    );

    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
    expect(error.message).not.toContain(upstreamSecret);
  });

  it("maps provider timeouts to a retryable safe timeout error", async () => {
    const timeout = Object.assign(new Error("socket details must stay internal"), {
      name: "TimeoutError"
    });
    const provider = new OpenAiChatProvider({
      apiKey: "test-openai-key-not-a-secret",
      customFetcher: vi.fn().mockRejectedValue(timeout)
    });

    const error = await captureProviderError(() =>
      provider.generateReplyDraft("system rules", "customer question")
    );

    expect(error.code).toBe("AI_PROVIDER_TIMEOUT");
    expect(error.retryable).toBe(true);
    expect(error.message).not.toContain("socket details");
  });

  it.each([
    ["malformed JSON", new Response("not-json", { status: 200 })],
    [
      "empty answer",
      new Response(JSON.stringify({ choices: [{ message: { content: "   " } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ]
  ])("rejects %s as an invalid provider response", async (_caseName, response) => {
    const { provider } = providerWithResponse(response);

    const error = await captureProviderError(() =>
      provider.generateReplyDraft("system rules", "customer question")
    );

    expect(error.code).toBe("AI_PROVIDER_INVALID_RESPONSE");
  });
});
