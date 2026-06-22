import { style } from "@vanilla-extract/css";

/**
 * Three-zone battle console layout.
 *
 * Desktop: [ setup wing | screen centre | controls wing ] — fixed cassette
 * panels flanking the screen, no collapse or drawers.
 * Mobile:  a vertical stack; CSS `order` keeps the screen on top and the wings
 * stack beneath it, with the page scrolling.
 */

/** Outer flex-row holding the two wings and the screen centre. */
export const workspace = style({
  display: "flex",
  flexDirection: "row",
  alignItems: "stretch",
  width: "100%",
  height: "100%",
  minHeight: 0,
  flex: "1 1 auto",
  gap: 8,
  "@media": {
    "(max-width: 48em)": {
      flexDirection: "column",
      height: "auto",
      minHeight: "auto",
    },
  },
});

/**
 * Fixed side wing — a cassette panel bolted alongside the screen (composed with
 * `cassettePanel` via the component className). On desktop it matches the screen
 * height (the row stretches it) and its body scrolls internally; the outer panel
 * keeps overflow visible so its amber corner brackets are never clipped. On
 * mobile it becomes full-width and the page scrolls instead.
 */
export const wing = style({
  flex: "0 0 300px",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  padding: 12,
  "@media": {
    "(max-width: 48em)": {
      flex: "1 1 auto",
      minHeight: "auto",
    },
  },
});

/** Scrollable body inside a wing — scrolls here, not on the bracketed panel. */
export const wingBody = style({
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  "@media": {
    "(max-width: 48em)": {
      overflowY: "visible",
    },
  },
});

/** Centre column: screen + playback bar, taking all remaining width. */
export const centre = style({
  flex: "1 1 auto",
  minWidth: 0,
  minHeight: 0,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  "@media": {
    "(max-width: 48em)": {
      order: -1,
      height: "auto",
      minHeight: "auto",
    },
  },
});
