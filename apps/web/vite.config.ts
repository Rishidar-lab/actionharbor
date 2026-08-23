import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = process.env["ACTIONHARBOR_API_PORT"] ?? "8787";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});
