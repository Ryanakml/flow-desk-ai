/**
 * M4-07: AI Safety Guardrails
 *
 * Provides:
 * - Prompt injection detection and sanitization
 * - PII redaction on LLM prompts
 * - LLM token budget enforcement
 * - Circuit breaker for provider outage
 */

// ── Prompt Injection Filter ────────────────────────────────────────────────────

/**
 * Known prompt injection patterns — adversarial attempts to override system instructions
 * or exfiltrate the system prompt.
 */
const INJECTION_PATTERNS: RegExp[] = [
  // Direct instruction overrides
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|prompts?|constraints?)/i,
  /forget\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|prompts?)/i,
  /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?|prompts?)/i,
  /override\s+(all\s+)?(previous|prior|above)\s+(instructions?|system\s+prompt)/i,
  // System prompt exfiltration
  /repeat\s+(your\s+)?(system|initial|original)\s+(prompt|instructions?|rules?)/i,
  /print\s+(your\s+)?(system|initial|original)\s+(prompt|instructions?|rules?)/i,
  /show\s+(me\s+)?(your\s+)?(system|initial|original)\s+(prompt|instructions?|rules?)/i,
  /what\s+(are|is)\s+(your\s+)?(system|initial|original)\s+(prompt|instructions?|secrets?)/i,
  /reveal\s+(your\s+)?(system|initial|original)\s+(prompt|instructions?|secrets?)/i,
  // Role confusion / jailbreak
  /you\s+are\s+now\s+(?:an?\s+)?(?:different|new|another|unrestricted|uncensored|jailbreak)/i,
  /act\s+as\s+(?:an?\s+)?(?:different|new|another|unrestricted|uncensored|dan|jailbreak|evil|ai\s+without)/i,
  /pretend\s+(you\s+are|to\s+be)\s+(?:an?\s+)?(?:different|unrestricted|uncensored|evil)/i,
  /\[SYSTEM\]/i,
  /\[\s*new\s+instructions?\s*\]/i,
  /\[\s*overriding\s+instructions?\s*\]/i,
  // Delimiter injection
  /---+\s*(END|STOP|NEW)\s+(PROMPT|SYSTEM|INSTRUCTION)/i,
  /#+\s*(END|STOP|NEW)\s+(PROMPT|SYSTEM|INSTRUCTION)/i,
  // Output manipulation
  /respond\s+only\s+(in|with)\s+(json|xml|code|markdown)\s+and\s+ignore/i
];

export interface InjectionCheckResult {
  safe: boolean;
  matched?: string;
  sanitized: string;
}

/**
 * Checks a user-provided text for known prompt injection patterns.
 * Returns whether the text is safe and a sanitized version.
 *
 * The sanitized version replaces injected content with a safe placeholder
 * so the rest of the message can still be processed.
 */
export function checkPromptInjection(text: string): InjectionCheckResult {
  let sanitized = text;
  let matched: string | undefined;

  for (const pattern of INJECTION_PATTERNS) {
    const match = sanitized.match(pattern);
    if (match) {
      matched = match[0];
      // Replace the injected phrase with a safe marker
      sanitized = sanitized.replace(
        pattern,
        "[INJECTED_CONTENT_REMOVED — customer message contained restricted phrases]"
      );
    }
  }

  if (matched !== undefined) {
    return {
      safe: false,
      matched,
      sanitized
    };
  }

  return {
    safe: true,
    sanitized
  };
}

/**
 * Validates that a bot configuration `instructions` field does not itself
 * contain injection-like content (defence-in-depth for admin inputs).
 */
export function validateSystemPromptSafety(instructions: string): boolean {
  // System prompts should not reference "ignore instructions" patterns themselves
  return INJECTION_PATTERNS.every((p) => !p.test(instructions));
}

// ── PII Redaction ──────────────────────────────────────────────────────────────

/**
 * PII patterns to redact from LLM prompts before sending to external APIs.
 */
const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  {
    name: "indonesian_nik",
    // Indonesian National Identity Number: 16 digits
    pattern: /\b[1-9]\d{15}\b/g,
    replacement: "[NIK_REDACTED]"
  },
  {
    name: "email",
    pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
    replacement: "[EMAIL_REDACTED]"
  },
  {
    name: "indonesian_phone",
    // Indonesian phone: +62xxxxxxxx or 0xxxxxxxx (8-12 trailing digits)
    pattern: /(?:\+62|0)[2-9]\d{7,11}\b/g,
    replacement: "[PHONE_REDACTED]"
  },
  {
    name: "credit_card",
    // Visa/Mastercard/Amex pattern (simplified)
    pattern: /\b(?:\d[ -]?){13,16}\b/g,
    replacement: "[CARD_REDACTED]"
  },
  {
    name: "indonesian_ktp",
    // KTP-like 16 digit preceded by KTP/NIK label
    pattern: /(?:nik|ktp|no\.?\s*ktp)\s*:?\s*\d{16}/gi,
    replacement: "[KTP_REDACTED]"
  }
];

