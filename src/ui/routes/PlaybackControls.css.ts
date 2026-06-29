import { style } from "@vanilla-extract/css";

/**
 * The speed control is two Mantine Sliders stacked in the same grid cell so they
 * share identical track geometry (no manual pixel-math to align the bars). The
 * desired slider (amber via the theme's primaryColor) is the interactive one; the
 * sim slider overlays it with pointer-events disabled and only its bar visible
 * — styled inline on the component to win the specificity fight over Mantine's
 * own module CSS — so the sim bar's tip sits exactly where the desired bar would.
 */

/** Grid wrapper sized to give the speed rail a usable width in the control row. */
export const speedSliderWrap = style({
  display: "grid",
  width: "9rem",
  minWidth: "7rem",
  alignItems: "center",
});

/** Pins both stacked sliders into the single grid cell so they overlap. */
export const speedSliderLayer = style({
  gridArea: "1 / 1",
});
