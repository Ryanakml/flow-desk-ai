import { v7 as uuidv7 } from "uuid";
export { withTenantTransaction, type TenantContext } from "./tenant-context.js";

export const DATABASE_PACKAGE_STATE = "m1-foundation-ready" as const;

export const DATABASE_ROLE_NAMES = {
  migrator: "flowdesk_migrator",
  runtime: "flowdesk_runtime",
  reporting: "flowdesk_reporting",
  breakGlass: "flowdesk_break_glass"
} as const;

export function createDatabaseId(): string {
  return uuidv7();
}

export function assertLocalDatabaseReset(appEnvironment: string): void {
  if (appEnvironment !== "local") throw new Error("Database reset is restricted to APP_ENV=local");
}
