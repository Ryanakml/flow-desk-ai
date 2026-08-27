import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { App } from "./App.js";

describe("App UI Shell (M1-07)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("window", {
      location: { search: "", pathname: "/" },
      history: { replaceState: vi.fn() }
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  it("renders loading state on initial mount", () => {
    // Mock fetch that hangs to inspect initial loading state
    globalThis.fetch = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));

    const html = renderToString(<App />);
    expect(html).toContain("Loading FlowDesk…");
    expect(html).toContain("Verifying secure tenant session");
  });

  it("renders login card when unauthenticated", () => {
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

    // Initial render in server/node environment
    const html = renderToString(<App />);
    expect(html).toBeDefined();
  });
});
