import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class SsrfProtectionError extends Error {
  readonly code: string;

  constructor(message: string, code = "SSRF_BLOCKED") {
    super(message);
    this.name = "SsrfProtectionError";
    this.code = code;
  }
}

/**
 * Checks whether an IP address is a private, loopback, link-local, or cloud metadata address.
 */
export function isPrivateIpAddress(ip: string): boolean {
  const version = isIP(ip);
  if (!version) return false;

  if (version === 4) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
      return true;
    }
    const [p0, p1] = parts as [number, number, number, number];

    // 0.0.0.0/8 (Current network)
    if (p0 === 0) return true;
    // 10.0.0.0/8 (Private Class A)
    if (p0 === 10) return true;
    // 127.0.0.0/8 (Loopback)
    if (p0 === 127) return true;
    // 169.254.0.0/16 (Link-local & AWS/GCP Metadata 169.254.169.254)
    if (p0 === 169 && p1 === 254) return true;
    // 172.16.0.0/12 (Private Class B: 172.16.0.0 - 172.31.255.255)
    if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;
    // 192.168.0.0/16 (Private Class C)
    if (p0 === 192 && p1 === 168) return true;

    return false;
  }

  if (version === 6) {
    const normalized = ip.toLowerCase().trim();
    // IPv6 Loopback ::1 or ::
    if (normalized === "::1" || normalized === "::") return true;
    // IPv6 Link-local fe80::/10
    if (
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    )
      return true;
    // IPv6 Unique local fc00::/7 (fc00:: - fdff::)
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    // IPv4-mapped IPv6 (::ffff:127.0.0.1)
    if (normalized.startsWith("::ffff:")) {
      const v4Part = normalized.replace("::ffff:", "");
      return isPrivateIpAddress(v4Part);
    }
    return false;
  }

  return false;
}

/**
 * Checks if a hostname matches forbidden local/internal patterns.
 */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().trim();

  if (
    host === "localhost" ||
    host === "metadata.google.internal" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }

  return false;
}

/**
 * Validates a target URL against SSRF policy rules.
 */
export async function validateUrlForIngestion(
  targetUrl: string,
  options: { allowLoopbackForTest?: boolean | undefined } = {}
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new SsrfProtectionError("Invalid target URL format.", "INVALID_URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfProtectionError(
      `Forbidden protocol '${parsed.protocol}'. Only http: and https: are allowed.`,
      "FORBIDDEN_PROTOCOL"
    );
  }

  const hostname = parsed.hostname;

  if (!options.allowLoopbackForTest && isBlockedHostname(hostname)) {
    throw new SsrfProtectionError(
      `Access to internal hostname '${hostname}' is denied by SSRF protection policy.`,
      "BLOCKED_HOSTNAME"
    );
  }

  if (isIP(hostname)) {
    if (!options.allowLoopbackForTest && isPrivateIpAddress(hostname)) {
      throw new SsrfProtectionError(
        `Access to private IP address '${hostname}' is denied by SSRF protection policy.`,
        "PRIVATE_IP_DENIED"
      );
    }
    return parsed;
  }

  // Resolve hostname via DNS to verify resolved IPs
  if (!options.allowLoopbackForTest) {
    try {
      const records = await lookup(hostname, { all: true });
      for (const record of records) {
        if (isPrivateIpAddress(record.address)) {
          throw new SsrfProtectionError(
            `Hostname '${hostname}' resolved to private IP address '${record.address}'. Access denied.`,
            "DNS_REBINDING_DENIED"
          );
        }
      }
    } catch (err) {
      if (err instanceof SsrfProtectionError) throw err;
      throw new SsrfProtectionError(
        `DNS resolution failed for hostname '${hostname}'.`,
        "DNS_RESOLUTION_FAILED"
      );
    }
  }

  return parsed;
}

export interface AntiSsrfFetchOptions {
  maxSizeBytes?: number; // Default 5MB (5 * 1024 * 1024)
  timeoutMs?: number; // Default 10000ms (10s)
  allowLoopbackForTest?: boolean;
  customFetcher?: typeof fetch;
}

