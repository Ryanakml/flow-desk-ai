import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from "@flowdesk/ui";

interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const getCrumbs = (): Crumb[] => {
    const base: Crumb[] = [{ label: "FlowDesk", href: "/inbox" }];

    if (pathname === "/inbox") {
      base.push({ label: "Inbox" });
    } else if (pathname.startsWith("/inbox/")) {
      base.push({ label: "Inbox", href: "/inbox" });
      base.push({ label: "Conversation" });
    } else if (pathname === "/analytics") {
      base.push({ label: "Analytics" });
    } else if (pathname === "/knowledge") {
      base.push({ label: "AI Knowledge" });
    } else if (pathname === "/channels") {
      base.push({ label: "WhatsApp Channels" });
    } else if (pathname === "/developer/api-keys") {
      base.push({ label: "Developer", href: "/developer/api-keys" });
      base.push({ label: "API Keys" });
    } else if (pathname === "/developer/webhooks") {
      base.push({ label: "Developer", href: "/developer/webhooks" });
      base.push({ label: "Webhooks" });
    } else if (pathname === "/team") {
      base.push({ label: "Team & Members" });
    } else if (pathname === "/audit") {
      base.push({ label: "Audit Logs" });
    } else if (pathname === "/settings/workspace") {
      base.push({ label: "Settings", href: "/settings/workspace" });
      base.push({ label: "Workspace" });
    } else {
      // Fallback
      base.push({ label: "Overview" });
    }

    return base;
  };

  const crumbs = getCrumbs();

  return (
    <Breadcrumb className="hidden sm:flex" aria-label="Breadcrumb">
      <BreadcrumbList>
        {crumbs.map((crumb, idx) => {
          const isLast = idx === crumbs.length - 1;
          return (
            <React.Fragment key={idx}>
              <BreadcrumbItem>
                {isLast || !crumb.href ? (
                  <BreadcrumbPage className="font-medium text-xs sm:text-sm text-foreground">
                    {crumb.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    asChild
                    className="text-xs sm:text-sm text-muted-foreground hover:text-foreground"
                  >
                    <Link to={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
