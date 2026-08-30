import { decryptSecret, encryptSecret, type EncryptedEnvelope } from "./encryption.js";

export interface WhatsAppChannelCredentials {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
}

export type WhatsAppCredentialErrorCode =
  | "MALFORMED_ENVELOPE"
  | "DECRYPTION_FAILED"
  | "MALFORMED_CREDENTIALS"
  | "MISSING_ACCESS_TOKEN"
  | "IDENTIFIER_MISMATCH";

export class WhatsAppCredentialError extends Error {
  readonly code: WhatsAppCredentialErrorCode;

  constructor(code: WhatsAppCredentialErrorCode, message: string) {
    super(message);
    this.name = "WhatsAppCredentialError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEnvelope(rawCredentials: string): EncryptedEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawCredentials);
  } catch {
    throw new WhatsAppCredentialError(
      "MALFORMED_ENVELOPE",
      "Channel credentials are not a valid encrypted envelope."
    );
  }

  if (
    !isRecord(parsed) ||
    typeof parsed["ciphertext"] !== "string" ||
    typeof parsed["iv"] !== "string" ||
    typeof parsed["tag"] !== "string" ||
    typeof parsed["version"] !== "number"
  ) {
    throw new WhatsAppCredentialError(
      "MALFORMED_ENVELOPE",
      "Channel credentials are not a valid encrypted envelope."
    );
  }

  return parsed as unknown as EncryptedEnvelope;
}

/**
 * Canonical at-rest format for WhatsApp channel credentials. The database stores
 * the returned JSON string, never the plaintext object.
 */
export function encryptWhatsAppChannelCredentials(
  credentials: WhatsAppChannelCredentials,
  encryptionKey: string
): string {
  return JSON.stringify(
    encryptSecret(
      JSON.stringify({
        accessToken: credentials.accessToken,
        phoneNumberId: credentials.phoneNumberId,
        wabaId: credentials.wabaId
      }),
      encryptionKey
    )
  );
}

/**
 * Strictly decodes credentials produced by the API. Both the canonical root
 * accessToken and a nested credentials.accessToken are accepted for a safe
 * transition from earlier documented shapes. Plaintext and raw-token fallbacks
 * are intentionally rejected.
 */
export function decryptWhatsAppChannelCredentials(
  rawCredentials: string,
  encryptionKey: string,
  expected?: { phoneNumberId: string; wabaId: string }
): WhatsAppChannelCredentials {
  const envelope = parseEnvelope(rawCredentials);

  let plaintext: string;
  try {
    plaintext = decryptSecret(envelope, encryptionKey);
  } catch {
    throw new WhatsAppCredentialError(
      "DECRYPTION_FAILED",
      "Channel credentials could not be decrypted with the configured encryption key."
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new WhatsAppCredentialError(
      "MALFORMED_CREDENTIALS",
      "Decrypted channel credentials are not a valid JSON object."
    );
  }

  if (!isRecord(parsed)) {
    throw new WhatsAppCredentialError(
      "MALFORMED_CREDENTIALS",
      "Decrypted channel credentials are not a valid JSON object."
    );
  }

  const nested = isRecord(parsed["credentials"]) ? parsed["credentials"] : undefined;
  const accessToken = nested?.["accessToken"] ?? parsed["accessToken"];
  const phoneNumberId = parsed["phoneNumberId"] ?? nested?.["phoneNumberId"];
  const wabaId = parsed["wabaId"] ?? nested?.["wabaId"];

  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    throw new WhatsAppCredentialError(
      "MISSING_ACCESS_TOKEN",
      "Decrypted channel credentials do not contain an access token."
    );
  }
  if (typeof phoneNumberId !== "string" || typeof wabaId !== "string") {
    throw new WhatsAppCredentialError(
      "MALFORMED_CREDENTIALS",
      "Decrypted channel credentials do not contain the channel identifiers."
    );
  }
  if (expected && (phoneNumberId !== expected.phoneNumberId || wabaId !== expected.wabaId)) {
    throw new WhatsAppCredentialError(
      "IDENTIFIER_MISMATCH",
      "Decrypted channel credentials do not match the channel identifiers."
    );
  }

  return { accessToken, phoneNumberId, wabaId };
}
