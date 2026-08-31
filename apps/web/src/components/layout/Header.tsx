import React from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ThemeModeToggle } from "@/components/themes/theme-mode-toggle";
import { ThemeSelector } from "@/components/themes/theme-selector";

interface HeaderProps {
  currentTabName: string;
}

export function Header({ currentTabName }: HeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-border/70 bg-background/80 px-4 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="-ml-1 cursor-pointer text-muted-foreground hover:text-foreground" />
        <Separator orientation="vertical" className="h-4" />
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="text-muted-foreground hidden sm:inline-block">FlowDesk</span>
          <span className="text-muted-foreground hidden sm:inline-block">/</span>
          <span className="text-foreground font-semibold">{currentTabName}</span>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1">
          <ThemeModeToggle />
          <div className="hidden sm:block">
            <ThemeSelector />
          </div>
        </div>
      </div>
    </header>
  );
}
