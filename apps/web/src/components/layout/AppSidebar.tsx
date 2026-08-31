import React from "react";
import type { SessionUser, UserOrganization } from "@flowdesk/contracts";
import { type RoleKey, hasPermission } from "@flowdesk/domain";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Icons } from "@/components/icons";
import { ThemeModeToggle } from "@/components/themes/theme-mode-toggle";
import { ThemeSelector } from "@/components/themes/theme-selector";
import { Badge } from "@/components/ui/badge";

export type TabKey =
  | "conversations"
  | "analytics"
  | "workspace"
  | "channels"
  | "developer"
  | "team"
  | "audit";

interface AppSidebarProps {
  activeTab: TabKey;
  onSelectTab: (tab: TabKey) => void;
  sessionUser: SessionUser;
  organizations: UserOrganization[];
  selectedOrgId: string | null;
  onSelectOrgId: (orgId: string) => void;
  onLogout: () => void;
  unreadCount?: number;
}

export function FlowDeskBrandIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
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

export function AppSidebar({
  activeTab,
  onSelectTab,
  sessionUser,
  organizations,
  selectedOrgId,
  onSelectOrgId,
  onLogout,
  unreadCount = 0
}: AppSidebarProps) {
  const activeOrg = organizations.find((o) => o.id === selectedOrgId) ?? null;
  const currentRole = (activeOrg?.role as RoleKey) ?? "agent";
  const canViewAudit = hasPermission(currentRole, "audit:view");

  return (
    <Sidebar collapsible="icon" className="border-r border-border/70 bg-sidebar/95 backdrop-blur-md">
      <SidebarHeader className="p-3">
        {/* Brand & Organization Picker */}
        <div className="flex items-center gap-3 px-1 py-1">
          <FlowDeskBrandIcon size={26} />
          <div className="flex flex-col overflow-hidden">
            <span className="font-semibold text-sm tracking-tight text-sidebar-foreground">
              FlowDesk AI
            </span>
            <span className="text-[11px] text-muted-foreground truncate">
              Omnichannel Operations
            </span>
          </div>
        </div>

        {/* Multi-Org Switcher */}
        {organizations.length > 1 ? (
          <div className="mt-2">
            <select
              value={selectedOrgId ?? ""}
              onChange={(e) => onSelectOrgId(e.target.value)}
              className="w-full text-xs rounded-md bg-muted/60 border border-border px-2 py-1.5 font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              aria-label="Switch organization"
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name} ({org.role})
                </option>
              ))}
            </select>
          </div>
        ) : activeOrg ? (
          <div id="active-org-badge" className="mt-2 flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-1.5 border border-border/50 text-xs">
            <span className="font-medium truncate text-foreground">{activeOrg.name}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">
              {currentRole}
            </Badge>
          </div>
        ) : null}
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent className="overflow-x-hidden px-2">
        {/* Main Workflows */}
        <SidebarGroup className="py-1">
          <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2">
            Operations
          </SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={activeTab === "conversations"}
                onClick={() => onSelectTab("conversations")}
                tooltip="Inbox"
                id="tab-conversations"
                data-testid="tab-conversations"
                className="cursor-pointer"
              >
                <Icons.chat className="size-4 text-emerald-500" />
                <span className="flex-1 font-medium text-sm">Inbox</span>
                {unreadCount > 0 && (
                  <Badge variant="default" className="size-5 rounded-full p-0 flex items-center justify-center text-[10px] bg-emerald-600 text-white">
                    {unreadCount}
                  </Badge>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={activeTab === "analytics"}
                onClick={() => onSelectTab("analytics")}
                tooltip="Analytics & SLA"
                id="tab-analytics"
                data-testid="tab-analytics"
                className="cursor-pointer"
              >
                <Icons.dashboard className="size-4 text-sky-500" />
                <span className="font-medium text-sm">Analytics & SLA</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={activeTab === "workspace"}
                onClick={() => onSelectTab("workspace")}
                tooltip="Workspace"
                id="tab-workspace"
                className="cursor-pointer"
              >
                <Icons.workspace className="size-4 text-amber-500" />
                <span className="font-medium text-sm">Workspace</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarSeparator className="my-1" />

        {/* Channels & API */}
        <SidebarGroup className="py-1">
          <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2">
            Integrations
          </SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={activeTab === "channels"}
                onClick={() => onSelectTab("channels")}
                tooltip="WhatsApp Channels"
                id="tab-channels"
                data-testid="tab-channels"
                className="cursor-pointer"
              >
                <Icons.phone className="size-4 text-emerald-500" />
                <span className="font-medium text-sm">WhatsApp Channels</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={activeTab === "developer"}
                onClick={() => onSelectTab("developer")}
                tooltip="Developer API & Webhooks"
                id="tab-developer"
                data-testid="tab-developer"
                className="cursor-pointer"
              >
                <Icons.code className="size-4 text-indigo-500" />
                <span className="font-medium text-sm">API & Webhooks</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarSeparator className="my-1" />

        {/* Administration */}
        <SidebarGroup className="py-1">
          <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2">
            Administration
          </SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={activeTab === "team"}
                onClick={() => onSelectTab("team")}
                tooltip="Team Settings"
                id="tab-team"
                className="cursor-pointer"
              >
                <Icons.teams className="size-4 text-purple-500" />
                <span className="font-medium text-sm">Team Members</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {canViewAudit && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeTab === "audit"}
                  onClick={() => onSelectTab("audit")}
                  tooltip="Audit Trail"
                  id="tab-audit"
                  className="cursor-pointer"
                >
                  <Icons.lock className="size-4 text-rose-500" />
                  <span className="font-medium text-sm">Audit Trail</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    className="w-full justify-between rounded-lg border border-border/50 bg-background/60 p-2 hover:bg-accent cursor-pointer"
                  />
                }
              >
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <div className="flex size-7 items-center justify-center rounded-full bg-primary/20 text-primary font-semibold text-xs shrink-0">
                    {sessionUser.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex flex-col text-left overflow-hidden">
                    <span className="truncate text-xs font-semibold text-foreground">
                      {sessionUser.displayName}
                    </span>
                    <span id="user-role-badge" className={`truncate text-[10px] text-muted-foreground capitalize role-pill ${currentRole}`}>
                      {currentRole.replace("_", " ")}
                    </span>
                  </div>
                </div>
                <Icons.chevronsUpDown className="size-4 text-muted-foreground shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-56 rounded-lg border border-border bg-popover p-1 shadow-lg"
                side="top"
                align="start"
                sideOffset={6}
              >
                <DropdownMenuLabel className="px-2 py-1.5 text-xs text-muted-foreground">
                  Signed in as <strong className="text-foreground">{sessionUser.displayName}</strong>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <div className="px-2 py-1 flex items-center justify-between text-xs">
                    <span>Theme</span>
                    <ThemeModeToggle />
                  </div>
                  <div className="px-2 py-1 flex items-center justify-between text-xs">
                    <span>Palette</span>
                    <ThemeSelector />
                  </div>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onLogout}
                  id="logout-btn"
                  className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive text-xs"
                >
                  <Icons.logout className="mr-2 size-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
