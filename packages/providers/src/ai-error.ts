export type AiProviderErrorCode =
  | "AI_PROVIDER_CONFIGURATION"
  | "AI_PROVIDER_AUTHENTICATION"
  | "AI_PROVIDER_RATE_LIMITED"
  | "AI_PROVIDER_TIMEOUT"
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_PROVIDER_INVALID_RESPONSE";

const SAFE_MESSAGES: Record<AiProviderErrorCode, string> = {
  AI_PROVIDER_CONFIGURATION: "AI provider configuration is unavailable.",
  AI_PROVIDER_AUTHENTICATION: "AI provider authentication failed.",
  AI_PROVIDER_RATE_LIMITED: "AI provider is temporarily rate limited.",
  AI_PROVIDER_TIMEOUT: "AI provider request timed out.",
  AI_PROVIDER_UNAVAILABLE: "AI provider is temporarily unavailable.",
  AI_PROVIDER_INVALID_RESPONSE: "AI provider returned an invalid response."
};

export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode;
  readonly retryable: boolean;
  httpStatus?: number | undefined;
  httpBody?: string | undefined;

  constructor(
    code: AiProviderErrorCode,
    options?: {
      cause?: unknown;
      retryable?: boolean | undefined;
      httpStatus?: number | undefined;
      httpBody?: string | undefined;
    }
  ) {
    super(SAFE_MESSAGES[code], options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AiProviderError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.httpStatus = options?.httpStatus;
    this.httpBody = options?.httpBody;
  }
}

export function classifyAiProviderHttpError(
  status: number,
  responseBody?: string
): AiProviderError {
  if (status === 401 || status === 403) {
    return new AiProviderError("AI_PROVIDER_AUTHENTICATION", {
      httpStatus: status,
      httpBody: responseBody
    });
  }
  if (status === 429) {
    return new AiProviderError("AI_PROVIDER_RATE_LIMITED", {
      retryable: true,
      httpStatus: status,
      httpBody: responseBody
    });
  }
  if (status >= 500) {
    return new AiProviderError("AI_PROVIDER_UNAVAILABLE", {
      retryable: true,
      httpStatus: status,
      httpBody: responseBody
    });
  }
  return new AiProviderError("AI_PROVIDER_INVALID_RESPONSE", {
    httpStatus: status,
    httpBody: responseBody
  });
}

export function normalizeAiProviderFetchError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (
    (error instanceof DOMException && error.name === "TimeoutError") ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
  ) {
    return new AiProviderError("AI_PROVIDER_TIMEOUT", { cause: error, retryable: true });
  }
  return new AiProviderError("AI_PROVIDER_UNAVAILABLE", { cause: error, retryable: true });
}
