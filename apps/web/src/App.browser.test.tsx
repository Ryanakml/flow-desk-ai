// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

vi.mock("./realtime.js", () => ({ useRealtimeSync: vi.fn() }));

const userId = "a0000000-0000-4000-8000-000000000001";
const organizationId = "b0000000-0000-4000-8000-000000000001";
const ownerRoleId = "b0000000-0000-4000-8000-000000000002";
const membershipId = "b0000000-0000-4000-8000-000000000003";

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("organization bootstrap browser flow", () => {
  it("selects a newly created organization and enters the workspace", async () => {
    const fetcher = vi.fn<typeof fetch>((input, init) => {
      const url = requestUrl(input);
      if (url === "/api/v1/auth/session") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: { id: userId, email: "owner@flowdesk.dev", displayName: "Owner" },
              expiresAt: "2026-08-31T00:00:00.000Z"
            }),
            { status: 200 }
          )
        );
      }
      if (url === "/api/v1/organizations" && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              organization: {
                id: organizationId,
                slug: "acme-support",
                displayName: "Acme Support",
                ownerRoleId,
                membershipId
              }
            }),
            { status: 201 }
          )
        );
      }
      if (url === "/api/v1/organizations") {
        return Promise.resolve(
          new Response(JSON.stringify({ organizations: [] }), { status: 200 })
        );
      }
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetcher);

    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Create your organization" })).toBeTruthy();

    await user.type(screen.getByLabelText("Organization Name"), "Acme Support");
    await user.click(screen.getByRole("button", { name: "Create Organization" }));

    expect(await screen.findByText("Acme Support")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Create your organization" })).toBeNull();
    expect(document.querySelector("#user-role-badge")?.textContent).toContain("owner");

    const createCall = fetcher.mock.calls.find(
      ([input, init]) => requestUrl(input) === "/api/v1/organizations" && init?.method === "POST"
    );
    expect(createCall).toBeDefined();
    const requestBody = createCall?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    expect(JSON.parse(requestBody as string)).toEqual({
      name: "Acme Support",
      slug: "acme-support"
    });
  });
});
