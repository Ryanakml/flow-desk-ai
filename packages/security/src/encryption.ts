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
