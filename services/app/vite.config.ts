import { kitApp } from "@burgstaller/web/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The API serves dist/ (burgstaller-platform standards/architecture/one-image.md).
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    kitApp({
      name: "Padel Kärnten",
      description: "Wo in Kärnten noch ein Padel-Platz frei ist.",
      serviceWorker: "src/sw.ts",
      touchIcon: "public/apple-touch-icon.png",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      bootPicture:
        '<svg viewBox="0 0 64 64" aria-hidden="true"><g class="turn" style="transform-origin:38px 46px"><ellipse cx="28" cy="25" rx="13" ry="14" fill="var(--boot-accent)"/><rect x="33" y="35" width="7" height="17" rx="3.5" transform="rotate(-35 36.5 43.5)" fill="var(--boot-accent)"/></g><circle cx="47" cy="17" r="5" fill="var(--boot-ink)"/></svg>',
    }),
  ],
  // pnpm keeps kit/web in a folder whose name holds a "#", which Vitest
  // reads as the start of a fragment; the link in node_modules has none.
  resolve: { preserveSymlinks: process.env.VITEST === "true" },
  server: {
    proxy: {
      "/api": "http://localhost:8080",
      // The local sign-in (ENVIRONMENT=local); its cookie is then this origin's.
      "/dev-gateway": "http://localhost:8080",
    },
  },
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "https://padel.test/" } },
    setupFiles: ["./src/test/setup.ts"],

    coverage: {
      provider: "v8",
      // The gate reads coverage-summary.json (tools/gate.py).
      reporter: ["text", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/test/**", "src/**/*.test.*", "src/**/*.d.ts", "src/main.tsx", "src/sw.ts"],
      // standards/quality/coverage.md: the floor every part keeps.
      thresholds: { statements: 85, lines: 85 },
    },
  },
});
