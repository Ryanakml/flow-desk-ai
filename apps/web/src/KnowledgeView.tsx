import { useCallback, useEffect, useState } from "react";
import type { BotConfigResponse, KnowledgeSourceResponse } from "@flowdesk/contracts";
import {
  createKnowledgeSourceApi,
  getBotConfig,
  listKnowledgeSourcesApi,
  updateBotConfig
} from "./api.js";

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

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

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

  useEffect(() => {
    if (!sources.some((source) => source.status === "queued" || source.status === "processing")) {
      return;
    }
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [refresh, sources]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !content.trim()) return;
    try {
      setSubmitting(true);
      await createKnowledgeSourceApi(
        orgId,
        type === "text"
          ? { type, name: name.trim(), content: content.trim() }
          : { type, name: name.trim(), url: content.trim() }
      );
      setName("");
      setContent("");
      showToast("Knowledge source queued for secure indexing.", "success");
      await refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to add knowledge source", "error");
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
              disabled={!canManage || savingMode}
              onChange={(event) => setSelectedMode(event.target.value as "off" | "draft" | "auto")}
            >
              <option value="off">OFF — no AI generation</option>
              <option value="draft">DRAFT — human review required</option>
              <option value="auto">AUTO — eligible replies send automatically</option>
            </select>
            {selectedMode === "auto" && (
              <p role="alert" style={{ marginTop: "0.5rem", color: "var(--color-warning)" }}>
                AUTO is opt-in. Low-confidence, stale, paused, assigned, disabled, or out-of-window
                conversations remain blocked.
              </p>
            )}
            {canManage && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={savingMode || selectedMode === botConfig.mode}
                onClick={() => void saveMode()}
              >
                {savingMode ? "Saving…" : `Save ${selectedMode.toUpperCase()} mode`}
              </button>
            )}
          </div>
        ) : (
          <p role="status">Loading bot configuration…</p>
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
