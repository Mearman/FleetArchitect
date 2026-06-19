import { execSync } from "node:child_process";
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

/** Run a git command at config-load time. Returns "" on failure — HEAD not
 * being an exact tag is the normal "not a release build" case, not an error. */
function git(command: string): string {
  try {
    return execSync(command, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

// Build-time metadata injected into the bundle for the top-bar link. `buildTag`
// is non-empty only when HEAD is exactly a release tag; `buildRepo` is the
// OWNER/REPO slug parsed from the git remote.
const buildHash = git("git rev-parse --short HEAD");
const buildTag = git("git describe --tags --exact-match HEAD");
const buildRepo = git("git config --get remote.origin.url")
  .replace(/^.*github\.com[:/]/, "")
  .replace(/\.git$/, "");

export default defineConfig({
  base,
  plugins: [react(), vanillaExtractPlugin()],
  define: {
    __BUILD_HASH__: JSON.stringify(buildHash),
    __BUILD_TAG__: JSON.stringify(buildTag),
    __BUILD_REPO__: JSON.stringify(buildRepo),
  },
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
