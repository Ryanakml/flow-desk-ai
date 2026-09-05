import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import { App } from "./App.js";

const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing");

const showDesignSystem =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("showcase") === "true";

if (showDesignSystem) {
  const DevShowcase = lazy(() =>
    import("./DesignSystemShowcase.js").then((m) => ({ default: m.DesignSystemShowcase }))
  );
  createRoot(root).render(
    <StrictMode>
      <Suspense
        fallback={
          <div style={{ padding: 24, fontFamily: "sans-serif" }}>
            Loading Design System Showcase…
          </div>
        }
      >
        <DevShowcase />
      </Suspense>
    </StrictMode>
  );
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
