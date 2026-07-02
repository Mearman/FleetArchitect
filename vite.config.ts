import { execSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

import { transformSync, type PluginItem } from "@babel/core";
import react from "@vitejs/plugin-react";
import postcssPresetMantine from "postcss-preset-mantine";
import { defineConfig } from "vitest/config";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import type { PluginOption } from "vite";

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
// OWNER/REPO slug parsed from the git remote; `buildDate` is the tag's creation
// date for releases or the commit date otherwise.
const buildHash = git("git rev-parse --short HEAD");
const buildTag = git("git describe --tags --exact-match HEAD");
const buildRepo = git("git config --get remote.origin.url")
  .replace(/^.*github\.com[:/]/, "")
  .replace(/\.git$/, "");
const buildDate =
  buildTag !== ""
    ? git(`git for-each-ref --format='%(creatordate:iso-strict)' refs/tags/${buildTag}`)
    : git("git log -1 --format=%cI HEAD");

/** babel-plugin-react-compiler with default (compile-everything) options.
 *  Typed as a tuple so the literal isn't widened to `(string | object)[]`. */
const reactCompilerBabelPlugin: PluginItem = ["babel-plugin-react-compiler", {}];

/** Babel's `parserOpts.plugins` element type (the strict literal union from
 *  @babel/parser), derived from transformSync's own signature so no extra type
 *  import is needed. `@babel/core` v8 ships its own types and does not export
 *  ParserOptions, and @babel/parser is not a direct dependency under pnpm. */
type BabelParserPlugin = NonNullable<
  NonNullable<NonNullable<NonNullable<Parameters<typeof transformSync>[1]>["parserOpts"]>["plugins"]>[number]
>;

/**
 * React Compiler (stable 1.0) auto-memoises components and hooks at build time.
 *
 * Runs as a `post` transform over @babel/core. Two findings drove this shape:
 *
 * 1. It must run AFTER plugin-react's oxc JSX/TypeScript transform, not before.
 *    The compiler expects the `_jsx()` call form that a JSX transform emits
 *    (that is the order it runs in inside a normal babel-preset-react pipeline).
 *    Run as `pre`, the compiler emits memoisation into source that still has
 *    JSX, and the subsequent oxc pass then strips it — verified by A/B: a `pre`
 *    plugin produced a byte-identical bundle to no compiler at all. As `post`,
 *    oxc has already produced `_jsx()` calls and the compiler's memoisation
 *    survives into the bundle (A/B: 957.83 kB without vs 963.72 kB with).
 *
 * 2. The path the @vitejs/plugin-react v6 README suggests — `reactCompilerPreset`
 *    via `@rolldown/plugin-babel` — is a silent no-op here: that plugin assigns
 *    `transform.filter` inside `configResolved`, but this Vite/Rolldown reads a
 *    hook's filter at registration, so the babel pass never runs (verified by
 *    A/B: identical bundle with and without it). Running the compiler directly
 *    through @babel/core with an inline filter is reliable, so that is what this
 *    does, and `@rolldown/plugin-babel` is not a dependency.
 *
 * Scoped to the React layer (src/ui/** plus the src/main.tsx entry) so the pure,
 * determinism-critical domain/schema/storage/sharing/data layers are never fed
 * to the compiler. The compiler-aware lint rules (purity, immutability,
 * set-state-in-render, preserve-manual-memoization, …) already ship in the
 * react-hooks `recommended` preset, so eslint.config.ts is unchanged.
 */
const reactCompiler: PluginOption = {
  name: "react-compiler",
  enforce: "post",
  transform: {
    filter: { id: /\.[tj]sx?$/ },
    handler(code, id) {
      // Virtual modules and dependencies are none of the compiler's business.
      if (id.includes("\0") || id.includes("node_modules")) return undefined;
      // Only compile the React layer; keep domain logic React-free (CLAUDE.md).
      if (!/[\\/]src[\\/](?:ui[\\/]|main\.tsx$)/.test(id)) return undefined;
      const parserPlugins: BabelParserPlugin[] = [];
      if (id.endsWith(".ts") || id.endsWith(".tsx")) parserPlugins.push("typescript");
      if (id.endsWith(".jsx") || id.endsWith(".tsx")) parserPlugins.push("jsx");
      let result: ReturnType<typeof transformSync>;
      try {
        result = transformSync(code, {
          filename: id,
          babelrc: false,
          configFile: false,
          sourceMaps: true,
          parserOpts: { plugins: parserPlugins },
          plugins: [reactCompilerBabelPlugin],
        });
      } catch (error) {
        this.error(`[react-compiler] ${error instanceof Error ? error.message : String(error)}`);
      }
      const compiled = result?.code;
      if (compiled === undefined || compiled === null || compiled === code) return undefined;
      // Babel's EncodedSourceMap carries readonly `names`; Vite takes a string
      // or mutable SourceMap, so serialise to satisfy both without a cast.
      return {
        code: compiled,
        map: result && result.map ? JSON.stringify(result.map) : undefined,
      };
    },
  },
};

export default defineConfig({
  base,
  plugins: [react(), reactCompiler, vanillaExtractPlugin()],
  define: {
    __BUILD_HASH__: JSON.stringify(buildHash),
    __BUILD_TAG__: JSON.stringify(buildTag),
    __BUILD_REPO__: JSON.stringify(buildRepo),
    __BUILD_DATE__: JSON.stringify(buildDate),
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
    // Production builds ship without sourcemaps: the .map files are larger than
    // the JS they accompany (the entry chunk's map alone was ~1.4 MB) and would
    // bloat the GitHub Pages deploy for no runtime benefit. Dev keeps sourcemaps
    // regardless — this flag governs only the production build.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split stable vendor code into separately-cached chunks so a browser
        // cache survives app-code changes. The function form keys on the
        // resolved node_modules path; react-router is matched before react so
        // the router is not folded into the react chunk.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@mantine")) return "vendor-mantine";
          if (id.includes("react-router")) return "vendor-router";
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/")
          ) {
            return "vendor-react";
          }
          if (
            id.includes("/dexie") ||
            id.includes("lz-string") ||
            id.includes("/zod/")
          ) {
            return "vendor-data";
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "node",
    testTimeout: 30000,
    // Tests follow the foo.[unit,integration,e2e].test.ts convention.
    include: ["src/**/*.{unit,integration,e2e}.test.ts"],
    coverage: {
      include: ["src/domain/**/*.ts", "src/sharing/**/*.ts"],
    },
  },
});
