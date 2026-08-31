import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { ActiveThemeProvider } from "@/components/themes/active-theme";
import { Toaster } from "@/components/ui/sonner";
import { App } from "./App.js";
import "./styles/globals.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing");
createRoot(root).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <ActiveThemeProvider initialTheme="whatsapp">
        <App />
        <Toaster />
      </ActiveThemeProvider>
    </ThemeProvider>
  </StrictMode>
);
