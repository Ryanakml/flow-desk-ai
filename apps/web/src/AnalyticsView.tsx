import { useEffect, useState } from "react";
import {
  type AnalyticsMetricsClientResponse,
  exportAnalyticsReportApi,
  getAnalyticsMetricsApi
} from "./api.js";

export interface AnalyticsViewProps {
  orgId: string;
}

export function AnalyticsView({ orgId }: AnalyticsViewProps) {
  const [data, setData] = useState<AnalyticsMetricsClientResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [timeRange, setTimeRange] = useState<number>(30);

  useEffect(() => {
    let cancelled = false;
    async function loadMetrics() {
      setLoading(true);
      setError(null);
      try {
        const res = await getAnalyticsMetricsApi(orgId, timeRange);
        if (!cancelled) {
          setData(res);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load analytics metrics");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadMetrics();
    return () => {
      cancelled = true;
    };
  }, [orgId, timeRange]);

  const handleExportCSV = async () => {
    setExporting(true);
    try {
      const blob = await exportAnalyticsReportApi(orgId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `flowdesk-analytics-${orgId}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setExporting(false);
    }
  };

  if (loading && !data) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
        <p>Loading real-time analytics data...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div
        style={{
          padding: 24,
          margin: 24,
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: 8,
          color: "#991b1b"
        }}
      >
        <h3 style={{ margin: "0 0 8px 0" }}>Analytics Unavailable</h3>
        <p style={{ margin: 0 }}>{error}</p>
      </div>
    );
  }

  const overview = data?.overview ?? {
    totalConversations: 0,
    openConversations: 0,
    assignedConversations: 0,
    resolvedConversations: 0,
    totalMessages: 0,
    inboundMessages: 0,
    outboundMessages: 0,
    botMessages: 0,
    humanMessages: 0,
    botAutomationRate: 0,
    slaMetPercentage: 0,
    avgFirstResponseTimeSeconds: 0,
    avgResolutionTimeSeconds: 0
  };

  const volumeSeries = data?.volumeSeries ?? [];

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
          flexWrap: "wrap",
          gap: 16
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#0f172a" }}>
            Real-Time Analytics & SLA Engine
          </h2>
          <p style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: 14 }}>
            Monitor operational conversation throughput, bot automation efficiency, and SLA
            compliance metrics.
          </p>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(Number(e.target.value))}
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              fontSize: 14,
              cursor: "pointer"
            }}
          >
            <option value={7}>Last 7 Days</option>
            <option value={14}>Last 14 Days</option>
            <option value={30}>Last 30 Days</option>
          </select>

          <button
            onClick={() => {
              void handleExportCSV();
            }}
            disabled={exporting}
            style={{
              padding: "8px 16px",
              background: "#2563eb",
              color: "#ffffff",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: exporting ? "not-allowed" : "pointer",
              opacity: exporting ? 0.7 : 1,
              display: "flex",
              alignItems: "center",
              gap: 8
            }}
          >
            {exporting ? "Generating CSV..." : "📥 Export Compliance CSV"}
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
          marginBottom: 32
        }}
      >
        {/* Total Conversations */}
        <div
          style={{
            background: "#ffffff",
            padding: 20,
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
          }}
        >
          <div style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>TOTAL CONVERSATIONS</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: "#0f172a", marginTop: 8 }}>
            {overview.totalConversations}
          </div>
          <div style={{ fontSize: 12, color: "#16a34a", marginTop: 4 }}>
            {overview.resolvedConversations} resolved ({overview.openConversations} active)
          </div>
        </div>

        {/* Bot Automation Rate */}
        <div
          style={{
            background: "#ffffff",
            padding: 20,
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
          }}
        >
          <div style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>BOT AUTOMATION RATE</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: "#2563eb", marginTop: 8 }}>
            {overview.botAutomationRate}%
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
            {overview.botMessages} bot responses auto-dispatched
          </div>
        </div>

        {/* SLA Compliance Rate */}
        <div
          style={{
            background: "#ffffff",
            padding: 20,
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
          }}
        >
          <div style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>SLA COMPLIANCE</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: "#16a34a", marginTop: 8 }}>
            {overview.slaMetPercentage}%
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
            Avg response: {overview.avgFirstResponseTimeSeconds}s
          </div>
        </div>

        {/* Avg Resolution Speed */}
        <div
          style={{
            background: "#ffffff",
            padding: 20,
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
          }}
        >
          <div style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>AVG RESOLUTION TIME</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: "#0f172a", marginTop: 8 }}>
            {Math.round(overview.avgResolutionTimeSeconds / 60)}m
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
            {overview.humanMessages} human agent responses
          </div>
        </div>
      </div>

      {/* Volume Breakdown & Daily Trends */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 24 }}>
        <div
          style={{
            background: "#ffffff",
            padding: 24,
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
          }}
        >
          <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
            Daily Message Volume & Automation Breakdown
          </h3>

          {volumeSeries.length === 0 ? (
            <p style={{ color: "#64748b", fontStyle: "italic", margin: 0 }}>
              No message activity recorded for the selected date range.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 14,
                  textAlign: "left"
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "2px solid #e2e8f0", color: "#64748b" }}>
                    <th style={{ padding: "10px 12px" }}>Date</th>
                    <th style={{ padding: "10px 12px" }}>Inbound Messages</th>
                    <th style={{ padding: "10px 12px" }}>Outbound Messages</th>
                    <th style={{ padding: "10px 12px" }}>Bot Handled</th>
                    <th style={{ padding: "10px 12px" }}>Automation Share</th>
                  </tr>
                </thead>
                <tbody>
                  {volumeSeries.map((pt) => {
                    const dayTotal = pt.inbound + pt.outbound;
                    const share = dayTotal > 0 ? Math.round((pt.bot / dayTotal) * 100) : 0;
                    return (
                      <tr key={pt.date} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "12px", fontWeight: 600, color: "#0f172a" }}>
                          {pt.date}
                        </td>
                        <td style={{ padding: "12px", color: "#2563eb" }}>{pt.inbound}</td>
                        <td style={{ padding: "12px", color: "#16a34a" }}>{pt.outbound}</td>
                        <td style={{ padding: "12px", color: "#9333ea" }}>{pt.bot}</td>
                        <td style={{ padding: "12px", color: "#64748b" }}>
                          <span
                            style={{
                              padding: "2px 8px",
                              borderRadius: 12,
                              background: "#f1f5f9",
                              fontSize: 12,
                              fontWeight: 600
                            }}
                          >
                            {share}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
