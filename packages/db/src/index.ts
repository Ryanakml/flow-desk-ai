export const DATABASE_PACKAGE_STATE = "m0-schema-pending" as const;

export function assertLocalDatabaseReset(appEnvironment: string): void {
  if (appEnvironment !== "local") throw new Error("Database reset is restricted to APP_ENV=local");
}
