import * as React from "react";
import { FlowDeskIcon } from "../../components/layout/AppSidebar.js";
import { useAuth } from "../auth/context.js";

export function InvitationView() {
  const { sessionUser, errorMsg, acceptingInvite, handleLogout, handleAcceptInvite } = useAuth();

  return (
    <div className="app-container">
      <header className="top-nav">
        <div className="brand-section">
          <span className="logo-badge">
            <span className="logo-icon" style={{ display: "inline-flex", alignItems: "center" }}>
              <FlowDeskIcon size={20} />
            </span>
            FlowDesk
          </span>
        </div>
        <div className="user-controls">
          <span className="user-badge">
            <span className="user-avatar">{sessionUser?.displayName.charAt(0) ?? "U"}</span>
            {sessionUser?.displayName}
          </span>
          <button
            type="button"
            onClick={() => {
              void handleLogout();
            }}
            className="btn btn-secondary btn-sm"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="main-content">
        {errorMsg && <div className="toast-banner toast-error">{errorMsg}</div>}
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
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </div>
          <h2 className="empty-title">Organization Invitation</h2>
          <p className="empty-desc">
            You have been invited to join an organization workspace. Accept the invitation to access
            conversations and collaborate with your team.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => void handleAcceptInvite()}
              disabled={acceptingInvite}
              className="btn btn-primary"
            >
              {acceptingInvite ? "Accepting…" : "Accept invitation"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
