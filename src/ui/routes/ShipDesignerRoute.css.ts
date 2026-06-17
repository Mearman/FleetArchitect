import { style } from "@vanilla-extract/css";

/** The grid canvas: a CSS grid laying out one button per cell. The column
 *  template is set inline per render (it depends on the grid width). */
export const gridBoard = style({
  display: "grid",
  gap: 2,
  width: "100%",
  maxWidth: 420,
});

/** One paintable cell. Square, with a subtle border so empty cells are still
 *  visible targets. */
export const gridCell = style({
  aspectRatio: "1 / 1",
  border: "1px solid rgba(140,160,220,0.25)",
  borderRadius: 3,
  padding: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 10,
  fontWeight: 700,
  cursor: "pointer",
  color: "#05060a",
  lineHeight: 1,
  userSelect: "none",
});

/** Wrapper to position the facing tick relative to the cell content. */
export const cellInner = style({
  position: "relative",
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
});

/** Marker showing a module cell's facing as a short tick from centre. */
export const facingTick = style({
  position: "absolute",
  width: 2,
  height: "42%",
  background: "rgba(5,6,10,0.7)",
  transformOrigin: "bottom center",
  bottom: "50%",
  left: "calc(50% - 1px)",
});
