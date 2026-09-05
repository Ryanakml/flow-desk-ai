import * as React from "react";
import { ChevronsUpDown, Check, Building2 } from "lucide-react";
import { useAuth } from "../../features/auth/context.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Button
} from "@flowdesk/ui";

interface OrgSwitcherProps {
  collapsed?: boolean;
}

export function OrgSwitcher({ collapsed = false }: OrgSwitcherProps) {
  const { organizations, selectedOrgId, activeOrg, currentRole, setSelectedOrgId } = useAuth();

  if (organizations.length <= 1) {
    return (
      <div
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-border/60 bg-muted/30 text-sm font-medium text-foreground w-full"
        id="active-org-badge"
        data-testid="active-org-badge"
        title={activeOrg?.name ?? "Workspace"}
      >
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
          <Building2 className="h-3.5 w-3.5" />
        </div>
        {!collapsed && (
          <div className="flex flex-col min-w-0 flex-1 text-left">
            <span className="truncate text-xs font-semibold text-foreground">
              {activeOrg?.name ?? "Workspace"}
            </span>
            <span className="truncate text-[10px] text-muted-foreground uppercase tracking-wider font-mono">
              {currentRole.replace("_", " ")}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={`flex items-center justify-between border-border/60 bg-muted/30 hover:bg-muted/60 text-foreground font-normal transition-colors ${
            collapsed ? "h-9 w-9 p-0 justify-center" : "w-full h-auto px-2 py-1.5"
          }`}
          aria-label="Switch organization"
          data-testid="org-switcher-trigger"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
            </div>
            {!collapsed && (
              <div className="flex flex-col min-w-0 text-left">
                <span className="truncate text-xs font-semibold text-foreground">
                  {activeOrg?.name}
                </span>
                <span className="truncate text-[10px] text-muted-foreground uppercase tracking-wider font-mono">
                  {currentRole.replace("_", " ")}
                </span>
              </div>
            )}
          </div>
          {!collapsed && <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Organizations
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {organizations.map((org) => {
          const isSelected = org.id === selectedOrgId;
          return (
            <DropdownMenuItem
              key={org.id}
              onClick={() => setSelectedOrgId(org.id)}
              className="flex items-center justify-between cursor-pointer text-xs py-2"
              data-testid={`org-option-${org.id}`}
            >
              <div className="flex flex-col min-w-0 pr-2">
                <span
                  className={`truncate font-medium ${isSelected ? "text-foreground font-semibold" : "text-muted-foreground"}`}
                >
                  {org.name}
                </span>
                <span className="text-[10px] text-muted-foreground uppercase font-mono">
                  {org.role.replace("_", " ")}
                </span>
              </div>
              {isSelected && <Check className="h-4 w-4 text-foreground shrink-0" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
