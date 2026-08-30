import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, verifyApiKeyHash, hasRequiredScope } from "./api-keys.js";

describe("API Keys Security Module (M6-02)", () => {
  it("generates a valid API key with prefix and SHA-256 hash", () => {
    const key = generateApiKey("fd_live_");
    expect(key.rawKey.startsWith("fd_live_")).toBe(true);
    expect(key.keyPrefix).toBe("fd_live_");
    expect(key.keyHash.length).toBe(64);
  });

  it("hashes and verifies API keys correctly in constant time", () => {
    const key = generateApiKey("fd_test_");
    const hash = hashApiKey(key.rawKey);

    expect(hash).toBe(key.keyHash);
    expect(verifyApiKeyHash(key.rawKey, hash)).toBe(true);
    expect(verifyApiKeyHash("fd_test_invalid123", hash)).toBe(false);
  });

  it("checks required scopes accurately", () => {
    expect(hasRequiredScope(["read:conversations", "write:messages"], "read:conversations")).toBe(
      true
    );
    expect(hasRequiredScope(["read:conversations"], "write:messages")).toBe(false);
    expect(hasRequiredScope(["*"], "any:scope")).toBe(true);
    expect(hasRequiredScope(["admin"], "any:scope")).toBe(true);
  });
});
