// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelsView } from "./ChannelsView.js";

const orgId = "org-123";
const attemptId = "a0000000-0000-4000-8000-000000000111";

function channel() {
  return {
    id: "c0000000-0000-4000-8000-000000000001",
    organizationId: orgId,
    type: "whatsapp",
    name: "Support Line",
    phoneNumberId: "10987654321",
    wabaId: "9876543210",
    status: "active",
    statusReason: null,
    metadata: { connectionMethod: "meta_embedded_signup" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function urlFor(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe("ChannelsView WhatsApp connection", () => {
  const showToast = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    showToast.mockReset();
    delete window.FB;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    delete window.FB;
  });

  it("renders verified-token connection as the primary path and keeps Meta Signup available", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(response([channel()])) as typeof fetch;
    render(<ChannelsView orgId={orgId} canManage={true} showToast={showToast} />);

    await screen.findByText("Support Line");
    expect(screen.getByText("Connect WhatsApp")).toBeTruthy();
    expect(screen.getByText("Connect with Meta Signup")).toBeTruthy();
    expect(screen.getByText("Reconnect with token")).toBeTruthy();
    fireEvent.click(screen.getByText("Connect WhatsApp"));
    expect(screen.getByLabelText("Access token")).toBeTruthy();
    expect(screen.queryByText("App Secret")).toBeNull();
  });

  it("submits manual credentials to the verified connector", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlFor(input);
      if (url.endsWith(`/api/v1/organizations/${orgId}/channels`) && init?.method === "POST") {
        return Promise.resolve(
          response(
            {
              channel: {
                ...channel(),
                metadata: {
                  connectionMethod: "manual_verified",
                  subscriptionStatus: "subscribed"
                }
              },
              displayPhoneNumber: "+62 812 3456 7890",
              verifiedName: "Support"
            },
            201
          )
        );
      }
      if (url.endsWith(`/api/v1/organizations/${orgId}/channels`)) {
        return Promise.resolve(response([]));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    globalThis.fetch = fetchMock as typeof fetch;

    render(<ChannelsView orgId={orgId} canManage={true} showToast={showToast} />);
    await screen.findByText("No WhatsApp channels connected yet.");
    fireEvent.click(screen.getByText("Connect WhatsApp"));
    fireEvent.change(screen.getByLabelText("Channel name"), { target: { value: "Support" } });
    fireEvent.change(screen.getByLabelText("Phone Number ID"), {
      target: { value: "10987654321" }
    });
    fireEvent.change(screen.getByLabelText("WABA ID"), { target: { value: "9876543210" } });
    fireEvent.change(screen.getByLabelText("Access token"), {
      target: { value: "EAAG_CUSTOMER_TOKEN" }
    });
    fireEvent.click(screen.getByText("Verify and connect"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/organizations/${orgId}/channels`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            type: "whatsapp",
            name: "Support",
            phoneNumberId: "10987654321",
            wabaId: "9876543210",
            accessToken: "EAAG_CUSTOMER_TOKEN"
          })
        })
      )
    );
  });

  it("starts a server-bound Meta signup and only completes after code plus Meta WABA event", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = urlFor(input);
      if (url.endsWith("/embedded-signup/start")) {
        return Promise.resolve(
          response(
            {
              attemptId,
              state: "state-value-with-more-than-thirty-two-characters",
              appId: "flowdesk-meta-app-id",
              configId: "flowdesk-embedded-config-id",
              expiresAt: new Date(Date.now() + 600000).toISOString()
            },
            201
          )
        );
      }
      if (url.endsWith("/embedded-signup/complete")) {
        return Promise.resolve(
          response(
            {
              channel: channel(),
              displayPhoneNumber: "+62 812 3456 7890",
              verifiedName: "Support"
            },
            201
          )
        );
      }
      if (url.endsWith(`/api/v1/organizations/${orgId}/channels`)) {
        return Promise.resolve(response([]));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    globalThis.fetch = fetchMock as typeof fetch;

    let loginCallback: ((response: { authResponse?: { code?: string } }) => void) | undefined;
    const fbLogin = vi.fn((callback: (response: { authResponse?: { code?: string } }) => void) => {
      loginCallback = callback;
    });
    window.FB = {
      init: vi.fn(),
      login: fbLogin
    };

    render(<ChannelsView orgId={orgId} canManage={true} showToast={showToast} />);
    await screen.findByText("No WhatsApp channels connected yet.");
    fireEvent.click(screen.getByText("Connect with Meta Signup"));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) => {
          const input: unknown = call[0];
          if (typeof input !== "string" && !(input instanceof URL) && !(input instanceof Request)) {
            return false;
          }
          const url = urlFor(input);
          return url.endsWith("/embedded-signup/start");
        })
      ).toBe(true)
    );
    await waitFor(() => expect(fbLogin).toHaveBeenCalled());
    loginCallback?.({ authResponse: { code: "one-time-meta-code" } });
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://www.facebook.com",
        data: JSON.stringify({
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH",
          data: { phone_number_id: "10987654321", waba_id: "9876543210" }
        })
      })
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/organizations/${orgId}/channels/whatsapp/embedded-signup/complete`,
        expect.objectContaining({
          method: "POST"
        })
      );
    });
    expect(screen.queryByText("App Secret")).toBeNull();
  });
});
