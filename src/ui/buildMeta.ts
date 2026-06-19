const repo = __BUILD_REPO__;
const hash = __BUILD_HASH__;
const tag = __BUILD_TAG__;

const ready = repo !== "" && hash !== "";

/**
 * Top-bar build link, resolved at build time. A tagged build links to its
 * GitHub release; any other build links to its commit. `undefined` when the
 * bundle wasn't built from a git checkout (no repo/hash), so the link is left
 * out rather than rendered broken.
 */
export const buildMeta = !ready
  ? undefined
  : tag !== ""
    ? { label: tag, href: `https://github.com/${repo}/releases/tag/${tag}` }
    : { label: hash, href: `https://github.com/${repo}/commit/${hash}` };
