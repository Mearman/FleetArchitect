import type { Options } from "semantic-release";

/**
 * Runs on `main`. Creates a versioned tag and a GitHub Release with generated
 * notes; @semantic-release/npm skips publishing (package.json is private: true)
 * but still bumps the version, and the changelog + git plugins commit
 * CHANGELOG.md and package.json back to main. The release commit's default
 * [skip ci] message avoids a redundant second Pages build.
 */
const config: Options = {
  branches: ["main"],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/changelog",
    "@semantic-release/npm",
    "@semantic-release/git",
    "@semantic-release/github",
  ],
};

export default config;
