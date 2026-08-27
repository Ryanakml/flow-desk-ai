export type RoleKey = "owner" | "admin" | "supervisor" | "agent" | "analyst" | "billing_admin";

export const STANDARD_ROLES: readonly { key: RoleKey; label: string }[] = [
  { key: "owner", label: "Owner" },
  { key: "admin", label: "Administrator" },
  { key: "supervisor", label: "Supervisor" },
  { key: "agent", label: "Agent" },
  { key: "analyst", label: "Analyst" },
  { key: "billing_admin", label: "Billing Administrator" }
] as const;

export type Permission =
  | "org:security:manage"
  | "membership:read"
  | "membership:invite"
  | "membership:modify"
  | "membership:revoke"
  | "channel:manage"
  | "channel:view"
  | "conversation:assign"
  | "conversation:resolve"
  | "conversation:read"
  | "message:send"
  | "automation:publish"
  | "analytics:view"
  | "billing:manage"
  | "audit:view";

const ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  owner: [
    "org:security:manage",
    "membership:read",
    "membership:invite",
    "membership:modify",
    "membership:revoke",
    "channel:manage",
    "channel:view",
    "conversation:assign",
    "conversation:resolve",
    "conversation:read",
    "message:send",
    "automation:publish",
    "analytics:view",
    "billing:manage",
    "audit:view"
  ],
  admin: [
    "org:security:manage",
    "membership:read",
    "membership:invite",
    "membership:modify",
    "membership:revoke",
    "channel:manage",
    "channel:view",
    "conversation:assign",
    "conversation:resolve",
    "conversation:read",
    "message:send",
    "automation:publish",
    "analytics:view",
    "audit:view"
  ],
  supervisor: [
    "membership:read",
    "channel:view",
    "conversation:assign",
    "conversation:resolve",
    "conversation:read",
    "message:send",
    "analytics:view"
  ],
  agent: ["membership:read", "channel:view", "conversation:read", "message:send"],
  analyst: ["membership:read", "channel:view", "conversation:read", "analytics:view", "audit:view"],
  billing_admin: ["membership:read", "billing:manage"]
};

export function isStandardRole(roleKey: string): roleKey is RoleKey {
  return roleKey in ROLE_PERMISSIONS;
}

export function hasPermission(roleKey: string, permission: Permission): boolean {
  const rolePermissions = ROLE_PERMISSIONS[roleKey as RoleKey];
  if (!rolePermissions) return false;
  return rolePermissions.includes(permission);
}

export function getPermissionsForRole(roleKey: string): readonly Permission[] {
  return ROLE_PERMISSIONS[roleKey as RoleKey] ?? [];
}
