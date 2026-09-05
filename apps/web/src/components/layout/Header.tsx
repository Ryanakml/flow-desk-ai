import * as React from "react";
import { Menu } from "lucide-react";
import { Breadcrumbs } from "./Breadcrumbs.js";
import { CommandMenu } from "./CommandMenu.js";
import { ThemeToggle } from "../theme-toggle.js";
import { Button } from "@flowdesk/ui";

interface HeaderProps {
  onOpenMobileNav: () => void;
}

export function Header({ onOpenMobileNav }: HeaderProps) {
  return (
    <header
      role="banner"
      className="sticky top-0 z-30 flex h-12 w-full shrink-0 items-center justify-between border-b border-border/80 bg-background/95 px-4 backdrop-blur transition-all"
      data-testid="app-header"
    >
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Mobile Hamburger Button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenMobileNav}
          className="h-8 w-8 p-0 lg:hidden text-foreground hover:bg-muted"
          aria-label="Open navigation menu"
          data-testid="mobile-hamburger-button"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Dynamic Route Breadcrumbs */}
        <Breadcrumbs />
      </div>

      <div className="flex items-center gap-2">
        {/* Command Palette Trigger */}
        <CommandMenu />

        {/* Light / Dark Mode Switcher */}
        <ThemeToggle />
      </div>
    </header>
  );
}
