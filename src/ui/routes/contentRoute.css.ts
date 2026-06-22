import { style } from "@vanilla-extract/css";

/**
 * Full-height scroll wrapper for content routes (Home, Import).
 *
 * On desktop the shell clips AppShell.Main to the viewport, so this wrapper
 * fills that region and scrolls *inside* it on unusually short viewports.
 * On mobile the page itself may scroll (shell reverts to min-height), so
 * this is transparent (height: auto, overflow: visible).
 */
export const contentRouteScroll = style({
  height: "100%",
  overflowY: "auto",
  overflowX: "hidden",

  "@media": {
    "(max-width: 48em)": {
      height: "auto",
      overflowY: "visible",
      overflowX: "visible",
    },
  },
});
