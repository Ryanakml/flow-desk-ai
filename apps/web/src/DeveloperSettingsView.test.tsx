// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DeveloperSettingsView } from "./DeveloperSettingsView.js";

function getUrlString(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe("DeveloperSettingsView component (M6-02)", () => {
  const orgId = "org-123";
  const showToast = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    showToast.mockReset();
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders API keys tab and fetches active keys", async () => {
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const urlStr = getUrlString(input);
      if (urlStr.includes(`/api/v1/organizations/${orgId}/developer/api-keys`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: "key-1",
                organizationId: orgId,
                name: "Production Key",
                keyPrefix: "fd_live_",
                scopes: ["read:conversations", "write:messages"],
                createdAt: new Date().toISOString()
              }
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      if (urlStr.includes(`/api/v1/organizations/${orgId}/developer/webhooks`)) {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }
      return Promise.reject(new Error(`Unhandled URL: ${urlStr}`));
    }) as typeof fetch;

    render(<DeveloperSettingsView orgId={orgId} canManage={true} showToast={showToast} />);

    expect(screen.getByText("Loading API keys...")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Production Key")).toBeTruthy();
    });

    expect(screen.getByText("read:conversations")).toBeTruthy();
    expect(screen.getByText("write:messages")).toBeTruthy();
  });

  it("switches to Webhooks tab and renders webhook subscriptions", async () => {
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const urlStr = getUrlString(input);
      if (urlStr.includes(`/api/v1/organizations/${orgId}/developer/api-keys`)) {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }
      if (urlStr.includes(`/api/v1/organizations/${orgId}/developer/webhooks`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: "wh-1",
                organizationId: orgId,
                name: "CRM Dispatcher",
                url: "https://crm.example.com/webhook",
                secret: "whsec_test_secret",
                events: ["conversation.created"],
                isActive: true,
                createdAt: new Date().toISOString()
              }
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return Promise.reject(new Error(`Unhandled URL: ${urlStr}`));
    }) as typeof fetch;

    render(<DeveloperSettingsView orgId={orgId} canManage={true} showToast={showToast} />);

    fireEvent.click(screen.getByText("Webhooks"));

    await waitFor(() => {
      expect(screen.getByText("CRM Dispatcher")).toBeTruthy();
    });

    expect(screen.getByText("https://crm.example.com/webhook")).toBeTruthy();
    expect(screen.getByText("conversation.created")).toBeTruthy();
  });
});
