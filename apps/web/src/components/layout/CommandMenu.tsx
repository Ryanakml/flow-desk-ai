import * as React from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useAuth } from "../../features/auth/context.js";
import { navigationGroups, workspaceSettingsItem, type AppRoutePath } from "./navigation.js";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Button
} from "@flowdesk/ui";

interface CommandMenuProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CommandMenu({
  open: controlledOpen,
  onOpenChange: setControlledOpen
}: CommandMenuProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = setControlledOpen !== undefined ? setControlledOpen : setInternalOpen;

  const navigate = useNavigate();
  const { checkPermission } = useAuth();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, setOpen]);

  const handleSelect = (href: AppRoutePath) => {
    setOpen(false);
    void navigate({ to: href });
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="relative h-8 w-full max-w-[200px] justify-start rounded-md border-border bg-muted/30 text-xs text-muted-foreground hover:bg-muted/60 sm:w-64 sm:pr-12"
        aria-label="Search and quick actions"
        data-testid="command-menu-trigger"
      >
        <Search className="mr-2 h-3.5 w-3.5 shrink-0" />
        <span className="hidden sm:inline-flex">Search or jump to…</span>
        <span className="inline-flex sm:hidden">Search…</span>
        <kbd className="pointer-events-none absolute right-1.5 top-1.5 hidden h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100 sm:flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {navigationGroups.map((group) => {
            const visibleItems = group.items.filter((item) => {
              if (item.permission) {
                return checkPermission(item.permission);
              }
              return true;
            });

            if (visibleItems.length === 0) return null;

            return (
              <CommandGroup key={group.heading} heading={group.heading}>
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const keywords = [item.title, ...(item.aliases || [])].join(" ");
                  return (
                    <CommandItem
                      key={item.href}
                      value={`${item.title} ${keywords}`}
                      onSelect={() => handleSelect(item.href)}
                      className="cursor-pointer"
                      data-testid={`command-item-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>{item.title}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            );
          })}
          <CommandGroup heading="SETTINGS">
            <CommandItem
              value={`${workspaceSettingsItem.title} ${(workspaceSettingsItem.aliases || []).join(" ")}`}
              onSelect={() => handleSelect(workspaceSettingsItem.href)}
              className="cursor-pointer"
            >
              <workspaceSettingsItem.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>{workspaceSettingsItem.title}</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
