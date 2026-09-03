import { useCallback, useEffect, useState } from "react";
import type {
  BotConfigResponse,
  KnowledgeSourceResponse,
  AutomationPolicyResponse,
  SimulatePolicyResponse
} from "@flowdesk/contracts";
import {
  createKnowledgeSourceApi,
  getBotConfig,
  listKnowledgeSourcesApi,
  updateBotConfig
} from "./api.js";
import {
  setAutomationEmergencyStop,
  fetchAutomationPolicies,
  publishAutomationPolicy,
  simulateAutomationPolicy
} from "./automation-api.js";

export interface KnowledgeViewProps {
  orgId: string;
  canManage: boolean;
  showToast: (message: string, type?: "success" | "error") => void;
}

export function KnowledgeView({ orgId, canManage, showToast }: KnowledgeViewProps) {
  const [sources, setSources] = useState<KnowledgeSourceResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [type, setType] = useState<"text" | "url">("text");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [botConfig, setBotConfig] = useState<BotConfigResponse | null>(null);
  const [selectedMode, setSelectedMode] = useState<"off" | "draft" | "auto">("draft");
  const [savingMode, setSavingMode] = useState(false);
  const [savingEmergencyStop, setSavingEmergencyStop] = useState(false);

  // Policy & Simulator state
  const [policies, setPolicies] = useState<AutomationPolicyResponse[]>([]);
  const [activePolicy, setActivePolicy] = useState<AutomationPolicyResponse | null>(null);
  const [draftPolicy, setDraftPolicy] = useState<AutomationPolicyResponse | null>(null);
  const [publishingPolicy, setPublishingPolicy] = useState(false);
  const [simIntent, setSimIntent] = useState("");
  const [simTag, setSimTag] = useState("");
  const [simHours, setSimHours] = useState(true);
  const [simConsent, setSimConsent] = useState(true);
  const [simulationResult, setSimulationResult] = useState<SimulatePolicyResponse | null>(null);
  const [simulating, setSimulating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await listKnowledgeSourcesApi(orgId);
      setSources(result.sources);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to load knowledge sources",
        "error"
      );
    } finally {
      setLoading(false);
    }
  }, [orgId, showToast]);

  const refreshPolicies = useCallback(async () => {
    try {
      const list = await fetchAutomationPolicies(orgId);
      setPolicies(list);
      setActivePolicy(list.find((p) => p.status === "published") ?? null);
      setDraftPolicy(list.find((p) => p.status === "draft") ?? null);
    } catch {
      // ignore
    }
  }, [orgId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    void refreshPolicies();
  }, [refresh, refreshPolicies]);

  useEffect(() => {
    void getBotConfig(orgId)
      .then((config) => {
        setBotConfig(config);
        setSelectedMode(config.mode);
      })
      .catch((error: unknown) =>
        showToast(
          error instanceof Error ? error.message : "Failed to load bot configuration",
          "error"
        )
      );
  }, [orgId, showToast]);

  const saveMode = async () => {
    try {
      setSavingMode(true);
      const updated = await updateBotConfig(orgId, { mode: selectedMode });
      setBotConfig(updated);
      showToast(
        selectedMode === "auto"
          ? "AUTO enabled. Eligible grounded inbound replies may now send automatically."
          : `Bot mode changed to ${selectedMode.toUpperCase()}.`,
        "success"
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to update bot mode", "error");
    } finally {
      setSavingMode(false);
    }
  };

  const toggleEmergencyStop = async () => {
    if (!botConfig) return;
    const nextDisabled = !botConfig.emergencyDisabled;
    try {
      setSavingEmergencyStop(true);
      const updated = await setAutomationEmergencyStop(orgId, nextDisabled);
      setBotConfig((current) =>
        current ? { ...current, emergencyDisabled: updated.emergencyDisabled } : current
      );
      showToast(
        updated.emergencyDisabled
          ? "Emergency stop engaged. Pending and new automated sends are halted."
          : "Emergency stop cleared. Automation resumed.",
        "success"
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to update emergency stop",
        "error"
      );
    } finally {
      setSavingEmergencyStop(false);
    }
  };

  const handlePublishDraft = async () => {
    if (!draftPolicy) return;
    try {
      setPublishingPolicy(true);
      await publishAutomationPolicy(orgId, draftPolicy.id, "Published from web dashboard");
      showToast("Automation policy published successfully.", "success");
      void refreshPolicies();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to publish policy", "error");
    } finally {
      setPublishingPolicy(false);
    }
  };

  const handleRunSimulation = async () => {
    try {
      setSimulating(true);
      const res = await simulateAutomationPolicy(orgId, {
        context: {
          intent: simIntent.trim() || undefined,
          tags: simTag.trim() ? [simTag.trim()] : undefined,
          isWithinBusinessHours: simHours,
          customerConsentGiven: simConsent
        }
      });
      setSimulationResult(res);
      showToast("Policy simulation completed.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Simulation failed", "error");
    } finally {
      setSimulating(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      setSubmitting(true);
      if (type === "text") {
        await createKnowledgeSourceApi(orgId, {
          type: "text",
          name: name.trim(),
          content: content.trim()
        });
      } else {
        await createKnowledgeSourceApi(orgId, {
          type: "url",
          name: name.trim(),
          url: content.trim()
        });
      }
      setName("");
      setContent("");
      showToast("Knowledge source queued for indexing", "success");
      void refresh();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to create knowledge source",
        "error"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-testid="knowledge-view">
      <div className="glass-card" style={{ marginBottom: "1rem" }}>
        <div className="section-header">
          <div>
            <h2 className="section-title">AI Automation</h2>
            <p className="section-subtitle">
              OFF disables AI, DRAFT requires human approval, and AUTO may send only grounded,
              policy-eligible replies through the standard WhatsApp delivery queue.
            </p>
          </div>
        </div>
        {botConfig ? (
          <div className="form-group">
            <label className="form-label" htmlFor="bot-mode">
              Bot mode
            </label>
            <select
              id="bot-mode"
              className="form-select"
              value={selectedMode}
              disabled={!canManage || savingMode || botConfig.emergencyDisabled}
              onChange={(event) => setSelectedMode(event.target.value as "off" | "draft" | "auto")}
            >
              <option value="off">OFF — no AI generation</option>
              <option value="draft">DRAFT — human review required</option>
              <option value="auto">AUTO — eligible replies send automatically</option>
            </select>
            {selectedMode === "auto" && !botConfig.emergencyDisabled && (
              <p role="alert" style={{ marginTop: "0.5rem", color: "var(--color-warning)" }}>
                AUTO is opt-in. Low-confidence, stale, paused, assigned, disabled, or out-of-window
                conversations remain blocked.
              </p>
            )}
            {botConfig.emergencyDisabled && (
              <p role="alert" style={{ marginTop: "0.5rem", color: "var(--color-warning)" }}>
                Emergency stop is active. Pending and new automated sends are blocked while manual
                agent replies remain available.
              </p>
            )}
            {canManage && (
              <div
                style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}
              >
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    savingMode || botConfig.emergencyDisabled || selectedMode === botConfig.mode
                  }
                  onClick={() => void saveMode()}
                >
                  {savingMode ? "Saving…" : `Save ${selectedMode.toUpperCase()} mode`}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="automation-emergency-stop"
                  disabled={savingEmergencyStop}
                  onClick={() => void toggleEmergencyStop()}
                >
                  {savingEmergencyStop
                    ? "Updating…"
                    : botConfig.emergencyDisabled
                      ? "Resume automation"
                      : "Emergency stop"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <p role="status">Loading bot configuration…</p>
        )}
      </div>

      {/* M5 #180: Automation Policy Configuration & Simulator */}
      <div
        className="glass-card"
        style={{ marginBottom: "1rem" }}
        data-testid="automation-policy-section"
      >
        <div className="section-header">
          <div>
            <h2 className="section-title">Automation Policy Engine & Simulator</h2>
            <p className="section-subtitle">
              Configure deterministic routing and auto-send policies with fail-closed safety,
              conflict detection, and versioned promotion.
            </p>
          </div>
          {draftPolicy && canManage && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={publishingPolicy}
              onClick={() => void handlePublishDraft()}
            >
              {publishingPolicy ? "Publishing…" : `Publish Draft v${draftPolicy.version}`}
            </button>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div>
            <h3>Policy Status</h3>
            <p>
              <strong>Active Version:</strong>{" "}
              {activePolicy
                ? `v${activePolicy.version} (${activePolicy.rules.length} rules)`
                : "No active policy"}
            </p>
            {draftPolicy && (
              <p>
                <strong>Draft Version:</strong> v{draftPolicy.version} ({draftPolicy.rules.length}{" "}
                rules)
              </p>
            )}
            <p>
              <strong>Total Versions:</strong> {policies.length}
            </p>
          </div>

          <div>
            <h3>Policy Simulator</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <input
                className="form-input"
                placeholder="Test Intent (e.g. support, billing)"
                value={simIntent}
                onChange={(e) => setSimIntent(e.target.value)}
              />
              <input
                className="form-input"
                placeholder="Test Tag (e.g. vip, urgent)"
                value={simTag}
                onChange={(e) => setSimTag(e.target.value)}
              />
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={simHours}
                  onChange={(e) => setSimHours(e.target.checked)}
                />
                Within Business Hours
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={simConsent}
                  onChange={(e) => setSimConsent(e.target.checked)}
                />
                Customer Consent Confirmed
              </label>
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="policy-simulator-btn"
                disabled={simulating}
                onClick={() => void handleRunSimulation()}
              >
                {simulating ? "Simulating…" : "Run Simulation"}
              </button>
            </div>
          </div>
        </div>

        {simulationResult && (
          <div
            data-testid="policy-simulator-results"
            style={{
              marginTop: "1rem",
              padding: "0.75rem",
              background: "rgba(0,0,0,0.03)",
              borderRadius: "4px"
            }}
          >
            <h4>Simulation Output</h4>
            <p>
              <strong>Decision:</strong> {simulationResult.action.toUpperCase()} —{" "}
              {simulationResult.reason}
            </p>
            {simulationResult.matchedRule && (
              <p>
                <strong>Matched Rule:</strong> {simulationResult.matchedRule.name} (Priority{" "}
                {simulationResult.matchedRule.priority})
              </p>
            )}
            {simulationResult.conflicts.length > 0 && (
              <div style={{ color: "var(--color-danger, #d32f2f)", marginTop: "0.5rem" }}>
                <strong>Detected Conflicts:</strong>
                <ul>
                  {simulationResult.conflicts.map((c, i) => (
                    <li key={i}>
                      [{c.type}] {c.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{ marginTop: "0.5rem" }}>
              <strong>
                Decision Trace ({simulationResult.decisionTrace.length} rules evaluated):
              </strong>
              <ul style={{ paddingLeft: "1.2rem", fontSize: "0.9rem" }}>
                {simulationResult.decisionTrace.map((t) => (
                  <li key={t.ruleId}>
                    {t.matched ? "✓" : "✗"} <strong>{t.ruleName}</strong> (priority {t.priority}):{" "}
                    {t.reason}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="glass-card">
        <div className="section-header">
          <div>
            <h2 className="section-title">AI Knowledge</h2>
            <p className="section-subtitle">
              Add trusted text or a public website. Drafts use only ready tenant-scoped sources.
            </p>
          </div>
        </div>

        {canManage && (
          <form onSubmit={(event) => void submit(event)}>
            <div className="form-group">
              <label className="form-label" htmlFor="knowledge-type">
                Source type
              </label>
              <select
                id="knowledge-type"
                className="form-select"
                value={type}
                onChange={(event) => {
                  setType(event.target.value as "text" | "url");
                  setContent("");
                }}
              >
                <option value="text">Text</option>
                <option value="url">Public URL</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="knowledge-name">
                Name
              </label>
              <input
                id="knowledge-name"
                className="form-input"
                value={name}
                maxLength={200}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="knowledge-content">
                {type === "text" ? "Knowledge text" : "Public URL"}
              </label>
              {type === "text" ? (
                <textarea
                  id="knowledge-content"
                  className="form-input"
                  rows={8}
                  value={content}
                  required
                  onChange={(event) => setContent(event.target.value)}
                />
              ) : (
                <input
                  id="knowledge-content"
                  className="form-input"
                  type="url"
                  placeholder="https://docs.example.com/help"
                  value={content}
                  required
                  onChange={(event) => setContent(event.target.value)}
                />
              )}
            </div>
            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {submitting ? "Queueing…" : "Add knowledge"}
            </button>
          </form>
        )}

        <div className="table-container" style={{ marginTop: "1.5rem" }}>
          {loading ? (
            <p role="status">Loading knowledge…</p>
          ) : sources.length === 0 ? (
            <p>No knowledge sources yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <tr key={source.id}>
                    <td>
                      <strong>{source.name}</strong>
                    </td>
                    <td>{source.type}</td>
                    <td>
                      <span data-status={source.status}>{source.status}</span>
                    </td>
                    <td>
                      {source.statusReason ??
                        (source.lastIndexedAt
                          ? new Date(source.lastIndexedAt).toLocaleString()
                          : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
