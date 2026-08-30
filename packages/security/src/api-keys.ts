import { randomBytes, timingSafeEqual } from "node:crypto";
import { computeSha256 } from "./signature.js";

export interface GeneratedApiKey {
  rawKey: string;
  keyPrefix: string;
  keyHash: string;
}

export function generateApiKey(prefix = "fd_live_"): GeneratedApiKey {
  const secretPart = randomBytes(24).toString("hex");
  const rawKey = `${prefix}${secretPart}`;
  const keyPrefix = prefix;
  const keyHash = computeSha256(rawKey);

  return {
    rawKey,
    keyPrefix,
    keyHash
  };
}

export function hashApiKey(rawKey: string): string {
  return computeSha256(rawKey);
}

export function verifyApiKeyHash(rawKey: string, storedHash: string): boolean {
  const hash = computeSha256(rawKey);
  const hashBuf = Buffer.from(hash, "utf8");
  const storedBuf = Buffer.from(storedHash, "utf8");

  if (hashBuf.length !== storedBuf.length) {
    return false;
  }

  return timingSafeEqual(hashBuf, storedBuf);
}

export function hasRequiredScope(keyScopes: string[], requiredScope: string): boolean {
  if (keyScopes.includes("*") || keyScopes.includes("admin")) {
    return true;
  }
  return keyScopes.includes(requiredScope);
}
