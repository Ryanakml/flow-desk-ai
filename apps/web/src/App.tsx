import { useState, useEffect, useCallback, useId } from "react";
import type {
  SessionUser,
  UserOrganization,
  MembershipMember,
  AuditLogEntry,
  PageInfo
} from "@flowdesk/contracts";
import { type RoleKey, hasPermission } from "@flowdesk/domain";
import {
  getSession,
  logout,
  listUserOrganizations,
  bootstrapOrganization,
  acceptInvitation,
  listMembers,
  inviteMember,
  updateMemberRole,
  revokeMember,
  listAuditLogs,
  ApiError
} from "./api.js";
import { InboxView } from "./InboxView.js";
import { ChannelsView } from "./ChannelsView.js";
import "./styles.css";

type Tab = "conversations" | "workspace" | "channels" | "team" | "audit";

export function App() {
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Organizations
  const [organizations, setOrganizations] = useState<UserOrganization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  // Active tab (defaults to WhatsApp Inbox)
  const [activeTab, setActiveTab] = useState<Tab>("conversations");

  // Invitation token from URL
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [acceptingInvite, setAcceptingInvite] = useState(false);

  // Onboarding (Bootstrap)
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [orgSlugManuallyEdited, setOrgSlugManuallyEdited] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);

  // Team
  const [members, setMembers] = useState<MembershipMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<RoleKey>("agent");
  const [inviting, setInviting] = useState(false);

  // Audit Logs
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditPageInfo, setAuditPageInfo] = useState<PageInfo | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const orgSelectId = useId();
  const inviteEmailId = useId();
  const inviteRoleId = useId();
  const newOrgNameId = useId();
  const newOrgSlugId = useId();

  // Current active org
  const activeOrg = organizations.find((o) => o.id === selectedOrgId) ?? null;
  const currentRole = (activeOrg?.role as RoleKey) ?? "agent";

  // Permission helpers
  const canInvite = hasPermission(currentRole, "membership:invite");
  const canModifyRole = hasPermission(currentRole, "membership:modify");
  const canRevokeMember = hasPermission(currentRole, "membership:revoke");
  const canViewAudit = hasPermission(currentRole, "audit:view");

  const showToast = (msg: string, isError = false) => {
    if (isError) {
      setErrorMsg(msg);
      setSuccessMsg(null);
    } else {
      setSuccessMsg(msg);
      setErrorMsg(null);
    }
  };

  // Handle Session Expiry or Auth Check
  const refreshSession = useCallback(async () => {
    try {
      setLoading(true);
      const session = await getSession();
      setSessionUser(session.user);

      // Fetch organizations
      const orgsRes = await listUserOrganizations();
      setOrganizations(orgsRes.organizations);

      if (orgsRes.organizations.length > 0) {
        setSelectedOrgId((prev) => {
          if (prev && orgsRes.organizations.some((o) => o.id === prev)) {
            return prev;
          }
          return orgsRes.organizations[0]!.id;
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSessionUser(null);
        setOrganizations([]);
        setSelectedOrgId(null);
      } else {
        showToast(err instanceof Error ? err.message : "Failed to load session", true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Check URL params for invite token
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("invite") || params.get("token");
    if (token) {
      setInviteToken(token);
    }
    void refreshSession();
  }, [refreshSession]);

  // Load team members when Team tab or org changes
  const loadMembers = useCallback(async (orgId: string) => {
    try {
      setLoadingMembers(true);
      const res = await listMembers(orgId);
      setMembers(res.members);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load members", true);
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  // Load audit logs when Audit tab or org changes
  const loadAudit = useCallback(async (orgId: string, cursor?: string) => {
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
  }, []);

  useEffect(() => {
    if (!selectedOrgId) return;
    if (activeTab === "team") {
      void loadMembers(selectedOrgId);
    } else if (activeTab === "audit" && canViewAudit) {
      void loadAudit(selectedOrgId);
    }
  }, [selectedOrgId, activeTab, canViewAudit, loadMembers, loadAudit]);

  // Sign out
  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Proceed even if network fails
    }
    setSessionUser(null);
    setOrganizations([]);
    setSelectedOrgId(null);
  };

  // Bootstrap organization
  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim() || !newOrgSlug.trim()) return;

    try {
      setBootstrapping(true);
      const res = await bootstrapOrganization({
        name: newOrgName.trim(),
        slug: newOrgSlug.trim().toLowerCase()
      });
      showToast(`Organization "${res.organization.displayName}" created!`);
      setNewOrgName("");
      setNewOrgSlug("");
      setOrgSlugManuallyEdited(false);
      setOrganizations((current) => [
        ...current.filter((organization) => organization.id !== res.organization.id),
        {
          id: res.organization.id,
          slug: res.organization.slug,
          name: res.organization.displayName,
          role: "owner",
          membershipId: res.organization.membershipId
        }
      ]);
      setSelectedOrgId(res.organization.id);
      setActiveTab("conversations");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to create organization", true);
    } finally {
      setBootstrapping(false);
    }
  };

  // Accept invitation
  const handleAcceptInvite = async () => {
    if (!inviteToken) return;
    try {
      setAcceptingInvite(true);
      const res = await acceptInvitation(inviteToken);
      showToast("Invitation accepted! Welcome to the organization.");
      setInviteToken(null);
      // Clean query parameter from URL
      window.history.replaceState({}, document.title, window.location.pathname);
      await refreshSession();
      setSelectedOrgId(res.organizationId);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to accept invitation", true);
    } finally {
      setAcceptingInvite(false);
    }
  };

  // Invite member
  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId || !inviteEmail.trim()) return;

    try {
      setInviting(true);
      const idempotencyKey = `invite-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await inviteMember(
        selectedOrgId,
        { email: inviteEmail.trim(), role: inviteRole },
        idempotencyKey
      );
      showToast(`Invitation sent to ${inviteEmail}!`);
      setShowInviteModal(false);
      setInviteEmail("");
      setInviteRole("agent");
      void loadMembers(selectedOrgId);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to invite member", true);
    } finally {
      setInviting(false);
    }
  };

  // Update member role
  const handleRoleChange = async (memberId: string, newRole: RoleKey) => {
    if (!selectedOrgId) return;
    try {
      const idempotencyKey = `role-${memberId}-${Date.now()}`;
      await updateMemberRole(selectedOrgId, memberId, newRole, idempotencyKey);
      showToast("Role updated successfully!");
      void loadMembers(selectedOrgId);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update role", true);
    }
  };

  // Revoke member
  const handleRevoke = async (memberId: string, displayName: string) => {
    if (!selectedOrgId) return;
    if (!window.confirm(`Are you sure you want to remove ${displayName} from the team?`)) return;

    try {
      const idempotencyKey = `revoke-${memberId}-${Date.now()}`;
      await revokeMember(selectedOrgId, memberId, idempotencyKey);
      showToast(`${displayName} was removed from the team.`);
      void loadMembers(selectedOrgId);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to remove member", true);
    }
  };

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

  // 2. Unauthenticated State (Route Guard)
  if (!sessionUser) {
    return (
      <div className="login-wrap">
        <div className="glass-card login-card">
          <div className="login-icon">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fff"
              strokeWidth="2"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
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

  // 3. Invitation Acceptance View
  if (inviteToken) {
    return (
      <div className="app-container">
        <header className="top-nav">
          <div className="brand-section">
            <span className="logo-badge">
              <span className="logo-icon">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2"
                >
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
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
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
            </div>
            <h2 className="empty-title">You've been invited!</h2>
            <p className="empty-desc">
              You have a pending invitation to join an organization on FlowDesk. Accept below to
              enter the workspace.
            </p>
            <button
              type="button"
              onClick={() => {
                void handleAcceptInvite();
              }}
              disabled={acceptingInvite}
              className="btn btn-primary"
              id="accept-invite-btn"
            >
              {acceptingInvite ? "Accepting…" : "Accept and Join Organization"}
            </button>
          </div>
        </main>
      </div>
    );
  }

  // 4. Onboarding View (0 Organizations)
  if (organizations.length === 0) {
    return (
      <div className="app-container">
        <header className="top-nav">
          <div className="brand-section">
            <span className="logo-badge">
              <span className="logo-icon">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2"
                >
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
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
                void handleBootstrap(e);
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

  // 5. Authenticated Workspace Shell
  return (
    <div className="app-container">
      {/* Top Bar */}
      <header className="top-nav">
        <div className="brand-section">
          <span className="logo-badge">
            <span className="logo-icon">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="2"
              >
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </span>
            FlowDesk
          </span>

          {/* Org Switcher (only for multi-membership users; badge for single org) */}
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

      {/* Sub Navigation (Tabs) */}
      <nav className="sub-nav" aria-label="Workspace Sections">
        <button
          type="button"
          onClick={() => setActiveTab("conversations")}
          className={`tab-btn ${activeTab === "conversations" ? "active" : ""}`}
          id="tab-conversations"
          data-testid="tab-conversations"
        >
          Inbox
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("workspace")}
          className={`tab-btn ${activeTab === "workspace" ? "active" : ""}`}
          id="tab-workspace"
        >
          Workspace
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("channels")}
          className={`tab-btn ${activeTab === "channels" ? "active" : ""}`}
          id="tab-channels"
          data-testid="tab-channels"
        >
          WhatsApp Channels
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("team")}
          className={`tab-btn ${activeTab === "team" ? "active" : ""}`}
          id="tab-team"
        >
          Team Settings
        </button>
        {canViewAudit && (
          <button
            type="button"
            onClick={() => setActiveTab("audit")}
            className={`tab-btn ${activeTab === "audit" ? "active" : ""}`}
            id="tab-audit"
          >
            Audit Log
          </button>
        )}
      </nav>

      {/* Main Content Area */}
      <main className="main-content">
        {errorMsg && (
          <div className="toast-banner toast-error" role="alert">
            <span>{errorMsg}</span>
            <button type="button" onClick={() => setErrorMsg(null)} className="btn btn-sm">
              ✕
            </button>
          </div>
        )}
        {successMsg && (
          <div className="toast-banner toast-success" role="status">
            <span>{successMsg}</span>
            <button type="button" onClick={() => setSuccessMsg(null)} className="btn btn-sm">
              ✕
            </button>
          </div>
        )}

        {/* Tab 0: WhatsApp Operator Conversation Inbox */}
        {activeTab === "conversations" && selectedOrgId && sessionUser && (
          <InboxView
            organizationId={selectedOrgId}
            userRole={currentRole}
            sessionUserId={sessionUser.id}
          />
        )}

        {/* Tab: Self-Service WhatsApp Channels */}
        {activeTab === "channels" && selectedOrgId && (
          <ChannelsView
            orgId={selectedOrgId}
            canManage={hasPermission(currentRole, "automation:publish")}
            showToast={showToast}
          />
        )}

        {/* Tab 1: Empty Workspace Shell */}
        {activeTab === "workspace" && (
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
              <button
                type="button"
                onClick={() => {
                  setActiveTab("team");
                  setShowInviteModal(true);
                }}
                className="btn btn-primary"
                id="workspace-invite-team-btn"
              >
                Invite team members
              </button>
            )}
          </div>
        )}

        {/* Tab 2: Team Settings */}
        {activeTab === "team" && (
          <div className="glass-card">
            <div className="section-header">
              <div>
                <h2 className="section-title">Team Members</h2>
                <p className="section-subtitle">
                  Manage members and role permissions for {activeOrg?.name}.
                </p>
              </div>
              {canInvite && (
                <button
                  type="button"
                  onClick={() => setShowInviteModal(true)}
                  className="btn btn-primary btn-sm"
                  id="invite-member-btn"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Invite Member
                </button>
              )}
            </div>

            {loadingMembers ? (
              <div style={{ textAlign: "center", padding: "2rem" }}>Loading team…</div>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      {canRevokeMember && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member.id}>
                        <td>
                          <strong>{member.displayName}</strong>
                        </td>
                        <td>{member.email}</td>
                        <td>
                          {canModifyRole ? (
                            <select
                              value={member.roleKey}
                              onChange={(e) =>
                                void handleRoleChange(member.id, e.target.value as RoleKey)
                              }
                              className="form-select"
                              style={{ width: "auto", padding: "0.2rem 0.5rem" }}
                              aria-label={`Change role for ${member.displayName}`}
                            >
                              <option value="owner">Owner</option>
                              <option value="admin">Admin</option>
                              <option value="supervisor">Supervisor</option>
                              <option value="agent">Agent</option>
                              <option value="analyst">Analyst</option>
                              <option value="billing_admin">Billing Admin</option>
                            </select>
                          ) : (
                            <span className={`role-pill ${member.roleKey}`}>
                              {member.roleKey.replace("_", " ")}
                            </span>
                          )}
                        </td>
                        <td>
                          <span
                            style={{
                              textTransform: "capitalize",
                              color:
                                member.status === "active"
                                  ? "var(--color-success)"
                                  : "var(--color-warning)"
                            }}
                          >
                            {member.status}
                          </span>
                        </td>
                        {canRevokeMember && (
                          <td>
                            <button
                              type="button"
                              onClick={() => void handleRevoke(member.id, member.displayName)}
                              className="btn btn-danger btn-sm"
                              aria-label={`Remove ${member.displayName}`}
                            >
                              Remove
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Audit Log */}
        {activeTab === "audit" && canViewAudit && (
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
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td>{new Date(log.occurredAt).toLocaleString()}</td>
                        <td>
                          <code>{log.action}</code>
                        </td>
                        <td>{log.targetType}</td>
                        <td>
                          <span
                            style={{
                              color:
                                log.result === "allowed"
                                  ? "var(--color-success)"
                                  : "var(--color-danger)"
                            }}
                          >
                            {log.result}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {auditPageInfo?.hasNextPage && auditPageInfo.endCursor && (
                  <div style={{ padding: "1rem", textAlign: "right" }}>
                    <button
                      type="button"
                      onClick={() =>
                        selectedOrgId &&
                        void loadAudit(selectedOrgId, auditPageInfo.endCursor ?? undefined)
                      }
                      className="btn btn-secondary btn-sm"
                    >
                      Next page →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Invite Member Modal Dialog */}
      {showInviteModal && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-modal-title"
        >
          <div className="modal-card">
            <div className="modal-header">
              <h3 className="modal-title" id="invite-modal-title">
                Invite Team Member
              </h3>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="btn btn-secondary btn-sm"
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>
            <form
              onSubmit={(e) => {
                void handleInviteSubmit(e);
              }}
            >
              <div className="form-group">
                <label className="form-label" htmlFor={inviteEmailId}>
                  Email Address
                </label>
                <input
                  id={inviteEmailId}
                  type="email"
                  required
                  placeholder="colleague@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor={inviteRoleId}>
                  Organization Role
                </label>
                <select
                  id={inviteRoleId}
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as RoleKey)}
                  className="form-select"
                >
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="agent">Agent</option>
                  <option value="analyst">Analyst</option>
                  <option value="billing_admin">Billing Admin</option>
                </select>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="btn btn-primary"
                  id="send-invite-btn"
                >
                  {inviting ? "Sending…" : "Send Invitation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
