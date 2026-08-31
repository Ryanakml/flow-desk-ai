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
import { DeveloperSettingsView } from "./DeveloperSettingsView.js";
import { AnalyticsView } from "./AnalyticsView.js";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar, type TabKey, FlowDeskBrandIcon } from "@/components/layout/AppSidebar";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Icons } from "@/components/icons";

export function App() {
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Organizations
  const [organizations, setOrganizations] = useState<UserOrganization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  // Active tab (defaults to WhatsApp Inbox)
  const [activeTab, setActiveTab] = useState<TabKey>("conversations");

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
      <div className="login-wrap flex min-h-screen items-center justify-center bg-background p-4">
        <div
          className="glass-card login-card flex flex-col items-center text-center p-8 max-w-sm w-full rounded-2xl border border-border/70 bg-card/80 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200"
          role="status"
          aria-live="polite"
        >
          <div className="login-icon mb-4 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icons.spinner className="size-6 animate-spin" />
          </div>
          <h2 className="login-title text-xl font-bold tracking-tight text-foreground">
            Loading FlowDesk…
          </h2>
          <p className="login-subtitle text-xs text-muted-foreground mt-1.5">
            Verifying secure tenant session
          </p>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated State (Route Guard)
  if (!sessionUser) {
    return (
      <div className="login-wrap flex min-h-screen items-center justify-center bg-background p-4 relative overflow-hidden">
        {/* Glow backdrop */}
        <div className="absolute -top-40 -left-40 size-96 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -right-40 size-96 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />

        <div className="glass-card login-card flex flex-col items-center text-center p-8 max-w-md w-full rounded-2xl border border-border/70 bg-card/90 shadow-2xl backdrop-blur-xl z-10">
          <div className="login-icon mb-4 flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 shadow-inner">
            <FlowDeskBrandIcon size={34} />
          </div>
          <h1 className="login-title text-2xl font-bold tracking-tight text-foreground">
            FlowDesk
          </h1>
          <p className="login-subtitle text-sm text-muted-foreground mt-1 mb-6">
            AI-first customer operations & omnichannel platform
          </p>
          <a
            href="/api/v1/auth/login"
            className="btn btn-primary inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-all cursor-pointer"
            id="login-button"
          >
            <Icons.login className="mr-2 size-4" />
            Sign in with SSO / OIDC
          </a>
        </div>
      </div>
    );
  }

  // 3. Invitation Acceptance View
  if (inviteToken) {
    return (
      <div className="app-container min-h-screen bg-background flex flex-col">
        <header className="top-nav flex h-14 items-center justify-between border-b border-border/70 px-6 bg-background/80 backdrop-blur-md">
          <div className="brand-section flex items-center gap-2">
            <span className="logo-badge flex items-center gap-2 font-bold text-base text-foreground">
              <FlowDeskBrandIcon size={22} />
              FlowDesk
            </span>
          </div>
          <div className="user-controls flex items-center gap-3">
            <span className="user-badge flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span className="user-avatar size-6 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary text-[10px]">
                {sessionUser.displayName.charAt(0)}
              </span>
              {sessionUser.displayName}
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                void handleLogout();
              }}
              className="btn btn-secondary btn-sm"
            >
              Sign out
            </Button>
          </div>
        </header>

        <main className="main-content flex-1 flex items-center justify-center p-6">
          {errorMsg && (
            <div className="toast-banner toast-error mb-4 max-w-md w-full rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive" role="alert">
              {errorMsg}
            </div>
          )}
          <div className="glass-card empty-state max-w-md w-full p-8 rounded-2xl border border-border/70 bg-card/90 text-center shadow-xl backdrop-blur-xl">
            <div className="empty-icon-wrap mx-auto mb-4 size-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <Icons.teams className="size-7" />
            </div>
            <h2 className="empty-title text-xl font-bold tracking-tight text-foreground">
              You've been invited!
            </h2>
            <p className="empty-desc text-xs text-muted-foreground mt-2 mb-6">
              You have a pending invitation to join an organization on FlowDesk. Accept below to
              enter the workspace.
            </p>
            <Button
              type="button"
              onClick={() => {
                void handleAcceptInvite();
              }}
              disabled={acceptingInvite}
              className="btn btn-primary w-full"
              id="accept-invite-btn"
            >
              {acceptingInvite ? "Accepting…" : "Accept and Join Organization"}
            </Button>
          </div>
        </main>
      </div>
    );
  }

  // 4. Onboarding View (0 Organizations)
  if (organizations.length === 0) {
    return (
      <div className="app-container min-h-screen bg-background flex flex-col">
        <header className="top-nav flex h-14 items-center justify-between border-b border-border/70 px-6 bg-background/80 backdrop-blur-md">
          <div className="brand-section flex items-center gap-2">
            <span className="logo-badge flex items-center gap-2 font-bold text-base text-foreground">
              <FlowDeskBrandIcon size={22} />
              FlowDesk
            </span>
          </div>
          <div className="user-controls flex items-center gap-3">
            <span className="user-badge flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span className="user-avatar size-6 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary text-[10px]">
                {sessionUser.displayName.charAt(0)}
              </span>
              {sessionUser.displayName}
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                void handleLogout();
              }}
              className="btn btn-secondary btn-sm"
            >
              Sign out
            </Button>
          </div>
        </header>

        <main className="main-content flex-1 flex items-center justify-center p-6">
          {errorMsg && (
            <div className="toast-banner toast-error mb-4 max-w-md w-full rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive" role="alert">
              {errorMsg}
            </div>
          )}
          <div className="glass-card onboarding-wrap max-w-md w-full p-8 rounded-2xl border border-border/70 bg-card/90 shadow-xl backdrop-blur-xl">
            <div className="empty-icon-wrap mx-auto mb-4 size-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
              <Icons.workspace className="size-7" />
            </div>
            <h2 className="empty-title text-xl font-bold tracking-tight text-foreground text-center">
              Create your organization
            </h2>
            <p className="empty-desc text-xs text-muted-foreground text-center mt-1 mb-6">
              Bootstrap an isolated multi-tenant organization to start customer support operations.
            </p>
            <form
              onSubmit={(e) => {
                void handleBootstrap(e);
              }}
              className="space-y-4"
            >
              <div className="form-group space-y-1.5">
                <label className="form-label text-xs font-semibold text-foreground" htmlFor={newOrgNameId}>
                  Organization Name
                </label>
                <Input
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
              <div className="form-group space-y-1.5">
                <label className="form-label text-xs font-semibold text-foreground" htmlFor={newOrgSlugId}>
                  Organization Slug
                </label>
                <Input
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
              <Button
                type="submit"
                disabled={bootstrapping}
                className="btn btn-primary w-full"
                id="create-org-btn"
              >
                {bootstrapping ? "Provisioning…" : "Create Organization"}
              </Button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  const tabTitles: Record<TabKey, string> = {
    conversations: "Inbox & Live Conversations",
    analytics: "Real-Time Analytics & SLA",
    workspace: "Workspace",
    channels: "WhatsApp Channels",
    developer: "Developer API & Webhooks",
    team: "Team Settings",
    audit: "Audit Trail"
  };

  // 5. Authenticated Modern shadcn Workspace Shell
  return (
    <SidebarProvider defaultOpen>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        {/* Modern Collapsible App Sidebar */}
        <AppSidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          sessionUser={sessionUser}
          organizations={organizations}
          selectedOrgId={selectedOrgId}
          onSelectOrgId={setSelectedOrgId}
          onLogout={() => {
            void handleLogout();
          }}
        />

        {/* Inset Main App Area */}
        <SidebarInset className="flex flex-1 flex-col overflow-hidden">
          {/* Header Bar */}
          <Header currentTabName={tabTitles[activeTab]} />

          {/* Main Content Area */}
          <main className="main-content flex-1 overflow-y-auto p-4 md:p-6">
            {errorMsg && (
              <div
                className="toast-banner toast-error mb-4 flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive shadow-sm"
                role="alert"
              >
                <span>{errorMsg}</span>
                <button
                  type="button"
                  onClick={() => setErrorMsg(null)}
                  className="size-6 rounded-md hover:bg-destructive/20 text-xs font-bold"
                >
                  ✕
                </button>
              </div>
            )}
            {successMsg && (
              <div
                className="toast-banner toast-success mb-4 flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400 shadow-sm"
                role="status"
              >
                <span>{successMsg}</span>
                <button
                  type="button"
                  onClick={() => setSuccessMsg(null)}
                  className="size-6 rounded-md hover:bg-emerald-500/20 text-xs font-bold"
                >
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

            {/* Tab: Real-Time Analytics Engine & SLA */}
            {activeTab === "analytics" && selectedOrgId && <AnalyticsView orgId={selectedOrgId} />}

            {/* Tab: Self-Service WhatsApp Channels */}
            {activeTab === "channels" && selectedOrgId && (
              <ChannelsView
                orgId={selectedOrgId}
                canManage={hasPermission(currentRole, "automation:publish")}
                showToast={showToast}
              />
            )}

            {/* Tab: Developer API Keys & Webhooks */}
            {activeTab === "developer" && selectedOrgId && (
              <DeveloperSettingsView
                orgId={selectedOrgId}
                canManage={hasPermission(currentRole, "automation:publish")}
                showToast={(msg, type) => showToast(msg, type === "error")}
              />
            )}

            {/* Tab 1: Empty Workspace Shell */}
            {activeTab === "workspace" && (
              <div className="glass-card empty-state flex flex-col items-center justify-center p-12 text-center rounded-2xl border border-border/70 bg-card/80 shadow-lg">
                <div className="empty-icon-wrap mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Icons.workspace className="size-7" />
                </div>
                <h2 className="empty-title text-xl font-bold tracking-tight text-foreground">
                  Inbox is clear
                </h2>
                <p className="empty-desc text-sm text-muted-foreground max-w-md mt-1 mb-6">
                  No active conversations or tickets yet. Your secure tenant boundary in{" "}
                  <strong>{activeOrg?.name}</strong> is verified and ready.
                </p>
                {canInvite && (
                  <Button
                    type="button"
                    onClick={() => {
                      setActiveTab("team");
                      setShowInviteModal(true);
                    }}
                    id="workspace-invite-team-btn"
                    className="btn btn-primary"
                  >
                    <Icons.add className="mr-2 size-4" />
                    Invite team members
                  </Button>
                )}
              </div>
            )}

            {/* Tab 2: Team Settings */}
            {activeTab === "team" && (
              <div className="glass-card rounded-2xl border border-border/70 bg-card/80 p-6 shadow-sm">
                <div className="section-header flex items-center justify-between pb-6 border-b border-border/60">
                  <div>
                    <h2 className="section-title text-lg font-bold tracking-tight text-foreground">
                      Team Members
                    </h2>
                    <p className="section-subtitle text-xs text-muted-foreground mt-0.5">
                      Manage members and role permissions for {activeOrg?.name}.
                    </p>
                  </div>
                  {canInvite && (
                    <Button
                      type="button"
                      onClick={() => setShowInviteModal(true)}
                      size="sm"
                      id="invite-member-btn"
                      className="btn btn-primary btn-sm"
                    >
                      <Icons.add className="mr-1.5 size-4" />
                      Invite Member
                    </Button>
                  )}
                </div>

                {loadingMembers ? (
                  <div className="flex items-center justify-center p-12 text-sm text-muted-foreground">
                    <Icons.spinner className="mr-2 size-4 animate-spin" />
                    Loading team…
                  </div>
                ) : (
                  <div className="table-container mt-4 overflow-x-auto rounded-lg border border-border/50">
                    <Table className="data-table w-full">
                      <TableHeader>
                        <TableRow className="border-b border-border/60 bg-muted/30">
                          <TableHead className="font-semibold text-xs text-muted-foreground">Member</TableHead>
                          <TableHead className="font-semibold text-xs text-muted-foreground">Email</TableHead>
                          <TableHead className="font-semibold text-xs text-muted-foreground">Role</TableHead>
                          <TableHead className="font-semibold text-xs text-muted-foreground">Status</TableHead>
                          {canRevokeMember && (
                            <TableHead className="font-semibold text-xs text-muted-foreground text-right">Actions</TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {members.map((member) => (
                          <TableRow key={member.id} className="border-b border-border/40 hover:bg-muted/20">
                            <TableCell className="font-medium text-sm text-foreground">
                              {member.displayName}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{member.email}</TableCell>
                            <TableCell>
                              {canModifyRole ? (
                                <select
                                  value={member.roleKey}
                                  onChange={(e) =>
                                    void handleRoleChange(member.id, e.target.value as RoleKey)
                                  }
                                  className="form-select rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
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
                                <Badge variant="secondary" className="text-[11px] capitalize">
                                  {member.roleKey.replace("_", " ")}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={member.status === "active" ? "default" : "outline"}
                                className={
                                  member.status === "active"
                                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px]"
                                    : "text-amber-500 border-amber-500/20 text-[10px]"
                                }
                              >
                                {member.status}
                              </Badge>
                            </TableCell>
                            {canRevokeMember && (
                              <TableCell className="text-right">
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="xs"
                                  onClick={() => void handleRevoke(member.id, member.displayName)}
                                  className="btn btn-danger btn-sm"
                                  aria-label={`Remove ${member.displayName}`}
                                >
                                  Remove
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: Audit Log */}
            {activeTab === "audit" && canViewAudit && (
              <div className="glass-card rounded-2xl border border-border/70 bg-card/80 p-6 shadow-sm">
                <div className="section-header pb-6 border-b border-border/60">
                  <h2 className="section-title text-lg font-bold tracking-tight text-foreground">
                    Audit Trail
                  </h2>
                  <p className="section-subtitle text-xs text-muted-foreground mt-0.5">
                    Tamper-evident event log for {activeOrg?.name}.
                  </p>
                </div>

                {loadingAudit ? (
                  <div className="flex items-center justify-center p-12 text-sm text-muted-foreground">
                    <Icons.spinner className="mr-2 size-4 animate-spin" />
                    Loading audit records…
                  </div>
                ) : auditLogs.length === 0 ? (
                  <p className="p-12 text-center text-sm text-muted-foreground">
                    No audit events recorded yet.
                  </p>
                ) : (
                  <div className="table-container mt-4 overflow-x-auto rounded-lg border border-border/50">
                    <Table className="data-table w-full">
                      <TableHeader>
                        <TableRow className="border-b border-border/60 bg-muted/30">
                          <TableHead className="font-semibold text-xs text-muted-foreground">Time</TableHead>
                          <TableHead className="font-semibold text-xs text-muted-foreground">Action</TableHead>
                          <TableHead className="font-semibold text-xs text-muted-foreground">Target</TableHead>
                          <TableHead className="font-semibold text-xs text-muted-foreground">Result</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {auditLogs.map((log) => (
                          <TableRow key={log.id} className="border-b border-border/40 hover:bg-muted/20">
                            <TableCell className="text-xs text-muted-foreground font-mono">
                              {new Date(log.occurredAt).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-xs font-mono text-foreground font-medium">
                              <code>{log.action}</code>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{log.targetType}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={
                                  log.result === "allowed"
                                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px]"
                                    : "bg-destructive/10 text-destructive border-destructive/20 text-[10px]"
                                }
                              >
                                {log.result}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {auditPageInfo?.hasNextPage && auditPageInfo.endCursor && (
                      <div className="p-3 border-t border-border/40 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            selectedOrgId &&
                            void loadAudit(selectedOrgId, auditPageInfo.endCursor ?? undefined)
                          }
                          className="btn btn-secondary btn-sm"
                        >
                          Next page →
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </main>
        </SidebarInset>

        {/* Invite Member Dialog Modal */}
        <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
          <DialogContent className="max-w-md bg-card/95 backdrop-blur-xl border border-border/80 p-6 rounded-2xl shadow-2xl">
            <DialogHeader>
              <DialogTitle id="invite-modal-title" className="text-lg font-bold text-foreground">
                Invite Team Member
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Send an email invitation with assigned role to join {activeOrg?.name}.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                void handleInviteSubmit(e);
              }}
              className="space-y-4 mt-2"
            >
              <div className="form-group space-y-1.5">
                <label className="form-label text-xs font-semibold text-foreground" htmlFor={inviteEmailId}>
                  Email Address
                </label>
                <Input
                  id={inviteEmailId}
                  type="email"
                  required
                  placeholder="colleague@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="form-group space-y-1.5">
                <label className="form-label text-xs font-semibold text-foreground" htmlFor={inviteRoleId}>
                  Organization Role
                </label>
                <select
                  id={inviteRoleId}
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as RoleKey)}
                  className="form-select w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="agent">Agent</option>
                  <option value="analyst">Analyst</option>
                  <option value="billing_admin">Billing Admin</option>
                </select>
              </div>
              <DialogFooter className="modal-actions pt-2 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowInviteModal(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={inviting}
                  className="btn btn-primary"
                  id="send-invite-btn"
                >
                  {inviting ? "Sending…" : "Send Invitation"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </SidebarProvider>
  );
}
