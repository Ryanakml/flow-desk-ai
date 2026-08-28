import { describe, expect, it } from "vitest";
import { computeMetaSignature, computeSha256, verifyMetaSignature } from "./signature.js";

describe("Meta HMAC-SHA256 Webhook Signature Verification (M2-03)", () => {
  const secret = "test_meta_app_secret_12345";
  const body = Buffer.from(JSON.stringify({ object: "whatsapp_business_account" }), "utf8");

  it("computes standard SHA-256 digests accurately", () => {
    const hash = computeSha256(body);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(computeSha256("test")).toBe(
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    );
  });

  it("computes and verifies a valid signature", () => {
    const signature = computeMetaSignature(body, secret);
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);

    const isValid = verifyMetaSignature(body, secret, signature);
    expect(isValid).toBe(true);
  });

  it("works with string body input identical to Buffer", () => {
    const bodyStr = JSON.stringify({ object: "whatsapp_business_account" });
    const signature = computeMetaSignature(bodyStr, secret);
    expect(verifyMetaSignature(bodyStr, secret, signature)).toBe(true);
  });

  it("rejects forged or tampered signatures", () => {
    const signature = computeMetaSignature(body, secret);
    const tampered = signature.slice(0, -4) + "0000";
    expect(verifyMetaSignature(body, secret, tampered)).toBe(false);
  });

  it("rejects signatures computed with wrong secret", () => {
    const signature = computeMetaSignature(body, "different_secret");
    expect(verifyMetaSignature(body, secret, signature)).toBe(false);
  });

  it("rejects signatures when payload body is modified", () => {
    const signature = computeMetaSignature(body, secret);
    const modifiedBody = Buffer.from(JSON.stringify({ object: "tampered" }), "utf8");
    expect(verifyMetaSignature(modifiedBody, secret, signature)).toBe(false);
  });

  it("rejects missing, empty, or malformed signature headers", () => {
    expect(verifyMetaSignature(body, secret, undefined)).toBe(false);
    expect(verifyMetaSignature(body, secret, "")).toBe(false);
    expect(verifyMetaSignature(body, secret, "invalid_header")).toBe(false);
    expect(verifyMetaSignature(body, secret, "sha1=not_sha256")).toBe(false);
    expect(verifyMetaSignature(body, secret, "sha256=short")).toBe(false);
  });
});
