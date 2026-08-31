import { useCallback, useEffect, useState } from "react";
import type { KnowledgeSourceResponse } from "@flowdesk/contracts";
import { createKnowledgeSourceApi, listKnowledgeSourcesApi } from "./api.js";

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
    <div className="glass-card" data-testid="knowledge-view">
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
  );
}
