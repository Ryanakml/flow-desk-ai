const sensitiveKeys = /authorization|cookie|password|secret|token/i;
export {
  createOpaqueToken,
  hashSessionToken,
  sameSessionToken,
  serializeSessionCookie,
  serializeExpiredSessionCookie,
  parseSessionCookie,
  SESSION_COOKIE_NAME
} from "./session.js";
export {
  createOidcAuthorizationRequest,
  hashOidcSecret,
  type OidcAuthorizationRequest
} from "./oidc.js";
export { getSecurityHeaders, type SecurityHeadersOptions } from "./headers.js";
export {
  createSlidingWindowRateLimiter,
  type RateLimitOptions,
  type RateLimitResult,
  type RateLimiter
} from "./rate-limit.js";
export { encryptSecret, decryptSecret, type EncryptedEnvelope } from "./encryption.js";
export { computeMetaSignature, verifyMetaSignature, computeSha256 } from "./signature.js";
export {
  SsrfProtectionError,
  isPrivateIpAddress,
  isBlockedHostname,
  validateUrlForIngestion,
  fetchWithAntiSsrf,
  type AntiSsrfFetchOptions,
  type AntiSsrfFetchResult
} from "./ssrf.js";
export {
  setGlobalKillswitch,
  getGlobalKillswitch,
  isAutoSendKillswitchActive,
  type KillswitchState
} from "./killswitch.js";
// M4-07: AI Safety Guardrails
export {
  checkPromptInjection,
  validateSystemPromptSafety,
  redactPiiFromPrompt,
  checkTokenBudget,
  LlmCircuitBreaker,
  DEFAULT_TOKEN_BUDGET,
  type InjectionCheckResult,
  type PiiRedactionResult,
  type TokenBudgetOptions,
  type BudgetCheckResult,
  type CircuitState,
  type CircuitBreakerOptions
} from "./ai-safety.js";

export function redactRecord(input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      sensitiveKeys.test(key) ? "[REDACTED]" : value
    ])
  );
}