export interface PiiRedactionResult {
  redacted: string;
  piiFound: string[];
}

/**
 * Redacts known PII patterns from text before it is sent to external LLM APIs.
 * Returns the redacted text and a list of PII type names that were found.
 */
export function redactPiiFromPrompt(text: string): PiiRedactionResult {
  let redacted = text;
  const piiFound: string[] = [];

  for (const { name, pattern, replacement } of PII_PATTERNS) {
    if (pattern.test(redacted)) {
      piiFound.push(name);
    }
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, replacement);
    pattern.lastIndex = 0;
  }

  return { redacted, piiFound };
}

// ── Token Budget Enforcement ───────────────────────────────────────────────────

export interface TokenBudgetOptions {
  /** Hard maximum tokens allowed per prompt (system + user combined). Default: 4000 */
  maxPromptTokens?: number;
  /** Hard maximum tokens allowed in the completion. Default: 500 */
  maxCompletionTokens?: number;
  /** Maximum USD cost per run in microcents (1 USD = 100_000_000 microcents). Default: $0.02 */
  maxCostMicrocents?: number;
}

export const DEFAULT_TOKEN_BUDGET: Required<TokenBudgetOptions> = {
  maxPromptTokens: 4000,
  maxCompletionTokens: 500,
  maxCostMicrocents: 2_000_000 // $0.02
};

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  estimatedTokens: number;
}

/**
 * Validates a prompt against token budget constraints before calling the LLM.
 * Uses a 4-chars-per-token heuristic for estimation.
 */
export function checkTokenBudget(
  systemPrompt: string,
  userMessage: string,
  options: TokenBudgetOptions = {}
): BudgetCheckResult {
  const opts = { ...DEFAULT_TOKEN_BUDGET, ...options };
  // ~4 chars per token heuristic
  const estimatedTokens = Math.ceil((systemPrompt.length + userMessage.length) / 4);

  if (estimatedTokens > opts.maxPromptTokens) {
    return {
      allowed: false,
      reason: `Estimated prompt tokens (${estimatedTokens}) exceed maximum budget (${opts.maxPromptTokens})`,
      estimatedTokens
    };
  }

  return { allowed: true, estimatedTokens };
}

// ── Circuit Breaker ────────────────────────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 3 */
  failureThreshold?: number;
  /** Milliseconds the circuit stays open before moving to half-open. Default: 30_000 (30s) */
  recoveryTimeMs?: number;
  /** Name for logging purposes */
  name?: string;
}

/**
 * Simple in-process circuit breaker for LLM provider calls.
 *
 * States:
 * - `closed`   — normal operation, calls are allowed
 * - `open`     — too many failures, calls are blocked immediately
 * - `half-open` — one test call is allowed to probe recovery
 */
export class LlmCircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private openedAt: number | null = null;
  private readonly failureThreshold: number;
  private readonly recoveryTimeMs: number;
  readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.recoveryTimeMs = options.recoveryTimeMs ?? 30_000;
    this.name = options.name ?? "llm-circuit-breaker";
  }

  /** Returns whether a call is currently permitted. */
  isCallPermitted(): boolean {
    if (this.state === "closed") return true;
    if (this.state === "open") {
      // Check if recovery window has elapsed
      if (this.openedAt !== null && Date.now() - this.openedAt >= this.recoveryTimeMs) {
        this.state = "half-open";
        return true;
      }
      return false;
    }
    // half-open: allow one probe call
    return true;
  }

  /** Records a successful call, resetting failure count. */
  recordSuccess(): void {
    this.state = "closed";
    this.failures = 0;
    this.openedAt = null;
  }

  /** Records a failed call, potentially tripping the circuit. */
  recordFailure(): void {
    this.failures += 1;
    if (this.state === "half-open" || this.failures >= this.failureThreshold) {
      this.state = "open";
      this.openedAt = Date.now();
    }
  }

  /** Returns the current circuit state. */
  getState(): CircuitState {
    return this.state;
  }

  /** Returns the current consecutive failure count. */
  getFailureCount(): number {
    return this.failures;
  }

  /**
   * Wraps an async LLM call with circuit breaker protection.
   * Throws if the circuit is open or if the underlying call fails.
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.isCallPermitted()) {
      throw new Error(
        `[${this.name}] Circuit is OPEN — LLM provider is temporarily unavailable. Retry after ${this.recoveryTimeMs / 1000}s.`
      );
    }
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }
}
