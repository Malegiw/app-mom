import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// base "./" keeps every asset path relative, so the same build works on
// GitHub Pages (https://user.github.io/repo/) and on any static host.
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Notula: notulen rapat",
        short_name: "Notula",
        description:
          "Rekam rapat Teams, Zoom, atau tatap muka. Dapatkan transkrip, notulen, dan ekspor Word, Excel, PowerPoint.",
        lang: "id",
        start_url: ".",
        scope: ".",
        display: "standalone",
        orientation: "any",
        background_color: "#ffffff",
        theme_color: "#0f4c81",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { port: 5173, strictPort: true },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
