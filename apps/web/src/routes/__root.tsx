import { createRootRoute, Outlet, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { useAuth } from "../features/auth/context.js";
import { useRealtimeSync } from "../realtime.js";
import { handleRealtimeHint, handleRealtimeReconciliation } from "../lib/realtime-adapter.js";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeHint } from "@flowdesk/contracts";

function FlowDeskIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 10h.01" />
      <path d="M12 10h.01" />
      <path d="M16 10h.01" />
    </svg>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: RootNotFoundComponent,
  errorComponent: RootErrorComponent
});

function RootNotFoundComponent() {
  return (
    <div
      className="glass-card"
      style={{ padding: "3rem", textAlign: "center", maxWidth: 500, margin: "4rem auto" }}
    >
      <h2 className="section-title">404 — Page Not Found</h2>
      <p className="section-subtitle" style={{ margin: "1rem 0 2rem" }}>
        The page you requested could not be found or has moved.
      </p>
      <Link to="/inbox" className="btn btn-primary">
        Return to Inbox
      </Link>
    </div>
  );
}

function RootErrorComponent({ error }: { error: unknown }) {
  return (
    <div
      className="glass-card"
      style={{ padding: "3rem", textAlign: "center", maxWidth: 500, margin: "4rem auto" }}
    >
      <h2 className="section-title">An unexpected error occurred</h2>
      <p className="section-subtitle" style={{ margin: "1rem 0 2rem" }}>
        {error instanceof Error ? error.message : "A client routing or rendering error occurred."}
      </p>
      <button type="button" onClick={() => window.location.reload()} className="btn btn-primary">
        Reload Application
      </button>
    </div>
  );
}

