import { describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret } from "./encryption.js";

describe("AES-256-GCM Envelope Encryption (M2-01)", () => {
  const secretKey = "test-secret-key-flowdesk-channels-32b";
  const sensitivePayload = JSON.stringify({
    accessToken: "EAABtest_token_12345",
    verifyToken: "wh_verify_secret_abc"
  });

  it("encrypts and decrypts payload correctly", () => {
    const envelope = encryptSecret(sensitivePayload, secretKey);
    expect(envelope.ciphertext).toBeTypeOf("string");
    expect(envelope.iv).toBeTypeOf("string");
    expect(envelope.tag).toBeTypeOf("string");
    expect(envelope.version).toBe(1);

    // Ciphertext must not reveal plaintext
    expect(envelope.ciphertext).not.toContain("EAABtest");

    const decrypted = decryptSecret(envelope, secretKey);
    expect(decrypted).toBe(sensitivePayload);
    expect(JSON.parse(decrypted)).toEqual({
      accessToken: "EAABtest_token_12345",
      verifyToken: "wh_verify_secret_abc"
    });
  });

  it("fails decryption when secret key is incorrect", () => {
    const envelope = encryptSecret(sensitivePayload, secretKey);
    expect(() => decryptSecret(envelope, "wrong-key-value")).toThrow();
  });

  it("fails decryption when ciphertext is tampered with", () => {
    const envelope = encryptSecret(sensitivePayload, secretKey);
    const tampered = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -2) + "==" };
    expect(() => decryptSecret(tampered, secretKey)).toThrow();
  });

  it("fails decryption when auth tag is tampered with", () => {
    const envelope = encryptSecret(sensitivePayload, secretKey);
    const tampered = { ...envelope, tag: "dGFtcGVyZWQxMjM0NTY3OA" };
    expect(() => decryptSecret(tampered, secretKey)).toThrow();
  });
});
