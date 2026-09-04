import { describe, it, expect, vi } from "vitest";
import {
  isPrivateIpAddress,
  isBlockedHostname,
  validateUrlForIngestion,
  validateWebhookUrl,
  fetchWithAntiSsrf,
  SsrfProtectionError
} from "./ssrf.js";

describe("Anti-SSRF Security Pipeline", () => {
  describe("isPrivateIpAddress", () => {
    it("identifies private IPv4 addresses", () => {
      expect(isPrivateIpAddress("127.0.0.1")).toBe(true);
      expect(isPrivateIpAddress("127.0.0.5")).toBe(true);
      expect(isPrivateIpAddress("10.0.0.1")).toBe(true);
      expect(isPrivateIpAddress("10.255.255.254")).toBe(true);
      expect(isPrivateIpAddress("172.16.0.1")).toBe(true);
      expect(isPrivateIpAddress("172.31.255.255")).toBe(true);
      expect(isPrivateIpAddress("192.168.1.1")).toBe(true);
      expect(isPrivateIpAddress("169.254.169.254")).toBe(true);
      expect(isPrivateIpAddress("0.0.0.0")).toBe(true);
    });

    it("identifies public IPv4 addresses", () => {
      expect(isPrivateIpAddress("8.8.8.8")).toBe(false);
      expect(isPrivateIpAddress("1.1.1.1")).toBe(false);
      expect(isPrivateIpAddress("140.82.121.4")).toBe(false);
      expect(isPrivateIpAddress("172.32.0.1")).toBe(false);
    });

    it("identifies private and loopback IPv6 addresses", () => {
      expect(isPrivateIpAddress("::1")).toBe(true);
      expect(isPrivateIpAddress("::")).toBe(true);
      expect(isPrivateIpAddress("fe80::1")).toBe(true);
      expect(isPrivateIpAddress("fc00::1")).toBe(true);
      expect(isPrivateIpAddress("::ffff:127.0.0.1")).toBe(true);
      expect(isPrivateIpAddress("2606:4700:4700::1111")).toBe(false);
    });
  });

  describe("isBlockedHostname", () => {
    it("blocks internal and local hostnames", () => {
      expect(isBlockedHostname("localhost")).toBe(true);
      expect(isBlockedHostname("LOCALHOST")).toBe(true);
      expect(isBlockedHostname("metadata.google.internal")).toBe(true);
      expect(isBlockedHostname("service.local")).toBe(true);
      expect(isBlockedHostname("db.internal")).toBe(true);
      expect(isBlockedHostname("app.localhost")).toBe(true);
    });

    it("allows public domain names", () => {
      expect(isBlockedHostname("flowdesk.dev")).toBe(false);
      expect(isBlockedHostname("docs.google.com")).toBe(false);
      expect(isBlockedHostname("api.github.com")).toBe(false);
    });
  });

  describe("validateUrlForIngestion", () => {
    it("denies forbidden protocols", async () => {
      await expect(validateUrlForIngestion("ftp://example.com/file.txt")).rejects.toThrow(
        SsrfProtectionError
      );
      await expect(validateUrlForIngestion("file:///etc/passwd")).rejects.toThrow(
        SsrfProtectionError
      );
      await expect(validateUrlForIngestion("gopher://127.0.0.1")).rejects.toThrow(
        SsrfProtectionError
      );
    });

    it("denies private IP addresses and metadata endpoints", async () => {
      await expect(validateUrlForIngestion("http://127.0.0.1/admin")).rejects.toThrow(
        SsrfProtectionError
      );
      await expect(
        validateUrlForIngestion("http://169.254.169.254/latest/meta-data/")
      ).rejects.toThrow(SsrfProtectionError);
      await expect(validateUrlForIngestion("http://10.0.0.1/secret")).rejects.toThrow(
        SsrfProtectionError
      );
    });

    it("accepts valid public HTTP/HTTPS URLs", async () => {
      const url = await validateUrlForIngestion("https://flowdesk.dev/docs", {
        allowLoopbackForTest: true
      });
      expect(url.hostname).toBe("flowdesk.dev");
      expect(url.protocol).toBe("https:");
    });
  });

  describe("fetchWithAntiSsrf", () => {
    it("fetches content from valid target URL", async () => {
      const mockFetcher = vi.fn().mockResolvedValue(
        new Response("Welcome to FlowDesk Docs", {
          status: 200,
          headers: { "Content-Type": "text/plain" }
        })
      );

      const result = await fetchWithAntiSsrf("https://flowdesk.dev/docs", {
        allowLoopbackForTest: true,
        customFetcher: mockFetcher
      });

      expect(result.content).toBe("Welcome to FlowDesk Docs");
      expect(result.contentType).toBe("text/plain");
      expect(result.byteSize).toBe(24);
    });

    it("rejects responses exceeding size limits", async () => {
      const largeContent = "x".repeat(100);
      const mockFetcher = vi.fn().mockResolvedValue(
        new Response(largeContent, {
          status: 200,
          headers: { "Content-Length": "100" }
        })
      );

      await expect(
        fetchWithAntiSsrf("https://flowdesk.dev/large", {
          maxSizeBytes: 50,
          allowLoopbackForTest: true,
          customFetcher: mockFetcher
        })
      ).rejects.toThrow(/exceeds limit/);
    });

    it("rejects redirects to private IP addresses", async () => {
      const mockFetcher = vi.fn().mockResolvedValueOnce(
        new Response("", {
          status: 302,
          headers: { Location: "http://169.254.169.254/latest/meta-data/" }
        })
      );

      await expect(
        fetchWithAntiSsrf("https://flowdesk.dev/redirect", {
          allowLoopbackForTest: false,
          customFetcher: mockFetcher
        })
      ).rejects.toThrow(SsrfProtectionError);
    });
  });

  describe("validateWebhookUrl", () => {
    it("allows valid public HTTPS URLs", async () => {
      const parsed = await validateWebhookUrl("https://flowdesk.dev/webhook-receiver");
      expect(parsed.hostname).toBe("flowdesk.dev");
      expect(parsed.protocol).toBe("https:");
    });

    it("rejects non-HTTP protocols", async () => {
      await expect(validateWebhookUrl("ftp://example.com/webhook")).rejects.toThrow(
        SsrfProtectionError
      );
    });

    it("enforces HTTPS outside test/dev override", async () => {
      await expect(
        validateWebhookUrl("http://example.com/webhook", {
          allowHttpForLocal: false,
          allowLoopbackForTest: false
        })
      ).rejects.toThrow(/HTTPS protocol/);
    });

    it("blocks private IPs and AWS metadata", async () => {
      await expect(
        validateWebhookUrl("https://169.254.169.254/webhook", {
          allowLoopbackForTest: false
        })
      ).rejects.toThrow(/SSRF protection policy/);

      await expect(
        validateWebhookUrl("https://10.0.0.1/webhook", {
          allowLoopbackForTest: false
        })
      ).rejects.toThrow(/SSRF protection policy/);
    });

    it("allows loopback when allowLoopbackForTest is true", async () => {
      const parsed = await validateWebhookUrl("http://127.0.0.1:9999/webhook", {
        allowLoopbackForTest: true,
        allowHttpForLocal: true
      });
      expect(parsed.hostname).toBe("127.0.0.1");
    });
  });
});
