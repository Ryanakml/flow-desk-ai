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

/**
 * Computes a standard FlowDesk developer webhook signature (v1 HMAC-SHA256).
 */
export function computeWebhookSignature(
  rawBody: Buffer | string,
  secret: string,
  timestamp: number
): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(`${timestamp}.${typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")}`);
  return `t=${timestamp},v1=${hmac.digest("hex")}`;
}

/**
 * Verifies a FlowDesk developer webhook signature header (t=...,v1=...) in constant time.
 * Supports tolerance against clock skew / replay attacks (default 300 seconds).
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  secret: string,
  signatureHeader?: string,
  toleranceSeconds = 300
): boolean {
  if (!signatureHeader) return false;

  const parts = signatureHeader.split(",");
  let timestamp: number | null = null;
  let receivedSignature: string | null = null;

  for (const part of parts) {
    const [key, value] = part.split("=", 2);
    if (key === "t" && value) {
      timestamp = parseInt(value, 10);
    } else if (key === "v1" && value) {
      receivedSignature = value;
    }
  }

  if (timestamp === null || !receivedSignature || isNaN(timestamp)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return false;
  }

  const hmac = createHmac("sha256", secret);
  hmac.update(`${timestamp}.${typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")}`);
  const expectedSignature = hmac.digest("hex");

  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const receivedBuffer = Buffer.from(receivedSignature, "utf8");

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
