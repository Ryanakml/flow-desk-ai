import { describe, expect, it } from "vitest";
import {
  getPermissionsForRole,
  hasPermission,
  isStandardRole,
  STANDARD_ROLES
} from "./permissions.js";

describe("Domain Role Matrix and Permissions (M1-05)", () => {
  it("defines all 6 standard roles matching the M1 draft", () => {
    const roleKeys = STANDARD_ROLES.map((r) => r.key);
    expect(roleKeys).toEqual(["owner", "admin", "supervisor", "agent", "analyst", "billing_admin"]);
    expect(isStandardRole("owner")).toBe(true);
    expect(isStandardRole("unknown")).toBe(false);
  });

  it("enforces owner capabilities", () => {
    expect(hasPermission("owner", "org:security:manage")).toBe(true);
    expect(hasPermission("owner", "membership:invite")).toBe(true);
    expect(hasPermission("owner", "billing:manage")).toBe(true);
    expect(hasPermission("owner", "audit:view")).toBe(true);
  });

  it("enforces admin capabilities (cannot manage billing)", () => {
    expect(hasPermission("admin", "org:security:manage")).toBe(true);
    expect(hasPermission("admin", "membership:invite")).toBe(true);
    expect(hasPermission("admin", "billing:manage")).toBe(false);
    expect(hasPermission("admin", "audit:view")).toBe(true);
  });

  it("enforces supervisor capabilities (cannot invite members or manage settings)", () => {
    expect(hasPermission("supervisor", "membership:invite")).toBe(false);
    expect(hasPermission("supervisor", "org:security:manage")).toBe(false);
    expect(hasPermission("supervisor", "conversation:assign")).toBe(true);
    expect(hasPermission("supervisor", "conversation:resolve")).toBe(true);
    expect(hasPermission("supervisor", "analytics:view")).toBe(true);
  });

  it("enforces agent capabilities (scoped to read, send, and membership:read)", () => {
    expect(hasPermission("agent", "membership:read")).toBe(true);
    expect(hasPermission("agent", "membership:invite")).toBe(false);
    expect(hasPermission("agent", "message:send")).toBe(true);
    expect(hasPermission("agent", "conversation:resolve")).toBe(false);
    expect(hasPermission("agent", "audit:view")).toBe(false);
  });

  it("enforces analyst capabilities (read analytics and audit, no message sending)", () => {
    expect(hasPermission("analyst", "analytics:view")).toBe(true);
    expect(hasPermission("analyst", "audit:view")).toBe(true);
    expect(hasPermission("analyst", "message:send")).toBe(false);
    expect(hasPermission("analyst", "membership:invite")).toBe(false);
  });

  it("enforces billing admin capabilities (billing:manage, no settings/invites)", () => {
    expect(hasPermission("billing_admin", "billing:manage")).toBe(true);
    expect(hasPermission("billing_admin", "membership:invite")).toBe(false);
    expect(hasPermission("billing_admin", "org:security:manage")).toBe(false);
    expect(hasPermission("billing_admin", "message:send")).toBe(false);
  });

  it("denies unknown roles and permissions", () => {
    expect(hasPermission("guest", "membership:read")).toBe(false);
    expect(getPermissionsForRole("nonexistent")).toEqual([]);
  });
});
