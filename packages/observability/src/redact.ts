export function redactEmail(email: string): string {
  if (!email || !email.includes("@")) return "[REDACTED_EMAIL]";
  const [user, domain] = email.split("@");
  if (!user || !domain) return "[REDACTED_EMAIL]";
  if (user.length <= 2) {
    return `${user.charAt(0)}***@${domain}`;
  }
  return `${user.charAt(0)}***${user.charAt(user.length - 1)}@${domain}`;
}

const sensitiveKeys =
  /password|token|secret|authorization|cookie|key|credential|private|ssn|creditcard|api[_-]?key/i;

export function redactPii<T>(input: T): T {
  if (typeof input !== "object" || input === null) {
    return input;
  }

  if (Array.isArray(input)) {
    return (input as unknown[]).map((item: unknown) => redactPii(item)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (sensitiveKeys.test(k)) {
      result[k] = "[REDACTED]";
    } else if (k.toLowerCase().includes("email") && typeof v === "string") {
      result[k] = redactEmail(v);
    } else if (typeof v === "object" && v !== null) {
      result[k] = redactPii(v);
    } else {
      result[k] = v;
    }
  }

  return result as T;
}
