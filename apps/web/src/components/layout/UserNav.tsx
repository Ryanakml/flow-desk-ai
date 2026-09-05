import * as React from "react";
import { Link } from "@tanstack/react-router";
import { LogOut, Settings } from "lucide-react";
import { useAuth } from "../../features/auth/context.js";
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Button
} from "@flowdesk/ui";

interface UserNavProps {
  collapsed?: boolean;
}

export function UserNav({ collapsed = false }: UserNavProps) {
  const { sessionUser, currentRole, handleLogout } = useAuth();

  if (!sessionUser) return null;

  const initials = sessionUser.displayName
    ? sessionUser.displayName
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "U";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={`flex items-center gap-2 text-foreground font-normal hover:bg-muted/60 transition-colors ${
            collapsed
              ? "h-10 w-10 p-0 justify-center rounded-lg"
              : "w-full h-auto p-2 justify-start rounded-lg border border-border/40 bg-muted/20"
          }`}
          data-testid="user-nav-trigger"
          aria-label="User account menu"
        >
          <Avatar className="h-8 w-8 rounded-full border border-border text-xs font-semibold shrink-0">
            <AvatarFallback className="bg-primary/10 text-foreground">{initials}</AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="flex flex-col min-w-0 flex-1 text-left">
              <div className="flex items-center justify-between gap-1">
                <span className="truncate text-xs font-semibold text-foreground">
                  {sessionUser.displayName}
                </span>
                <span
                  className={`role-pill ${currentRole} text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border border-border/60`}
                  id="user-role-badge"
                  data-testid="user-role-badge"
                >
                  {currentRole.replace("_", " ")}
                </span>
              </div>
              {sessionUser.email && (
                <span className="truncate text-[11px] text-muted-foreground">
                  {sessionUser.email}
                </span>
              )}
            </div>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" sideOffset={8}>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-xs font-medium leading-none text-foreground">
              {sessionUser.displayName}
            </p>
            {sessionUser.email && (
              <p className="text-[11px] leading-none text-muted-foreground">{sessionUser.email}</p>
            )}
            <span className="text-[10px] text-muted-foreground uppercase font-mono mt-1">
              Role: {currentRole.replace("_", " ")}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild className="cursor-pointer">
            <Link to="/settings/workspace" className="flex w-full items-center gap-2">
              <Settings className="h-4 w-4 text-muted-foreground" />
              <span>Workspace Settings</span>
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            void handleLogout();
          }}
          className="cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
          id="logout-btn"
          data-testid="logout-btn"
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
