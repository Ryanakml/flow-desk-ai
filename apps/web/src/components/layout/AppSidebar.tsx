import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useAuth } from "../../features/auth/context.js";
import {
  navigationGroups,
  isRouteActive,
  type NavItem
} from "./navigation.js";
import { OrgSwitcher } from "./OrgSwitcher.js";
import { UserNav } from "./UserNav.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, Button } from "@flowdesk/ui";

export function FlowDeskIcon({ size = 20 }: { size?: number }) {
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

interface AppSidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
  className?: string;
}

export function AppSidebar({
  collapsed = false,
  onToggleCollapse,
  onNavigate,
  className = ""
}: AppSidebarProps) {
  const { checkPermission } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = isRouteActive(pathname, item.href, item.exact);

    const linkContent = (
      <Link
        to={item.href}
        onClick={() => onNavigate?.()}
        className={`group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          active
            ? "bg-accent/60 text-accent-foreground font-semibold"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        } ${collapsed ? "justify-center px-0 w-10 h-10" : "w-full"}`}
        data-active={active ? "true" : undefined}
        aria-current={active ? "page" : undefined}
        data-testid={`nav-link-${item.href}`}
      >
        <Icon
          className={`h-4 w-4 shrink-0 transition-colors ${active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}
        />
        {!collapsed && <span className="truncate">{item.title}</span>}
      </Link>
    );

    if (collapsed) {
      return (
        <Tooltip key={item.href} delayDuration={0}>
          <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
          <TooltipContent side="right" className="font-medium text-sm">
            {item.title}
          </TooltipContent>
        </Tooltip>
      );
    }

    return <React.Fragment key={item.href}>{linkContent}</React.Fragment>;
  };

  return (
    <TooltipProvider>
      <aside
        aria-label="Sidebar"
        className={`flex flex-col h-full border-r border-border/60 bg-background select-none transition-all duration-200 ${
          collapsed ? "w-16" : "w-64"
        } ${className}`}
        data-testid="app-sidebar"
      >
        {/* Sidebar Header: Brand & Collapse Toggle */}
        <div className="flex items-center justify-between p-3">
          <Link
            to="/inbox"
            onClick={() => onNavigate?.()}
            className="flex items-center gap-2 font-bold text-foreground tracking-tight hover:opacity-90 transition-opacity pl-1"
            data-testid="brand-logo"
          >
            <span className="flex items-center justify-center p-1 rounded-md bg-muted/40">
              <FlowDeskIcon size={20} />
            </span>
            {!collapsed && <span className="text-[15px] font-semibold">FlowDesk</span>}
          </Link>
          {onToggleCollapse && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleCollapse}
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              aria-label="Toggle sidebar collapse"
              data-testid="sidebar-collapse-button"
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>

        {/* Workspace / Organization Switcher */}
        <div className="px-3 pb-2 pt-1">
          <OrgSwitcher collapsed={collapsed} />
        </div>

        {/* Navigation Groups Container */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {navigationGroups.map((group) => {
            const visibleItems = group.items.filter((item) => {
              if (item.permission) {
                return checkPermission(item.permission);
              }
              return true;
            });

            if (visibleItems.length === 0) return null;

            return (
              <div key={group.heading} className="space-y-1.5">
                {!collapsed && (
                  <h3 className="px-3 text-xs font-medium text-muted-foreground/70">
                    {group.heading}
                  </h3>
                )}
                <nav className="space-y-0.5" aria-label={group.heading}>
                  {visibleItems.map(renderNavItem)}
                </nav>
              </div>
            );
          })}
        </div>

        {/* Sidebar Footer: User Profile & Account Actions */}
        <div className="p-3 mt-auto">
          <UserNav collapsed={collapsed} />
        </div>
      </aside>
    </TooltipProvider>
  );
}
