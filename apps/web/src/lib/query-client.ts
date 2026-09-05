import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "../api.js";

/**
 * Global QueryClient defaults:
 * - Does NOT aggressively retry 401 Unauthorized or 403 Forbidden errors.
 * - Refetches on window focus are disabled globally to prevent sudden network storms during operator typing.
 * - Mutation/query errors remain observable rather than swallowed globally.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 0,
        retry(failureCount, error) {
          // Never retry authentication or permission errors
          if (error instanceof ApiError) {
            if (error.status === 401 || error.status === 403 || error.status === 404) {
              return false;
            }
          }
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
        refetchOnReconnect: true
      },
      mutations: {
        retry: false
      }
    }
  });
}

export const queryClient = createQueryClient();
