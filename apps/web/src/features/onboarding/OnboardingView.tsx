import * as React from "react";
import { useState, useId } from "react";
import { FlowDeskIcon } from "../../components/layout/AppSidebar.js";
import { useAuth } from "../auth/context.js";

export function OnboardingView() {
  const { sessionUser, errorMsg, bootstrapping, handleLogout, handleBootstrap } = useAuth();

  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [orgSlugManuallyEdited, setOrgSlugManuallyEdited] = useState(false);

  const newOrgNameId = useId();
  const newOrgSlugId = useId();

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
              void handleBootstrap(newOrgName.trim(), newOrgSlug.trim().toLowerCase()).then(() => {
                setNewOrgName("");
                setNewOrgSlug("");
                setOrgSlugManuallyEdited(false);
              });
            }}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
              width: "100%",
              maxWidth: 360,
              margin: "0 auto",
              textAlign: "left"
            }}
          >
            <div>
              <label
                htmlFor={newOrgNameId}
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  marginBottom: "0.35rem"
                }}
              >
                Organization Name
              </label>
              <input
                id={newOrgNameId}
                type="text"
                placeholder="e.g. Acme Corp"
                value={newOrgName}
                onChange={(e) => {
                  const val = e.target.value;
                  setNewOrgName(val);
                  if (!orgSlugManuallyEdited) {
                    setNewOrgSlug(
                      val
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-|-$/g, "")
                    );
                  }
                }}
                disabled={bootstrapping}
                className="input-field"
                style={{ width: "100%" }}
                required
              />
            </div>
            <div>
              <label
                htmlFor={newOrgSlugId}
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  marginBottom: "0.35rem"
                }}
              >
                Organization Slug (URL identifier)
              </label>
              <input
                id={newOrgSlugId}
                type="text"
                placeholder="e.g. acme-corp"
                value={newOrgSlug}
                onChange={(e) => {
                  setOrgSlugManuallyEdited(true);
                  setNewOrgSlug(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, "")
                      .replace(/-+/g, "-")
                  );
                }}
                disabled={bootstrapping}
                className="input-field"
                style={{ width: "100%" }}
                required
              />
            </div>
            <button
              type="submit"
              disabled={bootstrapping || !newOrgName.trim() || !newOrgSlug.trim()}
              className="btn btn-primary"
              style={{ marginTop: "0.5rem" }}
            >
              {bootstrapping ? "Provisioning…" : "Create Organization"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
