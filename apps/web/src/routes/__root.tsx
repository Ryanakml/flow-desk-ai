import { createRootRoute, Outlet, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { useAuth } from "../features/auth/context.js";

function FlowDeskIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id="fdGradIcon"
          x1="4"
          y1="4"
          x2="28"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#10B981" />
          <stop offset="100%" stopColor="#0EA5E9" />
        </linearGradient>
      </defs>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M16 3C8.8203 3 3 8.8203 3 16C3 18.73 3.84 21.26 5.28 23.36L3.25 28.75L8.79 26.89C10.82 28.24 13.31 29 16 29C23.1797 29 29 23.1797 29 16C29 8.8203 23.1797 3 16 3ZM10.5 9.5C10.5 8.67157 11.1716 8 12 8H21C21.8284 8 22.5 8.67157 22.5 9.5C22.5 10.3284 21.8284 11 21 11H14.5V13.5H19.5C20.3284 13.5 21 14.1716 21 15C21 15.8284 20.3284 16.5 19.5 16.5H14.5V22.5C14.5 23.3284 13.8284 24 13 24C12.1716 24 11.5 23.3284 11.5 22.5V16.5H12C11.1716 16.5 10.5 15.8284 10.5 15V9.5Z"
        fill="url(#fdGradIcon)"
      />
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
  if (process.env["NODE_ENV"] !== "production") {
    console.error("Router error:", error);
  }
  return (
    <div
      className="glass-card"
      style={{ padding: "3rem", textAlign: "center", maxWidth: 500, margin: "4rem auto" }}
    >
      <h2 className="section-title">An unexpected error occurred</h2>
      <p className="section-subtitle" style={{ margin: "1rem 0 2rem" }}>
        A client application error occurred. Please reload or return to the inbox.
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
          <p className="login-subtitle">Verifying secure tenant session</p>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated Login Screen
  if (!sessionUser) {
    return (
      <div className="login-wrap">
        <div className="glass-card login-card">
          <div className="login-icon" style={{ background: "transparent", border: "none" }}>
            <FlowDeskIcon size={40} />
          </div>
          <h1 className="login-title">FlowDesk</h1>
          <p className="login-subtitle">AI-first customer operations platform</p>
          <a
            href="/api/v1/auth/login"
            className="btn btn-primary"
            style={{ width: "100%", justifyContent: "center" }}
            id="login-button"
          >
            Sign in with SSO / OIDC
          </a>
        </div>
      </div>
    );
  }

  // 3. Pending Invitation State
  if (inviteToken) {
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
              <span className="user-avatar">{sessionUser.displayName.charAt(0)}</span>
              {sessionUser.displayName}
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
              You have been invited to join an organization workspace. Accept the invitation to
              access conversations and collaborate with your team.
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

  // 4. Onboarding / Bootstrap Screen
  if (organizations.length === 0) {
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
              <span className="user-avatar">{sessionUser.displayName.charAt(0)}</span>
              {sessionUser.displayName}
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
          <div className="glass-card onboarding-wrap">
            <div className="empty-icon-wrap">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <h2 className="empty-title">Create your organization</h2>
            <p className="empty-desc">
              Bootstrap an isolated multi-tenant organization to start customer support operations.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newOrgName.trim() || !newOrgSlug.trim()) return;
                void handleBootstrap(newOrgName.trim(), newOrgSlug.trim().toLowerCase()).then(
                  () => {
                    setNewOrgName("");
                    setNewOrgSlug("");
                    setOrgSlugManuallyEdited(false);
                  }
                );
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
