// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeveloperSettingsView } from "./DeveloperSettingsView.js";

function getUrlString(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const testWebhookSecret = () => ["whsec", "x".repeat(32)].join("_");

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

  it("uses the canonical external API scopes in the key UI", async () => {
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = getUrlString(input);
      if (url.endsWith(`/api/v1/organizations/${orgId}/developer/api-keys`)) {
        return Promise.resolve(
          jsonResponse([
            {
              id: "key-1",
              organizationId: orgId,
              name: "Production Key",
              keyPrefix: "fd_live_",
              scopes: ["conversation:read", "message:write"],
              createdAt: new Date().toISOString()
            }
          ])
        );
      }
      if (url.endsWith(`/api/v1/organizations/${orgId}/developer/webhooks`)) {
        return Promise.resolve(jsonResponse([]));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    }) as typeof fetch;

    render(<DeveloperSettingsView orgId={orgId} canManage={true} showToast={showToast} />);

    await waitFor(() => expect(screen.getByText("Production Key")).toBeTruthy());
    expect(screen.getByText("conversation:read")).toBeTruthy();
    expect(screen.getByText("message:write")).toBeTruthy();

    fireEvent.click(screen.getByText("+ Generate New API Key"));
    expect(screen.getAllByText("conversation:read").length).toBeGreaterThan(0);
    expect(screen.getAllByText("message:write").length).toBeGreaterThan(0);
    expect(screen.queryByText("read:conversations")).toBeNull();
    expect(screen.queryByText("write:messages")).toBeNull();
  });

  it("submits canonical scopes when generating a new API key", async () => {
    let createBody: Record<string, unknown> | null = null;
    let created = false;

    globalThis.fetch = vi
      .fn()
      .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = getUrlString(input);
        if (url.endsWith(`/api/v1/organizations/${orgId}/developer/api-keys`)) {
          if (init?.method === "POST") {
            createBody =
              typeof init?.body === "string"
                ? (JSON.parse(init.body) as Record<string, unknown>)
                : null;
            created = true;
            return Promise.resolve(
              jsonResponse(
                {
                  id: "key-new",
                  organizationId: orgId,
                  name: "Acceptance Key",
                  keyPrefix: "fd_live_",
                  rawKey: `fd_live_${"a".repeat(48)}`,
                  scopes: ["conversation:read", "message:write"],
                  createdAt: new Date().toISOString()
                },
                201
              )
            );
          }
          return Promise.resolve(
            jsonResponse(
              created
                ? [
                    {
                      id: "key-new",
                      organizationId: orgId,
                      name: "Acceptance Key",
                      keyPrefix: "fd_live_",
                      scopes: ["conversation:read", "message:write"],
                      createdAt: new Date().toISOString()
                    }
                  ]
                : []
            )
          );
        }
        if (url.endsWith(`/api/v1/organizations/${orgId}/developer/webhooks`)) {
          return Promise.resolve(jsonResponse([]));
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      }) as typeof fetch;

    render(<DeveloperSettingsView orgId={orgId} canManage={true} showToast={showToast} />);
    await waitFor(() => expect(screen.getByText("No API keys created yet.")).toBeTruthy());

    fireEvent.click(screen.getByText("+ Generate New API Key"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Production Automation Bot"), {
      target: { value: "Acceptance Key" }
    });
    fireEvent.click(screen.getByText("Generate Key"));

    await waitFor(() => expect(createBody).not.toBeNull());
    expect(createBody?.["scopes"]).toEqual(["conversation:read", "message:write"]);
  });

  it("shows the raw webhook signing secret only after creation", async () => {
    let created = false;
    const rawSecret = testWebhookSecret();

    globalThis.fetch = vi
      .fn()
      .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = getUrlString(input);
        if (url.endsWith(`/api/v1/organizations/${orgId}/developer/api-keys`)) {
          return Promise.resolve(jsonResponse([]));
        }
        if (url.endsWith(`/api/v1/organizations/${orgId}/developer/webhooks`)) {
          if (init?.method === "POST") {
            created = true;
            return Promise.resolve(
              jsonResponse(
                {
                  id: "wh-1",
                  organizationId: orgId,
                  name: "Acceptance Hook",
                  url: "https://receiver.example.com/flowdesk",
                  secret: rawSecret,
                  events: ["conversation.created", "message.received"],
                  isActive: true,
                  verificationStatus: "unverified",
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString()
                },
                201
              )
            );
          }
          return Promise.resolve(
            jsonResponse(
              created
                ? [
                    {
                      id: "wh-1",
                      organizationId: orgId,
                      name: "Acceptance Hook",
                      url: "https://receiver.example.com/flowdesk",
                      secret: "whsec_****************",
                      events: ["conversation.created", "message.received"],
                      isActive: true,
                      verificationStatus: "unverified",
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString()
                    }
                  ]
                : []
            )
          );
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      }) as typeof fetch;

    render(<DeveloperSettingsView orgId={orgId} canManage={true} showToast={showToast} />);
    fireEvent.click(screen.getByText("Webhooks"));
    await waitFor(() =>
      expect(screen.getByText("No outbound webhook subscriptions registered yet.")).toBeTruthy()
    );

    fireEvent.click(screen.getByText("+ Register Webhook"));
    fireEvent.change(screen.getByPlaceholderText("e.g. CRM Sync Handler"), {
      target: { value: "Acceptance Hook" }
    });
    fireEvent.change(screen.getByPlaceholderText("https://your-domain.com/webhooks/flowdesk"), {
      target: { value: "https://receiver.example.com/flowdesk" }
    });
    fireEvent.click(screen.getByText("Register Webhook"));

    await waitFor(() => expect(screen.getByText("Save Your Webhook Signing Secret")).toBeTruthy());
    expect(screen.getByText(rawSecret)).toBeTruthy();

    fireEvent.click(screen.getByText("Close ✕"));
    expect(screen.queryByText(rawSecret)).toBeNull();
    await waitFor(() => expect(screen.getByText("whsec_****************")).toBeTruthy());
  });

  it("tests an unverified webhook, refreshes verification status, and renders delivery history", async () => {
    let verified = false;
    const delivery = {
      id: "delivery-1",
      organizationId: orgId,
      subscriptionId: "wh-1",
      eventId: "evt_test_1",
      eventType: "endpoint.test",
      payload: { event: "endpoint.test" },
      status: "delivered",
      attemptCount: 1,
      maxAttempts: 5,
      nextAttemptAt: new Date().toISOString(),
      deliveredAt: new Date().toISOString(),
      responseStatusCode: 200,
      lastError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    globalThis.fetch = vi
      .fn()
      .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = getUrlString(input);
        if (url.endsWith(`/api/v1/organizations/${orgId}/developer/api-keys`)) {
          return Promise.resolve(jsonResponse([]));
        }
        if (url.endsWith(`/api/v1/organizations/${orgId}/developer/webhooks/wh-1/test`)) {
          verified = true;
          return Promise.resolve(jsonResponse({ enqueued: true, eventId: "evt_test_1" }));
        }
        if (url.endsWith(`/api/v1/organizations/${orgId}/developer/webhooks/wh-1/deliveries`)) {
          return Promise.resolve(jsonResponse(verified ? [delivery] : []));
        }
        if (url.endsWith(`/api/v1/organizations/${orgId}/developer/webhooks`) && !init?.method) {
          return Promise.resolve(
            jsonResponse([
              {
                id: "wh-1",
                organizationId: orgId,
                name: "CRM Dispatcher",
                url: "https://crm.example.com/webhook",
                secret: "whsec_****************",
                events: ["conversation.created"],
                isActive: true,
                verificationStatus: verified ? "verified" : "unverified",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }
            ])
          );
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      }) as typeof fetch;

    render(<DeveloperSettingsView orgId={orgId} canManage={true} showToast={showToast} />);
    fireEvent.click(screen.getByText("Webhooks"));
    await waitFor(() => expect(screen.getByText("CRM Dispatcher")).toBeTruthy());
    expect(screen.getByText("UNVERIFIED")).toBeTruthy();

    fireEvent.click(screen.getByText("Send Test / Verify"));
    await waitFor(() => expect(screen.getByText("VERIFIED")).toBeTruthy(), { timeout: 2500 });

    fireEvent.click(screen.getByText("View Deliveries"));
    await waitFor(() => expect(screen.getByText("endpoint.test")).toBeTruthy());
    expect(screen.getByText("HTTP 200 · attempts 1/5")).toBeTruthy();
  });
});
