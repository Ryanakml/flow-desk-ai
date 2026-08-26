const sensitiveKeys = /authorization|cookie|password|secret|token/i;

export function redactRecord(input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      sensitiveKeys.test(key) ? "[REDACTED]" : value
    ])
  );
}
