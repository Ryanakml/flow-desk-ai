import { useState, useEffect, useCallback } from "react";
import type { AuditLogEntry, PageInfo } from "@flowdesk/contracts";
import { listAuditLogs } from "../../api.js";
import { useAuth } from "../auth/context.js";

export function AuditView() {
  const { selectedOrgId, activeOrg, checkPermission, showToast } = useAuth();
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditPageInfo, setAuditPageInfo] = useState<PageInfo | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const canViewAudit = checkPermission("audit:view");

  const loadAudit = useCallback(
    async (orgId: string, cursor?: string) => {
      try {
        setLoadingAudit(true);
        const res = await listAuditLogs(orgId, { cursor });
        setAuditLogs(res.items);
        setAuditPageInfo(res.pageInfo);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Failed to load audit logs", true);
      } finally {
        setLoadingAudit(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    if (selectedOrgId && canViewAudit) {
      void loadAudit(selectedOrgId);
    }
  }, [selectedOrgId, canViewAudit, loadAudit]);

  if (!canViewAudit) {
    return (
      <div className="glass-card" style={{ padding: "2rem", textAlign: "center" }}>
        <h2 className="section-title">403 — Access Forbidden</h2>
        <p className="section-subtitle">You do not have permission to view the audit log.</p>
      </div>
    );
  }

  return (
    <div className="glass-card">
      <div className="section-header">
        <div>
          <h2 className="section-title">Audit Trail</h2>
          <p className="section-subtitle">Tamper-evident event log for {activeOrg?.name}.</p>
        </div>
      </div>

      {loadingAudit ? (
        <div style={{ textAlign: "center", padding: "2rem" }}>Loading audit records…</div>
      ) : auditLogs.length === 0 ? (
        <p style={{ textAlign: "center", padding: "2rem", color: "var(--color-text-muted)" }}>
          No audit events recorded yet.
        </p>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Target</th>
                <th>Actor</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td style={{ whiteSpace: "nowrap", color: "var(--color-text-muted)" }}>
                    {new Date(log.occurredAt).toLocaleString()}
                  </td>
                  <td>
                    <span className="code-pill">{log.action}</span>
                  </td>
                  <td>
                    {log.targetType}
                    {log.targetId && (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--color-text-muted)",
                          display: "block"
                        }}
                      >
                        {log.targetId.slice(0, 8)}…
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="user-pill">
                      {log.actorUserId ? log.actorUserId.slice(0, 8) : "system"}
                    </span>
                  </td>
                  <td>
                    <pre
                      style={{
                        margin: 0,
                        fontSize: "0.75rem",
                        maxHeight: "3.5rem",
                        overflow: "hidden"
                      }}
                    >
                      {JSON.stringify(log.metadata)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {auditPageInfo?.endCursor && auditPageInfo.hasNextPage && (
            <div style={{ padding: "1rem", textAlign: "center" }}>
              <button
                type="button"
                onClick={() =>
                  selectedOrgId && void loadAudit(selectedOrgId, auditPageInfo.endCursor!)
                }
                className="btn btn-secondary btn-sm"
              >
                Load More
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
