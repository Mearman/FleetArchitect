/**
 * Shared layout dimensions used by both the React shell (`layout.tsx`, for the
 * Mantine `AppShell` header height prop) and the zero-runtime styles
 * (`layout.css.ts`, for the viewport-fill `calc`). Defined once here so the two
 * never drift — the bounded `AppShell.Main` height is exactly the viewport minus
 * this header, and a literal in either place would be a magic number.
 */
export const HEADER_HEIGHT_PX = 56;

/** Breakpoint below which the layout reverts to a scrolling, stacked page. */
export const MOBILE_MEDIA_QUERY = "(max-width: 48em)";
