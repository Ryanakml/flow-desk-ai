import { describe, expect, it } from "vitest";
import { createSlidingWindowRateLimiter } from "./rate-limit.js";

describe("Sliding Window Rate Limiter (M1-08)", () => {
  it("permits requests within quota and reports remaining", () => {
    const limiter = createSlidingWindowRateLimiter({ windowMs: 1000, max: 3 });
    const r1 = limiter.consume("user-1");
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);
    expect(r1.limit).toBe(3);

    const r2 = limiter.consume("user-1");
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = limiter.consume("user-1");
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    // 4th request exceeds quota
    const r4 = limiter.consume("user-1");
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.resetSeconds).toBeGreaterThanOrEqual(1);
  });

  it("isolates different rate limit keys", () => {
    const limiter = createSlidingWindowRateLimiter({ windowMs: 1000, max: 1 });
    const r1 = limiter.consume("key-a");
    expect(r1.allowed).toBe(true);

    const r2 = limiter.consume("key-b");
    expect(r2.allowed).toBe(true);

    const r3 = limiter.consume("key-a");
    expect(r3.allowed).toBe(false);
  });

  it("resets correctly", () => {
    const limiter = createSlidingWindowRateLimiter({ windowMs: 1000, max: 1 });
    limiter.consume("key-1");
    expect(limiter.consume("key-1").allowed).toBe(false);

    limiter.reset();
    expect(limiter.consume("key-1").allowed).toBe(true);
  });
});
