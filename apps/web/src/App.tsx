import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen.js";
import { queryClient } from "./lib/query-client.js";
import { AuthProvider } from "./features/auth/context.js";
import "./styles.css";

export const router = createRouter({
  routeTree,
  defaultPreload: "intent"
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
