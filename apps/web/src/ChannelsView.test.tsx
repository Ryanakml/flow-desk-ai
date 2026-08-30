// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ChannelsView } from "./ChannelsView.js";

function getUrlString(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe("ChannelsView component (M6-01)", () => {
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

  it("renders channel list and connect channel button", async () => {
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const urlStr = getUrlString(input);
      if (urlStr.includes(`/api/v1/organizations/${orgId}/channels`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: "c1",
                organizationId: orgId,
                type: "whatsapp",
                name: "Support Line",
                phoneNumberId: "10987654321",
                wabaId: "9876543210",
                status: "active",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return Promise.reject(new Error(`Unhandled URL: ${urlStr}`));
    }) as typeof fetch;

    render(<ChannelsView orgId={orgId} canManage={true} showToast={showToast} />);

    expect(screen.getByText("Loading connected channels...")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Support Line")).toBeTruthy();
    });

    expect(screen.getByText(/10987654321/)).toBeTruthy();
    expect(screen.getAllByText("+ Connect WhatsApp Channel")[0]).toBeTruthy();
  });

  it("opens modal and submits new channel connection", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = getUrlString(input);
      if (urlStr.includes(`/api/v1/organizations/${orgId}/channels`)) {
        if (init?.method === "POST") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "c2",
                organizationId: orgId,
                type: "whatsapp",
                name: "Sales Line",
                phoneNumberId: "10987654399",
                wabaId: "9876543299",
                status: "active",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }),
              { status: 201, headers: { "Content-Type": "application/json" } }
            )
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }
      return Promise.reject(new Error(`Unhandled URL: ${urlStr}`));
    });

    globalThis.fetch = fetchMock as typeof fetch;

    render(<ChannelsView orgId={orgId} canManage={true} showToast={showToast} />);

    await waitFor(() => {
      expect(screen.getByText("No WhatsApp channels connected yet.")).toBeTruthy();
    });

    fireEvent.click(screen.getAllByText("+ Connect WhatsApp Channel")[0]!);

    expect(screen.getByText("Connect Meta WhatsApp Channel")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Channel Name"), { target: { value: "Sales Line" } });
    fireEvent.change(screen.getByLabelText("Phone Number ID"), {
      target: { value: "10987654399" }
    });
    fireEvent.change(screen.getByLabelText("WhatsApp Business Account ID (WABA ID)"), {
      target: { value: "9876543299" }
    });
    fireEvent.change(screen.getByLabelText("Permanent System User Access Token"), {
      target: { value: "EAAG123456" }
    });

    fireEvent.click(screen.getByText("Connect Channel"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });
});
