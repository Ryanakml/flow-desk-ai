// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeView } from "./KnowledgeView.js";

const originalFetch = globalThis.fetch;
const orgId = "30000000-0000-4000-8000-000000000001";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function botConfig(mode: "off" | "draft" | "auto" = "draft") {
  const now = new Date().toISOString();
  return {
    id: "41000000-0000-4000-8000-000000000001",
    organizationId: orgId,
    instructions: "Answer from approved knowledge.",
    tone: "professional",
    language: "id",
    model: "gemini-3.7-flash",
    confidenceThreshold: 0.9,
    topK: 5,
    mode,
    emergencyDisabled: false,
    createdAt: now,
    updatedAt: now
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("KnowledgeView", () => {
  it("shows durable processing and failed states after loading", async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        requestUrl(input).includes("/bot/config")
          ? json(botConfig())
          : json({
              sources: [
                {
                  id: "40000000-0000-4000-8000-000000000001",
                  organizationId: orgId,
                  type: "text",
                  name: "Policy",
                  sourceUri: null,
                  status: "processing",
                  statusReason: null,
                  byteSize: 0,
                  lastIndexedAt: null,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString()
                },
                {
                  id: "40000000-0000-4000-8000-000000000002",
                  organizationId: orgId,
                  type: "url",
                  name: "Unsafe source",
                  sourceUri: "https://example.com/help",
                  status: "failed",
                  statusReason: "The public knowledge URL could not be ingested safely.",
                  byteSize: 0,
                  lastIndexedAt: null,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString()
                }
              ]
            })
      )
    );

    render(<KnowledgeView orgId={orgId} canManage={true} showToast={vi.fn()} />);

    expect(await screen.findByText("Policy")).toBeTruthy();
    expect(screen.getByText("processing")).toBeTruthy();
    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByText("The public knowledge URL could not be ingested safely.")).toBeTruthy();
  });

  it("submits text and refreshes the queued source", async () => {
    let listCount = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes("/bot/config")) return Promise.resolve(json(botConfig()));
      if (init?.method === "POST")
        return Promise.resolve(
          json(
            {
              source: {
                id: "40000000-0000-4000-8000-000000000003",
                organizationId: orgId,
                type: "text",
                name: "Refunds",
                sourceUri: null,
                status: "queued",
                statusReason: null,
                byteSize: 0,
                lastIndexedAt: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              },
              jobId: "50000000-0000-4000-8000-000000000001"
            },
            202
          )
        );
      listCount += 1;
      return Promise.resolve(
        json(
          listCount === 1
            ? { sources: [] }
            : {
                sources: [
                  {
                    id: "40000000-0000-4000-8000-000000000003",
                    organizationId: orgId,
                    type: "text",
                    name: "Refunds",
                    sourceUri: null,
                    status: "queued",
                    statusReason: null,
                    byteSize: 0,
                    lastIndexedAt: null,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                  }
                ]
              }
        )
      );
    });
    globalThis.fetch = fetchMock;

    render(<KnowledgeView orgId={orgId} canManage={true} showToast={vi.fn()} />);
    await screen.findByText("No knowledge sources yet.");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Refunds" } });
    fireEvent.change(screen.getByLabelText("Knowledge text"), {
      target: { value: "Refunds are available for seven days." }
    });
    fireEvent.click(screen.getByText("Add knowledge"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(await screen.findByText("queued")).toBeTruthy();
    const postCall = fetchMock.mock.calls.find((call) => call[1]?.method === "POST");
    expect(postCall?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        type: "text",
        name: "Refunds",
        content: "Refunds are available for seven days."
      })
    });
  });

  it("hides the creation form from roles without manage permission", async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        requestUrl(input).includes("/bot/config") ? json(botConfig()) : json({ sources: [] })
      )
    );
    render(<KnowledgeView orgId={orgId} canManage={false} showToast={vi.fn()} />);

    await screen.findByText("No knowledge sources yet.");
    expect(screen.queryByText("Add knowledge")).toBeNull();
  });

  it("explicitly enables AUTO through the authorized bot configuration API", async () => {
    const showToast = vi.fn();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes("/bot/config") && init?.method === "PUT") {
        return Promise.resolve(json(botConfig("auto")));
      }
      if (url.includes("/bot/config")) return Promise.resolve(json(botConfig("draft")));
      return Promise.resolve(json({ sources: [] }));
    });
    globalThis.fetch = fetchMock;
    render(<KnowledgeView orgId={orgId} canManage={true} showToast={showToast} />);

    const select = await screen.findByLabelText("Bot mode");
    fireEvent.change(select, { target: { value: "auto" } });
    fireEvent.click(screen.getByText("Save AUTO mode"));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) => call[1]?.body === JSON.stringify({ mode: "auto" }))
      ).toBe(true)
    );
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("AUTO enabled"), "success");
  });
});
