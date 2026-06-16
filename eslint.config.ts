import js from "@eslint/js";
import reactRefresh from "eslint-plugin-react-refresh";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "coverage", "pnpm-lock.yaml"],
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
    files: ["vite.config.ts", "eslint.config.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