export interface AntiSsrfFetchResult {
  content: string;
  contentType: string;
  finalUrl: string;
  byteSize: number;
}

async function readBoundedText(response: Response, maxSizeBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteSize = 0;
  let content = "";
  while (true) {
    const readResult = (await reader.read()) as { done: boolean; value?: Uint8Array };
    if (readResult.done) break;
    const value = readResult.value;
    if (!value) continue;
    byteSize += value.byteLength;
    if (byteSize > maxSizeBytes) {
      await reader.cancel();
      throw new SsrfProtectionError(
        `Response body exceeds limit of ${maxSizeBytes} bytes.`,
        "EXCEEDS_SIZE_LIMIT"
      );
    }
    content += decoder.decode(value, { stream: true });
  }
  return content + decoder.decode();
}

/**
 * Fetches external content safely with anti-SSRF protection, size caps, timeouts, and redirect validation.
 */
export async function fetchWithAntiSsrf(
  targetUrl: string,
  options: AntiSsrfFetchOptions = {}
): Promise<AntiSsrfFetchResult> {
  const maxSizeBytes = options.maxSizeBytes ?? 5 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const fetcher = options.customFetcher ?? fetch;

  let currentUrl = targetUrl;
  let redirectCount = 0;
  const maxRedirects = 5;

  while (redirectCount <= maxRedirects) {
    const validatedUrl = await validateUrlForIngestion(currentUrl, {
      allowLoopbackForTest: options.allowLoopbackForTest
    });

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetcher(validatedUrl.toString(), {
        method: "GET",
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "FlowDesk-KnowledgeIngestion/1.0 (+https://flowdesk.dev)"
        }
      });
    } catch (err: unknown) {
      clearTimeout(timeoutTimer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new SsrfProtectionError(`Request timed out after ${timeoutMs}ms.`, "FETCH_TIMEOUT");
      }
      throw new SsrfProtectionError(
        `Failed to fetch target URL: ${err instanceof Error ? err.message : String(err)}`,
        "FETCH_FAILED"
      );
    }

    // Handle Manual Redirects to prevent SSRF via 3xx redirects to internal IPs
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const redirectLocation = response.headers.get("location");
      if (!redirectLocation) {
        throw new SsrfProtectionError(
          "Received redirect response without Location header.",
          "INVALID_REDIRECT"
        );
      }
      currentUrl = new URL(redirectLocation, validatedUrl.toString()).toString();
      redirectCount++;
      clearTimeout(timeoutTimer);
      continue;
    }

    if (!response.ok) {
      clearTimeout(timeoutTimer);
      throw new SsrfProtectionError(
        `HTTP Error ${response.status}: ${response.statusText}`,
        response.status >= 500 ? "HTTP_5XX" : "HTTP_ERROR"
      );
    }

    const contentType = response.headers.get("content-type") || "text/plain";
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > maxSizeBytes) {
      clearTimeout(timeoutTimer);
      throw new SsrfProtectionError(
        `Response body size (${contentLength} bytes) exceeds limit of ${maxSizeBytes} bytes.`,
        "EXCEEDS_SIZE_LIMIT"
      );
    }

    let textContent: string;
    try {
      textContent = await readBoundedText(response, maxSizeBytes);
    } catch (err: unknown) {
      if (err instanceof SsrfProtectionError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new SsrfProtectionError(`Request timed out after ${timeoutMs}ms.`, "FETCH_TIMEOUT");
      }
      throw new SsrfProtectionError("Failed to read target response body.", "FETCH_FAILED");
    } finally {
      clearTimeout(timeoutTimer);
    }
    const byteSize = Buffer.byteLength(textContent, "utf-8");
    if (byteSize > maxSizeBytes) {
      throw new SsrfProtectionError(
        `Response body size (${byteSize} bytes) exceeds limit of ${maxSizeBytes} bytes.`,
        "EXCEEDS_SIZE_LIMIT"
      );
    }

    return {
      content: textContent,
      contentType,
      finalUrl: currentUrl,
      byteSize
    };
  }

  throw new SsrfProtectionError("Exceeded maximum allowed redirects (5).", "TOO_MANY_REDIRECTS");
}
