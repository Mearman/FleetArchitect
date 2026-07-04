import js from "@eslint/js";
import reactRefresh from "eslint-plugin-react-refresh";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "coverage", "pnpm-lock.yaml", ".claude", "scripts"],
  },
  {
    // Pin the TSConfig root so the parser isn't confused by stray
    // tsconfig.json files elsewhere in the tree (e.g. registered git
    // worktrees under .claude/). Required because lint-staged runs eslint
    // at commit time.
    //
    // `projectService` (global — no `files` filter) powers the type-checked
    // rules below; it must apply to every matched file or the type-checked
    // configs crash on files outside the program.
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Type-checked tier: catches floating promises, misused async handlers,
  // unsafe `any`, and invalid template expressions. Requires the
  // `projectService` parser option set in the block above.
  ...tseslint.configs.recommendedTypeChecked,
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
    // Max file length across all source — logic, data, routes, styles, and
    // tests alike. 800 gives headroom over the largest cohesive module (~690
    // lines, stats.ts) and the largest test (~680, engine.orders) while
    // blocking god-files: the former engine.ts was 7335 and BattleRoute.tsx
    // was 1705 before they were split into packages. When a file grows past
    // it, split the file rather than relax the rule.
    files: ["src/**/*.{ts,tsx}"],
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
