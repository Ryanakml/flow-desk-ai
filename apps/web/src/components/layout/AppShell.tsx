import * as React from "react";
import { useState } from "react";
import { AppSidebar } from "./AppSidebar.js";
import { Header } from "./Header.js";
import { useAuth } from "../../features/auth/context.js";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@flowdesk/ui";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { errorMsg, successMsg, showToast } = useAuth();

  return (
    <div
      className="flex h-screen w-screen overflow-hidden bg-background text-foreground"
      data-testid="app-shell"
    >
      {/* Desktop Sidebar (Permanent, >= 1024px) */}
      <div className="hidden lg:flex shrink-0 h-full">
        <AppSidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((prev) => !prev)} />
      </div>

      {/* Mobile Slide-out Drawer (< 1024px) */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="p-0 w-64 border-r border-border"
          data-testid="mobile-sheet-content"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation Menu</SheetTitle>
            <SheetDescription>
              Main application navigation links and workspace selector
            </SheetDescription>
          </SheetHeader>
          <AppSidebar
            collapsed={false}
            onNavigate={() => setMobileOpen(false)}
            className="border-r-0 h-full w-full"
          />
        </SheetContent>
      </Sheet>

      {/* Main Column: Header + Routed View Content */}
      <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden">
        <Header onOpenMobileNav={() => setMobileOpen(true)} />

        {/* Global Toast Banners */}
        {errorMsg && (
          <div className="m-3 flex shrink-0 items-center justify-between rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={() => showToast("", false)}
              className="hover:bg-destructive/20 ml-4 rounded-sm p-1 transition-colors"
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}
        {successMsg && (
          <div className="m-3 flex shrink-0 items-center justify-between rounded-md border border-success/50 bg-success/10 px-4 py-3 text-sm text-success" role="status">
            <span>{successMsg}</span>
            <button
              type="button"
              onClick={() => showToast("", false)}
              className="hover:bg-success/20 ml-4 rounded-sm p-1 transition-colors"
              aria-label="Dismiss message"
            >
              ✕
            </button>
          </div>
        )}

        {/* Main Routed Content Area */}
        <main
          className="flex-1 overflow-y-auto min-w-0 bg-background"
          id="main-content"
          data-testid="main-content"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
