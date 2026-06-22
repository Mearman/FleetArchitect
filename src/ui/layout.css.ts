import { globalStyle, style } from "@vanilla-extract/css";
import { HEADER_HEIGHT_PX, MOBILE_MEDIA_QUERY } from "./layoutConstants";

/**
 * The bounded fill region applied to Mantine's `AppShell.Main`. This is the top
 * of the viewport-fill flex chain: it pins the routed area to exactly the space
 * below the fixed header, becomes a flex column its single route child fills,
 * and clips its own overflow so inner panels — not the page — scroll.
 *
 * Geometry: Mantine's header is `position: fixed` at the top, and `AppShell.Main`
 * spans from the viewport top with `padding-top: <header-offset>` to clear it.
 * So locking the main box to `height: 100dvh` (border-box) with that padding
 * retained leaves a content area of exactly `100dvh - headerHeight` — the route
 * child's `height: 100%` resolves to that. We keep the top padding equal to the
 * header height and override Mantine's `min-height: 100dvh` (which would
 * otherwise let the box grow past the viewport and reintroduce a page scrollbar)
 * and `padding-bottom`.
 *
 * Specificity: Mantine's `AppShell.Main` styles sit at single-class specificity
 * (0,1,0). `AppShell.Main` renders as a `<main>` element, so compounding the
 * element type onto our class (`main.<mainRegion>` → 0,1,1) wins deterministically
 * regardless of stylesheet source order, without depending on Mantine's internal
 * hashed or static class names.
 */
export const mainRegion = style({});

globalStyle(`main${mainRegion}`, {
  height: "100dvh",
  minHeight: 0,
  paddingTop: HEADER_HEIGHT_PX,
  paddingBottom: 0,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  "@media": {
    [MOBILE_MEDIA_QUERY]: {
      height: "auto",
      minHeight: "auto",
      overflow: "visible",
      display: "block",
    },
  },
});

/**
 * The single route child fills the bounded main region and may shrink below its
 * content (so inner scroll regions, not the page, scroll). On mobile it grows
 * naturally and the page scrolls.
 */
globalStyle(`main${mainRegion} > *`, {
  flex: "1 1 auto",
  minHeight: 0,
  "@media": {
    [MOBILE_MEDIA_QUERY]: {
      flex: "0 0 auto",
      minHeight: "auto",
    },
  },
});
