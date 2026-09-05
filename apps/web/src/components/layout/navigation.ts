import {
  Inbox,
  BarChart3,
  Brain,
  MessageCircle,
  Users,
  KeyRound,
  Webhook,
  ShieldCheck,
  Settings,
  type LucideIcon
} from "lucide-react";
import type { Permission } from "@flowdesk/domain";

export type AppRoutePath =
  | "/inbox"
  | "/analytics"
  | "/knowledge"
  | "/channels"
  | "/team"
  | "/developer/api-keys"
  | "/developer/webhooks"
  | "/audit"
  | "/settings/workspace";

export interface NavItem {
  title: string;
  href: AppRoutePath;
  icon: LucideIcon;
  exact?: boolean;
  permission?: Permission;
  aliases?: string[];
}

export interface NavGroup {
  heading: string;
  items: NavItem[];
}

export const navigationGroups: NavGroup[] = [
  {
    heading: "OPERATIONS",
    items: [
      {
        title: "Inbox",
        href: "/inbox",
        icon: Inbox,
        exact: false,
        aliases: ["conversations", "messages", "threads", "chat"]
      },
      {
        title: "Analytics",
        href: "/analytics",
        icon: BarChart3,
        exact: true,
        aliases: ["sla", "reports", "metrics", "stats"]
      }
    ]
  },
  {
    heading: "AI",
    items: [
      {
        title: "Knowledge Base",
        href: "/knowledge",
        icon: Brain,
        exact: true,
        aliases: ["ai", "documents", "sources", "bot", "rag"]
      }
    ]
  },
  {
    heading: "MANAGE",
    items: [
      {
        title: "WhatsApp Channels",
        href: "/channels",
        icon: MessageCircle,
        exact: true,
        aliases: ["whatsapp", "phone", "meta", "waba"]
      },
      {
        title: "Team & Members",
        href: "/team",
        icon: Users,
        exact: true,
        aliases: ["members", "roles", "users", "invites"]
      }
    ]
  },
  {
    heading: "DEVELOPERS",
    items: [
      {
        title: "API Keys",
        href: "/developer/api-keys",
        icon: KeyRound,
        exact: true,
        aliases: ["api", "keys", "tokens", "credentials"]
      },
      {
        title: "Webhooks",
        href: "/developer/webhooks",
        icon: Webhook,
        exact: true,
        aliases: ["webhooks", "events", "subscriptions", "deliveries"]
      }
    ]
  },
  {
    heading: "SECURITY",
    items: [
      {
        title: "Audit Logs",
        href: "/audit",
        icon: ShieldCheck,
        exact: true,
        permission: "audit:view",
        aliases: ["audit", "logs", "security", "history", "compliance"]
      }
    ]
  }
];

export const workspaceSettingsItem: NavItem = {
  title: "Workspace Settings",
  href: "/settings/workspace",
  icon: Settings,
  exact: true,
  aliases: ["workspace", "settings", "organization", "config"]
};

export function isRouteActive(pathname: string, href: string, exact = false): boolean {
  if (exact) {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
