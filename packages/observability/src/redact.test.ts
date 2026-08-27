import { describe, expect, it } from "vitest";
import { redactEmail, redactPii } from "./redact.js";

describe("PII Redaction (M1-08)", () => {
  it("redacts email addresses partially while keeping domain", () => {
    expect(redactEmail("alice@example.com")).toBe("a***e@example.com");
    expect(redactEmail("bo@example.com")).toBe("b***@example.com");
    expect(redactEmail("invalid")).toBe("[REDACTED_EMAIL]");
  });

  it("redacts sensitive fields and emails in objects", () => {
    const original = {
      name: "Alice",
      userEmail: "alice@flowdesk.dev",
      password: "supersecretpassword",
      token: "opaque-bearer-token",
      nested: {
        apiKey: "sk-12345",
        contactEmail: "bob@flowdesk.dev",
        allowed: true
      }
    };

    const redacted = redactPii(original);
    expect(redacted.name).toBe("Alice");
    expect(redacted.userEmail).toBe("a***e@flowdesk.dev");
    expect(redacted.password).toBe("[REDACTED]");
    expect(redacted.token).toBe("[REDACTED]");
    expect(redacted.nested.apiKey).toBe("[REDACTED]");
    expect(redacted.nested.contactEmail).toBe("b***b@flowdesk.dev");
    expect(redacted.nested.allowed).toBe(true);
  });
});