function RootComponent() {
  const {
    sessionUser,
    loading,
    organizations,
    selectedOrgId,
    activeOrg,
    currentRole,
    errorMsg,
    successMsg,
    inviteToken,
    acceptingInvite,
    bootstrapping,
    showToast,
    setSelectedOrgId,
    handleLogout,
    handleBootstrap,
    handleAcceptInvite,
    checkPermission
  } = useAuth();

  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Update document title on route transitions
  useEffect(() => {
    let title = "FlowDesk";
    if (pathname.startsWith("/inbox")) title = "FlowDesk — Inbox";
    else if (pathname.startsWith("/analytics")) title = "FlowDesk — Analytics";
    else if (pathname.startsWith("/knowledge")) title = "FlowDesk — AI Knowledge";
    else if (pathname.startsWith("/channels")) title = "FlowDesk — WhatsApp Channels";
    else if (pathname.startsWith("/developer")) title = "FlowDesk — Developer APIs";
    else if (pathname.startsWith("/team")) title = "FlowDesk — Team Settings";
    else if (pathname.startsWith("/audit")) title = "FlowDesk — Audit Log";
    else if (pathname.startsWith("/settings/workspace")) title = "FlowDesk — Workspace";
    document.title = title;
  }, [pathname]);

  // Realtime hook integration
  useRealtimeSync({
    organizationId: selectedOrgId,
    enabled: Boolean(selectedOrgId),
    onHint: (hint: RealtimeHint) => handleRealtimeHint(queryClient, hint),
    onReconcile: () => {
      if (selectedOrgId) {
        handleRealtimeReconciliation(queryClient, selectedOrgId);
      }
    },
    onAccessRevoked: (data) => {
      showToast(`Access revoked: ${data.code}`, true);
    }
  });

  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [orgSlugManuallyEdited, setOrgSlugManuallyEdited] = useState(false);

  const orgSelectId = useId();
  const newOrgNameId = useId();
  const newOrgSlugId = useId();

  // 1. Loading State
  if (loading) {
    return (
      <div className="login-wrap">
        <div className="glass-card login-card" role="status" aria-live="polite">
          <div className="login-icon">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="16" />
            </svg>
          </div>
          <h2 className="login-title">Loading FlowDesk…</h2>
          <p className="login-desc">Verifying secure tenant session</p>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated Login Screen
  if (!sessionUser) {
    return (
      <div className="login-wrap">
        <div className="glass-card login-card">
          <div
            className="login-icon"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            <FlowDeskIcon size={32} />
          </div>
          <h1 className="login-title">FlowDesk</h1>
          <p className="login-desc">Sign in to your enterprise customer operations cockpit.</p>
          <a href="/api/v1/auth/login" className="btn btn-primary login-btn" id="login-btn">
            Sign In with Enterprise SSO
          </a>
        </div>
      </div>
    );
  }

  // 3. Pending Invitation State
  if (inviteToken) {
    return (
      <div className="login-wrap">
        <div className="glass-card login-card">
          <div className="login-icon">✉️</div>
          <h2 className="login-title">Invitation Received</h2>
          <p className="login-desc">You have been invited to collaborate with an organization.</p>
          <button
            type="button"
            onClick={() => void handleAcceptInvite()}
            disabled={acceptingInvite}
            className="btn btn-primary login-btn"
            id="accept-invitation-btn"
          >
            {acceptingInvite ? "Joining…" : "Accept Invitation & Join"}
          </button>
        </div>
      </div>
    );
  }

  // 4. Onboarding / Bootstrap Screen
  if (organizations.length === 0) {
    return (
      <div className="login-wrap">
        <main className="glass-card login-card" style={{ maxWidth: 440 }}>
          <div
            className="login-icon"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            <FlowDeskIcon size={32} />
          </div>
          <h1 className="login-title">Create your organization</h1>
          <p className="login-desc">
            Welcome, {sessionUser.displayName}. To begin, create your first organization workspace
            to establish your isolated tenant boundary.
          </p>

          <div style={{ textAlign: "left", marginTop: "1.5rem" }}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newOrgName.trim() || !newOrgSlug.trim()) return;
                void handleBootstrap(newOrgName.trim(), newOrgSlug.trim().toLowerCase());
              }}
            >
              <div className="form-group">
                <label className="form-label" htmlFor={newOrgNameId}>
                  Organization Name
                </label>
                <input
                  id={newOrgNameId}
                  type="text"
                  required
                  placeholder="e.g. Acme Support"
                  value={newOrgName}
                  onChange={(e) => {
                    setNewOrgName(e.target.value);
                    if (!orgSlugManuallyEdited) {
                      setNewOrgSlug(
                        e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, "-")
                          .replace(/^-|-$/g, "")
                      );
                    }
                  }}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor={newOrgSlugId}>
                  Organization Slug
                </label>
                <input
                  id={newOrgSlugId}
                  type="text"
                  required
                  placeholder="e.g. acme-support"
                  value={newOrgSlug}
                  onChange={(e) => {
                    setOrgSlugManuallyEdited(true);
                    setNewOrgSlug(e.target.value.toLowerCase());
                  }}
                  className="form-input"
                />
              </div>
              <button
                type="submit"
                disabled={bootstrapping}
                className="btn btn-primary"
                style={{ width: "100%", justifyContent: "center" }}
                id="create-org-btn"
              >
                {bootstrapping ? "Provisioning…" : "Create Organization"}
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  const canViewAudit = checkPermission("audit:view");

  return (
    <div className="app-container">
      {/* Top Bar */}
      <header className="top-nav">
        <div className="brand-section">
          <span className="logo-badge">
            <span className="logo-icon" style={{ display: "inline-flex", alignItems: "center" }}>
              <FlowDeskIcon size={20} />
            </span>
            FlowDesk
          </span>

          {/* Org Switcher */}
          <div className="org-picker-wrap">
            {organizations.length > 1 ? (
              <>
                <label
                  htmlFor={orgSelectId}
                  className="visually-hidden"
                  style={{
                    position: "absolute",
                    width: 1,
                    height: 1,
                    overflow: "hidden",
                    clip: "rect(0,0,0,0)"
                  }}
                >
                  Select Organization
                </label>
                <select
                  id={orgSelectId}
                  value={selectedOrgId ?? ""}
                  onChange={(e) => setSelectedOrgId(e.target.value)}
                  className="org-select"
                  aria-label="Switch organization"
                >
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} ({org.role})
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <span className="org-badge" id="active-org-badge">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
                {activeOrg?.name}
              </span>
            )}
          </div>
        </div>

        <div className="user-controls">
          <span className="user-badge">
            <span className="user-avatar">{sessionUser.displayName.charAt(0)}</span>
            <span>{sessionUser.displayName}</span>
            <span className={`role-pill ${currentRole}`} id="user-role-badge">
              {currentRole.replace("_", " ")}
            </span>
          </span>
          <button
            type="button"
            onClick={() => {
              void handleLogout();
            }}
            className="btn btn-secondary btn-sm"
            id="logout-btn"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Sub Navigation (File-based Route Links) */}
      <nav className="sub-nav" aria-label="Workspace Sections">
        <Link
          to="/inbox"
          className="tab-btn"
          activeProps={{ className: "tab-btn active" }}
          id="tab-conversations"
          data-testid="tab-conversations"
        >
          Inbox
        </Link>
        <Link
          to="/analytics"
          className="tab-btn"
          activeProps={{ className: "tab-btn active" }}
          id="tab-analytics"
          data-testid="tab-analytics"
        >
          Analytics & SLA
        </Link>
        <Link
          to="/knowledge"
          className="tab-btn"
          activeProps={{ className: "tab-btn active" }}
          id="tab-knowledge"
          data-testid="tab-knowledge"
        >
          AI Knowledge
        </Link>
        <Link
          to="/settings/workspace"
          className="tab-btn"
          activeProps={{ className: "tab-btn active" }}
          id="tab-workspace"
        >
          Workspace
        </Link>
        <Link
          to="/channels"
          className="tab-btn"
          activeProps={{ className: "tab-btn active" }}
          id="tab-channels"
          data-testid="tab-channels"
        >
          WhatsApp Channels
        </Link>
        <Link
          to="/developer/api-keys"
          className="tab-btn"
          activeProps={{ className: "tab-btn active" }}
          id="tab-developer"
          data-testid="tab-developer"
        >
          Developer API & Webhooks
        </Link>
        <Link
          to="/team"
          className="tab-btn"
          activeProps={{ className: "tab-btn active" }}
          id="tab-team"
        >
          Team Settings
        </Link>
        {canViewAudit && (
          <Link
            to="/audit"
            className="tab-btn"
            activeProps={{ className: "tab-btn active" }}
            id="tab-audit"
          >
            Audit Log
          </Link>
        )}
      </nav>

      {/* Main Content Area */}
      <main className="main-content" id="main-content">
        {errorMsg && (
          <div className="toast-banner toast-error" role="alert">
            <span>{errorMsg}</span>
            <button type="button" onClick={() => showToast("", false)} className="btn btn-sm">
              ✕
            </button>
          </div>
        )}
        {successMsg && (
          <div className="toast-banner toast-success" role="status">
            <span>{successMsg}</span>
            <button type="button" onClick={() => showToast("", false)} className="btn btn-sm">
              ✕
            </button>
          </div>
        )}

        <Outlet />
      </main>
    </div>
  );
}
