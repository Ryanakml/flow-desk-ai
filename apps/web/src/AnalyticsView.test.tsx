// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AnalyticsView } from "./AnalyticsView.js";

function getUrlString(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe("AnalyticsView UI Component (M6-04)", () => {
  const orgId = "org-123";
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const urlStr = getUrlString(input);
      if (urlStr.includes(`/api/v1/organizations/${orgId}/analytics/metrics`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              overview: {
                totalConversations: 100,
                openConversations: 20,
                assignedConversations: 50,
                resolvedConversations: 80,
                totalMessages: 500,
                inboundMessages: 250,
                outboundMessages: 250,
                botMessages: 300,
                humanMessages: 200,
                botAutomationRate: 60,
                slaMetPercentage: 97.5,
                avgFirstResponseTimeSeconds: 30,
                avgResolutionTimeSeconds: 300
              },
              volumeSeries: [
                { date: "2026-08-28", inbound: 50, outbound: 40, bot: 30 },
                { date: "2026-08-29", inbound: 60, outbound: 50, bot: 40 }
              ]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }

      if (urlStr.includes(`/api/v1/organizations/${orgId}/analytics/export`)) {
        return Promise.resolve(
          new Response("Category,Metric,Value\nConversations,Total,100", {
            status: 200,
            headers: {
              "Content-Type": "text/csv",
              "Content-Disposition": `attachment; filename="flowdesk-analytics-${orgId}.csv"`
            }
          })
        );
      }

      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders analytics header and key operational metrics cards", async () => {
    render(<AnalyticsView orgId={orgId} />);

    await waitFor(() => {
      expect(screen.getByText("Real-Time Analytics & SLA Engine")).toBeDefined();
    });

    expect(screen.getByText("TOTAL CONVERSATIONS")).toBeDefined();
    expect(screen.getByText("100")).toBeDefined();
    expect(screen.getByText("BOT AUTOMATION RATE")).toBeDefined();
    expect(screen.getByText("60%")).toBeDefined();
    expect(screen.getByText("SLA COMPLIANCE")).toBeDefined();
    expect(screen.getByText("97.5%")).toBeDefined();
  });

  it("renders daily message volume table with date entries", async () => {
    render(<AnalyticsView orgId={orgId} />);

    await waitFor(() => {
      expect(screen.getByText("2026-08-28")).toBeDefined();
      expect(screen.getByText("2026-08-29")).toBeDefined();
    });
  });

  it("triggers CSV compliance report export on button click", async () => {
    render(<AnalyticsView orgId={orgId} />);

    await waitFor(() => {
      expect(screen.getByText("📥 Export Compliance CSV")).toBeDefined();
    });

    const exportBtn = screen.getByText("📥 Export Compliance CSV");
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/organizations/${orgId}/analytics/export`),
        expect.objectContaining({ method: "POST" })
      );
    });
  });
});
