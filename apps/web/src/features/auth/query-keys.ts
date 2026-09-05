export const authKeys = {
  all: ["auth"] as const,
  session: () => [...authKeys.all, "session"] as const,
  organizations: () => [...authKeys.all, "organizations"] as const
};
