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

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("KnowledgeView", () => {
  it("shows durable processing and failed states after loading", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      json({
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
    ) as typeof fetch;

    render(<KnowledgeView orgId={orgId} canManage={true} showToast={vi.fn()} />);

    expect(await screen.findByText("Policy")).toBeTruthy();
    expect(screen.getByText("processing")).toBeTruthy();
    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByText("The public knowledge URL could not be ingested safely.")).toBeTruthy();
  });

  it("submits text and refreshes the queued source", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ sources: [] }))
      .mockResolvedValueOnce(
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
      )
      .mockResolvedValueOnce(
        json({
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
        })
      );
    globalThis.fetch = fetchMock as typeof fetch;

    render(<KnowledgeView orgId={orgId} canManage={true} showToast={vi.fn()} />);
    await screen.findByText("No knowledge sources yet.");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Refunds" } });
    fireEvent.change(screen.getByLabelText("Knowledge text"), {
      target: { value: "Refunds are available for seven days." }
    });
    fireEvent.click(screen.getByText("Add knowledge"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(await screen.findByText("queued")).toBeTruthy();
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        type: "text",
        name: "Refunds",
        content: "Refunds are available for seven days."
      })
    });
  });

  it("hides the creation form from roles without manage permission", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(json({ sources: [] })) as typeof fetch;
    render(<KnowledgeView orgId={orgId} canManage={false} showToast={vi.fn()} />);

    await screen.findByText("No knowledge sources yet.");
    expect(screen.queryByText("Add knowledge")).toBeNull();
  });
});
