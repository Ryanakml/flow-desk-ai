import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Computes a standard SHA-256 hex digest for arbitrary payloads.
 */
export function computeSha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Computes the official Meta X-Hub-Signature-256 header value for a given raw payload.
 */
export function computeMetaSignature(rawBody: Buffer | string, appSecret: string): string {
  const hmac = createHmac("sha256", appSecret);
  hmac.update(rawBody);
  return `sha256=${hmac.digest("hex")}`;
}

/**
 * Verifies a Meta X-Hub-Signature-256 signature against the raw request body in constant time.
 * Prevents timing attacks using crypto.timingSafeEqual.
 */
export function verifyMetaSignature(
  rawBody: Buffer | string,
  appSecret: string,
  signatureHeader?: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const expectedSignature = computeMetaSignature(rawBody, appSecret);
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const receivedBuffer = Buffer.from(signatureHeader, "utf8");

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
