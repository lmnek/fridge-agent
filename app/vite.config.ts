import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const bridge = process.env.BRIDGE_URL ?? "http://127.0.0.1:8100";
const go2rtc = process.env.GO2RTC_URL ?? "http://127.0.0.1:1984";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    allowedHosts: [".trycloudflare.com"], // the Cloudflare quick tunnel for the stage and Twilio
    proxy: {
      // ws: the courier call's audio (Twilio in, the stage out) goes through the same proxy
      "/api": { target: bridge, changeOrigin: true, ws: true, rewrite: (p) => p.replace(/^\/api/, "") },
      // go2rtc (infra/go2rtc.sh): the Reolink player for the stage inset, same origin and through the tunnel
      "/go2rtc": { target: go2rtc, changeOrigin: true, ws: true, rewrite: (p) => p.replace(/^\/go2rtc/, "") },
    },
  },
});
