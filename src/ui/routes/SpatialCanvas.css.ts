import { style } from "@vanilla-extract/css";
import { vars } from "@/ui/theme/vars.css";

/**
 * Deployment-preview canvas styling. The canvas is a fixed-aspect viewport that
 * renders the resolved formation geometry (previewLeaves) as coloured glyphs.
 * A graticule and centre cross establish the root origin; formations are
 * distinguished by colour so a player can see the authored layout at a glance.
 */

/** Outer panel body holding the canvas + legend. */
export const canvasBody = style({
  display: "flex",
  flexDirection: "column",
  gap: "0.3rem",
});

/** The canvas viewport — relative, so glyphs and graticule overlay absolutely. */
export const canvasViewport = style({
  position: "relative",
  width: "100%",
  height: "200px",
  background: vars.color.base,
  border: `1px solid ${vars.color.border}`,
  boxShadow: [`inset 0 1px 3px ${vars.material.bevelShadowDeep}`].join(", "),
  overflow: "hidden",
  cursor: "crosshair",
  flexShrink: 0,
});

/** The SVG layer filling the viewport (graticule + glyphs). */
export const canvasSvg = style({
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  display: "block",
});

/** A draggable ship glyph. */
export const glyph = style({
  cursor: "grab",
  selectors: {
    "&:active": {
      cursor: "grabbing",
    },
  },
});

/** Empty-state copy when there are no leaves to preview. */
export const canvasEmpty = style({
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: vars.font.mono,
  fontSize: "0.58rem",
  letterSpacing: "0.06em",
  color: `color-mix(in srgb, ${vars.color.text} 45%, transparent)`,
  pointerEvents: "none",
});

/** Legend row of formation colour chips. */
export const legendRow = style({
  display: "flex",
  flexWrap: "wrap",
  gap: "0.4rem",
  fontFamily: vars.font.mono,
  fontSize: "0.55rem",
  letterSpacing: "0.04em",
  color: `color-mix(in srgb, ${vars.color.text} 65%, transparent)`,
});

/** One legend chip: a colour swatch + label. */
export const legendChip = style({
  display: "flex",
  alignItems: "center",
  gap: "0.2rem",
});

/** The colour swatch of a legend chip. */
export const legendSwatch = style({
  width: "0.6rem",
  height: "0.6rem",
  border: `1px solid ${vars.color.border}`,
  flexShrink: 0,
});

/** Hint text under the canvas. */
export const canvasHint = style({
  fontFamily: vars.font.mono,
  fontSize: "0.52rem",
  letterSpacing: "0.04em",
  color: `color-mix(in srgb, ${vars.color.text} 45%, transparent)`,
});
