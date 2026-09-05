// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App.js";

describe("App UI Shell (M1-07)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("scrollTo", vi.fn());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  it("renders loading state on initial mount", async () => {
    // Mock fetch that hangs to inspect initial loading state
    globalThis.fetch = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));

    render(<App />);
    expect(await screen.findByText("Loading FlowDesk…")).toBeTruthy();
    expect(screen.getByText("Verifying secure tenant session")).toBeTruthy();
  });

  it("renders login card when unauthenticated", async () => {
    // When session endpoint returns 401
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "https://flowdesk.dev/problems/unauthorized",
          title: "Unauthorized",
          status: 401,
          code: "UNAUTHORIZED",
          detail: "Session missing",
          requestId: "req-1"
        }),
        { status: 401 }
      )
    );

    render(<App />);
    expect(await screen.findByText("Sign in with SSO / OIDC")).toBeTruthy();
  });
});
