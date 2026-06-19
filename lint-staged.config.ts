import type { Configuration } from "lint-staged";

/**
 * ESLint --fix is the project's only formatter (no Prettier). Kept fast on
 * pre-commit; the full test suite runs on pre-push (.husky/pre-push).
 */
const config: Configuration = {
  "*.{ts,tsx}": "eslint --fix",
};

export default config;
