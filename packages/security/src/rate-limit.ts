export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export interface RateLimiter {
  consume(key: string): RateLimitResult;
  reset(): void;
}

export function createSlidingWindowRateLimiter(options: RateLimitOptions): RateLimiter {
  const windowMs = options.windowMs;
  const max = options.max;
  const hits = new Map<string, number[]>();

  return {
    consume(key: string): RateLimitResult {
      const now = Date.now();
      const cutoff = now - windowMs;
      const timestamps = (hits.get(key) ?? []).filter((t) => t > cutoff);

      if (timestamps.length >= max) {
        const oldest = timestamps[0] ?? now;
        const resetSeconds = Math.ceil((oldest + windowMs - now) / 1000);
        return {
          allowed: false,
          limit: max,
          remaining: 0,
          resetSeconds: Math.max(resetSeconds, 1)
        };
      }

      timestamps.push(now);
      hits.set(key, timestamps);

      const oldest = timestamps[0] ?? now;
      const resetSeconds = Math.ceil((oldest + windowMs - now) / 1000);

      return {
        allowed: true,
        limit: max,
        remaining: Math.max(max - timestamps.length, 0),
        resetSeconds: Math.max(resetSeconds, 1)
      };
    },
    reset() {
      hits.clear();
    }
  };
}
