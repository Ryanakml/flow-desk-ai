import { describe, expect, it } from "vitest";
import { encryptSecret } from "./encryption.js";
import {
  decryptWhatsAppChannelCredentials,
  encryptWhatsAppChannelCredentials,
  WhatsAppCredentialError,
  type WhatsAppCredentialErrorCode
} from "./whatsapp-credentials.js";

const key = "credential-codec-test-key";
const credentials = {
  accessToken: "EAAG_raw_meta_token",
  phoneNumberId: "phone-123",
  wabaId: "waba-456"
};

function expectCredentialError(action: () => unknown, code: WhatsAppCredentialErrorCode): void {
  try {
    action();
    throw new Error(`Expected WhatsApp credential error ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(WhatsAppCredentialError);
    if (!(error instanceof WhatsAppCredentialError)) throw error;
    expect(error.code).toBe(code);
  }
}

describe("WhatsApp channel credential codec", () => {
  it("round-trips the canonical encrypted JSON object", () => {
    const encrypted = encryptWhatsAppChannelCredentials(credentials, key);
    expect(encrypted).not.toContain(credentials.accessToken);
    expect(
      decryptWhatsAppChannelCredentials(encrypted, key, {
        phoneNumberId: credentials.phoneNumberId,
        wabaId: credentials.wabaId
      })
    ).toEqual(credentials);
  });

  it("accepts nested credentials.accessToken while keeping identifiers bound", () => {
    const encrypted = JSON.stringify(
      encryptSecret(
        JSON.stringify({
          credentials: { accessToken: credentials.accessToken },
          phoneNumberId: credentials.phoneNumberId,
          wabaId: credentials.wabaId
        }),
        key
      )
    );
    expect(decryptWhatsAppChannelCredentials(encrypted, key)).toEqual(credentials);
  });

  it("fails closed for plaintext, a wrong key, raw-token plaintext, and identifier drift", () => {
    expect(() => decryptWhatsAppChannelCredentials(credentials.accessToken, key)).toThrow(
      WhatsAppCredentialError
    );
    const encrypted = encryptWhatsAppChannelCredentials(credentials, key);
    expectCredentialError(
      () => decryptWhatsAppChannelCredentials(encrypted, "wrong-key"),
      "DECRYPTION_FAILED"
    );
    const encryptedRawToken = JSON.stringify(encryptSecret(credentials.accessToken, key));
    expectCredentialError(
      () => decryptWhatsAppChannelCredentials(encryptedRawToken, key),
      "MALFORMED_CREDENTIALS"
    );
    expectCredentialError(
      () =>
        decryptWhatsAppChannelCredentials(encrypted, key, {
          phoneNumberId: "another-phone",
          wabaId: credentials.wabaId
        }),
      "IDENTIFIER_MISMATCH"
    );
  });
});
