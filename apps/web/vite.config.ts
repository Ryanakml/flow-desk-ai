import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    proxy: {
      "/api": "http://localhost:4000",
      "/livez": "http://localhost:4000",
      "/readyz": "http://localhost:4000"
    }
  }
});
