import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

export interface EncryptedEnvelope {
  ciphertext: string;
  iv: string;
  tag: string;
  version: number;
}

function deriveKey(secretKey: string | Buffer): Buffer {
  if (Buffer.isBuffer(secretKey) && secretKey.length === 32) {
    return secretKey;
  }
  return createHash("sha256").update(secretKey).digest();
}

/**
 * Encrypts sensitive string data using AES-256-GCM authenticated envelope encryption.
 */
export function encryptSecret(
  plaintext: string,
  secretKey: string | Buffer,
  version = 1
): EncryptedEnvelope {
  const key = deriveKey(secretKey);
  const iv = randomBytes(12); // Recommended 96-bit IV for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    version
  };
}

/**
 * Decrypts an AES-256-GCM envelope back to plaintext. Throws if tampered or invalid key.
 */
export function decryptSecret(envelope: EncryptedEnvelope, secretKey: string | Buffer): string {
  const key = deriveKey(secretKey);
  const iv = Buffer.from(envelope.iv, "base64url");
  const tag = Buffer.from(envelope.tag, "base64url");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64url");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Encrypts a webhook signing secret for secure at-rest storage.
 */
export function encryptWebhookSecret(secret: string, secretKey: string | Buffer): string {
  return JSON.stringify(encryptSecret(secret, secretKey));
}

/**
 * Decrypts a webhook signing secret from its at-rest format.
 */
export function decryptWebhookSecret(storedSecret: string, secretKey: string | Buffer): string {
  try {
    const parsed: unknown = JSON.parse(storedSecret);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "ciphertext" in parsed &&
      "iv" in parsed &&
      "tag" in parsed &&
      typeof (parsed as Record<string, unknown>)["ciphertext"] === "string" &&
      typeof (parsed as Record<string, unknown>)["iv"] === "string" &&
      typeof (parsed as Record<string, unknown>)["tag"] === "string"
    ) {
      const record = parsed as Record<string, unknown>;
      return decryptSecret(
        {
          ciphertext: record["ciphertext"] as string,
          iv: record["iv"] as string,
          tag: record["tag"] as string,
          version: typeof record["version"] === "number" ? record["version"] : 1
        },
        secretKey
      );
    }
  } catch {
    // If not JSON envelope, check if plaintext fallback (e.g. legacy/mock tests)
    if (storedSecret.startsWith("whsec_")) {
      return storedSecret;
    }
    throw new Error("Failed to decrypt webhook secret: invalid envelope");
  }

  if (storedSecret.startsWith("whsec_")) {
    return storedSecret;
  }
  throw new Error("Failed to decrypt webhook secret: unknown format");
}
