import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const bridge = process.env.BRIDGE_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": { target: bridge, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") },
    },
  },
});
