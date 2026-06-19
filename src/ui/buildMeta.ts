const repo = __BUILD_REPO__;
const hash = __BUILD_HASH__;
const tag = __BUILD_TAG__;
const date = __BUILD_DATE__;

const ready = repo !== "" && hash !== "";

/** "X ago" relative to now, in the browser locale. "" if `iso` is unparsable. */
function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 30) return rtf.format(-days, "day");
  const months = Math.floor(days / 30);
  if (months < 12) return rtf.format(-months, "month");
  return rtf.format(-Math.floor(days / 365), "year");
}

const verb = tag !== "" ? "Released" : "Committed";
const ago = timeAgo(date);
const title = ago !== "" ? `${verb} ${ago}` : verb;

/**
 * Top-bar build link, resolved at build time. A tagged build links to its
 * GitHub release; any other build links to its commit. `undefined` when the
 * bundle wasn't built from a git checkout (no repo/hash), so the link is left
 * out rather than rendered broken. `title` is a "Released/Committed X ago"
 * tooltip, frozen at page-load time.
 */
export const buildMeta = !ready
  ? undefined
  : tag !== ""
    ? { label: tag, href: `https://github.com/${repo}/releases/tag/${tag}`, title }
    : { label: hash, href: `https://github.com/${repo}/commit/${hash}`, title };
