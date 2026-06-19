import js from "@eslint/js";
import reactRefresh from "eslint-plugin-react-refresh";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "coverage", "pnpm-lock.yaml", ".claude"],
  },
  {
    // Pin the TSConfig root so the parser isn't confused by stray
    // tsconfig.json files elsewhere in the tree (e.g. registered git
    // worktrees under .claude/). Required because lint-staged runs eslint
    // at commit time.
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // No inline eslint-disable / config comments anywhere.
    linterOptions: { noInlineConfig: true },
  },
  {
    // Project-wide strict rules. Unused vars are already banned by the
    // recommended preset plus tsconfig's noUnusedLocals/noUnusedParameters.
    rules: {
      // Ban type assertions. Narrow with a type guard or parse with Zod
      // instead — never `as` or angle-bracket casts.
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAsExpression, TSTypeAssertion",
          message:
            "Type assertions (as / angle-bracket) are banned. Narrow with a type guard or parse with Zod instead.",
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
    },
  },
  {
    // Max source file length. The largest cohesive module after the engine /
    // catalog / presets split is ~690 lines (stats.ts); 800 gives headroom
    // while blocking god-files (the former engine.ts was 7335). Scoped to .ts
    // source for now — the .tsx routes (BattleRoute.tsx, ShipDesignerRoute.tsx)
    // still exceed it and are a follow-up split. Tests are excluded: they are
    // fixture-heavy by nature.
    files: ["src/**/*.ts"],
    ignores: ["**/*.test.ts", "**/*.css.ts"],
    rules: {
      "max-lines": ["error", { max: 800, skipBlankLines: false, skipComments: false }],
    },
  },
  {
    files: ["vite.config.ts", "eslint.config.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
