import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { SessionUser, UserOrganization } from "@flowdesk/contracts";
import { type RoleKey, type Permission, hasPermission } from "@flowdesk/domain";
import {
  getSession,
  listUserOrganizations,
  logout,
  bootstrapOrganization,
  acceptInvitation,
  ApiError
} from "../../api.js";

export interface AuthContextValue {
  sessionUser: SessionUser | null;
  organizations: UserOrganization[];
  selectedOrgId: string | null;
  activeOrg: UserOrganization | null;
  currentRole: RoleKey;
  loading: boolean;
  errorMsg: string | null;
  successMsg: string | null;
  inviteToken: string | null;
  acceptingInvite: boolean;
  bootstrapping: boolean;
  showToast: (msg: string, isError?: boolean) => void;
  setSelectedOrgId: (orgId: string) => void;
  refreshSession: () => Promise<void>;
  handleLogout: () => Promise<void>;
  handleBootstrap: (name: string, slug: string) => Promise<void>;
  handleAcceptInvite: () => Promise<void>;
  checkPermission: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [organizations, setOrganizations] = useState<UserOrganization[]>([]);
  const [selectedOrgId, setSelectedOrgIdState] = useState<string | null>(null);

  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [acceptingInvite, setAcceptingInvite] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);

  const showToast = useCallback((msg: string, isError = false) => {
    if (isError) {
      setErrorMsg(msg);
      setSuccessMsg(null);
    } else {
      setSuccessMsg(msg);
      setErrorMsg(null);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      setLoading(true);
      const session = await getSession();
      setSessionUser(session.user);

      const orgsRes = await listUserOrganizations();
      setOrganizations(orgsRes.organizations);

      if (orgsRes.organizations.length > 0) {
        setSelectedOrgIdState((prev) => {
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
        setSelectedOrgIdState(null);
      } else {
        showToast(err instanceof Error ? err.message : "Failed to load session", true);
      }
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const token = params.get("invite") || params.get("token");
      if (token) {
        setInviteToken(token);
      }
    }
    void refreshSession();
  }, [refreshSession]);

  const handleLogout = useCallback(async () => {
    let logoutUrl: string | undefined;
    try {
      const res = await logout();
      logoutUrl = res.logoutUrl;
    } catch {
      // Proceed even if network fails
    }
    setSessionUser(null);
    setOrganizations([]);
    setSelectedOrgIdState(null);
    if (typeof window !== "undefined") {
      window.location.href = logoutUrl || "/";
    }
  }, []);

  const handleBootstrap = useCallback(
    async (name: string, slug: string) => {
      setBootstrapping(true);
      try {
        const res = await bootstrapOrganization({ name, slug });
        showToast(`Organization "${res.organization.displayName}" created!`);
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
        setSelectedOrgIdState(res.organization.id);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Failed to create organization", true);
        throw err;
      } finally {
        setBootstrapping(false);
      }
    },
    [showToast]
  );

  const handleAcceptInvite = useCallback(async () => {
    if (!inviteToken) return;
    try {
      setAcceptingInvite(true);
      const res = await acceptInvitation(inviteToken);
      showToast("Invitation accepted! Welcome to the organization.");
      setInviteToken(null);
      if (typeof window !== "undefined") {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      await refreshSession();
      setSelectedOrgIdState(res.organizationId);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to accept invitation", true);
    } finally {
      setAcceptingInvite(false);
    }
  }, [inviteToken, refreshSession, showToast]);

  const activeOrg = organizations.find((o) => o.id === selectedOrgId) ?? null;
  const currentRole = (activeOrg?.role as RoleKey) ?? "agent";

  const checkPermission = useCallback(
    (permission: Permission): boolean => {
      return hasPermission(currentRole, permission);
    },
    [currentRole]
  );

  const value: AuthContextValue = {
    sessionUser,
    organizations,
    selectedOrgId,
    activeOrg,
    currentRole,
    loading,
    errorMsg,
    successMsg,
    inviteToken,
    acceptingInvite,
    bootstrapping,
    showToast,
    setSelectedOrgId: setSelectedOrgIdState,
    refreshSession,
    handleLogout,
    handleBootstrap,
    handleAcceptInvite,
    checkPermission
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
