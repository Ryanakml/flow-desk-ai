import { useAuth } from "../auth/context.js";
import { Link } from "@tanstack/react-router";

export function WorkspaceView() {
  const { activeOrg, checkPermission } = useAuth();
  const canInvite = checkPermission("membership:invite");

  return (
    <div className="glass-card empty-state">
      <div className="empty-icon-wrap">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <h2 className="empty-title">Inbox is clear</h2>
      <p className="empty-desc">
        No active conversations or tickets yet. Your secure tenant boundary in{" "}
        <strong>{activeOrg?.name}</strong> is verified and ready.
      </p>
      {canInvite && (
        <Link to="/team" className="btn btn-primary" id="workspace-invite-team-btn">
          Invite team members
        </Link>
      )}
    </div>
  );
}
