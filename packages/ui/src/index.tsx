import type { ReactNode } from "react";

export function StatusBadge({ children, healthy }: { children: ReactNode; healthy: boolean }) {
  return <span data-status={healthy ? "healthy" : "unavailable"}>{children}</span>;
}
