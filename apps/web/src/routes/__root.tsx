import * as React from "react";
import { useEffect } from "react";
import { createRootRoute, Outlet, Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "../features/auth/context.js";
import { AppShell } from "../components/layout/AppShell.js";
import { LoginView } from "../features/auth/LoginView.js";
import { OnboardingView } from "../features/onboarding/OnboardingView.js";
import { InvitationView } from "../features/invitations/InvitationView.js";

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
  const { sessionUser, loading, organizations, inviteToken } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Synchronize document title on route transitions
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
    return <LoginView />;
  }

  // 3. Pending Invitation State
  if (inviteToken) {
    return <InvitationView />;
  }

  // 4. Onboarding / Bootstrap Screen (Zero Organizations)
  if (organizations.length === 0) {
    return <OnboardingView />;
  }

  // 5. Authenticated Enterprise AppShell
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
