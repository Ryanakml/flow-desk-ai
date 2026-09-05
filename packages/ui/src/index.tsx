import * as React from "react";
import { Badge } from "./components/badge.js";

// Backwards compatibility for legacy StatusBadge callers
export function StatusBadge({
  children,
  healthy
}: {
  children: React.ReactNode;
  healthy: boolean;
}) {
  return (
    <Badge
      variant={healthy ? "success" : "destructive"}
      data-status={healthy ? "healthy" : "unavailable"}
    >
      {children}
    </Badge>
  );
}

// Universal utilities
export { cn } from "./lib/utils.js";

// Universal presentation primitives
export * from "./components/button.js";
export * from "./components/badge.js";
export * from "./components/card.js";
export * from "./components/dialog.js";
export * from "./components/alert-dialog.js";
export * from "./components/dropdown-menu.js";
export * from "./components/popover.js";
export * from "./components/label.js";
export * from "./components/input.js";
export * from "./components/textarea.js";
export * from "./components/select.js";
export * from "./components/checkbox.js";
export * from "./components/switch.js";
export * from "./components/table.js";
export * from "./components/tooltip.js";
export * from "./components/sheet.js";
export * from "./components/separator.js";
export * from "./components/scroll-area.js";
export * from "./components/tabs.js";
export * from "./components/breadcrumb.js";
export * from "./components/skeleton.js";
export * from "./components/empty-state.js";
export * from "./components/avatar.js";
export * from "./components/command.js";
