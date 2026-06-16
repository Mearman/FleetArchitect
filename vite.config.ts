import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import postcssPresetMantine from "postcss-preset-mantine";
import { defineConfig } from "vitest/config";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";

/**
 * GitHub Pages serves the site at /FleetArchitect/, but local dev is nicer at /.
 * Detect CI via GITHUB_ACTIONS so the built artifact gets the right asset base.
 */
const base = process.env.CI ? "/FleetArchitect/" : "/";

export default defineConfig({
  base,
  plugins: [react(), vanillaExtractPlugin()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  css: {
    postcss: {
      plugins: [postcssPresetMantine()],
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "node",
    // Tests follow the foo.[unit,integration,e2e].test.ts convention.
    include: ["src/**/*.{unit,integration,e2e}.test.ts"],
    coverage: {
      include: ["src/domain/**/*.ts", "src/sharing/**/*.ts"],
    },
  },
});
