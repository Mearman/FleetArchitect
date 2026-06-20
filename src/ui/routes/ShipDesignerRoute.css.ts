import { style } from "@vanilla-extract/css";

/** The grid canvas: a CSS grid laying out one button per cell. The column
 *  template is set inline per render (it depends on the grid width). */
export const gridBoard = style({
  display: "grid",
  gap: 2,
  width: "100%",
});

/** One paintable cell. Square, with a subtle border so empty cells are still
 *  visible targets. Position relative so edge indicators and overlays can
 *  anchor to the cell. */
export const gridCell = style({
  position: "relative",
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
  touchAction: "none",
  selectors: {
    "&:focus-visible": {
      outline: "2px solid #818cf8",
      outlineOffset: 1,
    },
  },
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

/**
 * Edge indicator base. Anchored to one side of the parent cell, sized so a
 * click target spans the full edge length. Walls render as a solid bar; doors
 * render as a thinner bar with a different colour. The four direction
 * modifiers place the indicator on the north/east/south/west edge.
 *
 * Cells are square with `aspectRatio: 1`, and the gap between cells is 2px
 * (the grid's `gap`). The edge bar sits just inside the cell border so it does
 * not overlap the neighbour; each edge belongs to the cell that owns it.
 */
const EDGE_THICKNESS_PX = 4;
const DOOR_THICKNESS_PX = 3;

export const edgeBarBase = style({
  position: "absolute",
  pointerEvents: "auto",
  cursor: "pointer",
});

/** Wall edge: a thick steel-grey bar sealing the side. */
export const edgeWall = [
  edgeBarBase,
  style({
    background: "#3a4154",
  }),
];

/** Door edge (closed): a warm amber bar — sealed but operable. */
export const edgeDoorClosed = [
  edgeBarBase,
  style({
    background: "#d68b3a",
  }),
];

/** Door edge (open): a thin amber outline — passable, leaks air. */
export const edgeDoorOpen = [
  edgeBarBase,
  style({
    background: "transparent",
    boxShadow: "inset 0 0 0 1px #d68b3a",
  }),
];

/** Position an edge indicator on the north/south/east/west side of its cell.
 *  Exported so `designerGrid.ts` can assemble the lookup function without
 *  re-exporting a function (vanilla-extract .css.ts files may only export
 *  plain serialisable values — strings, numbers, arrays, objects). */
export const edgeNorth = style({
  top: 0,
  left: 0,
  right: 0,
  height: EDGE_THICKNESS_PX,
});
export const edgeSouth = style({
  bottom: 0,
  left: 0,
  right: 0,
  height: EDGE_THICKNESS_PX,
});
export const edgeEast = style({
  top: 0,
  bottom: 0,
  right: 0,
  width: EDGE_THICKNESS_PX,
});
export const edgeWest = style({
  top: 0,
  bottom: 0,
  left: 0,
  width: EDGE_THICKNESS_PX,
});

/** Door position classes: thinner inset bars distinguishing open/closed state. */
export const doorNorth = style({
  top: 1,
  left: 2,
  right: 2,
  height: DOOR_THICKNESS_PX,
});
export const doorSouth = style({
  bottom: 1,
  left: 2,
  right: 2,
  height: DOOR_THICKNESS_PX,
});
export const doorEast = style({
  top: 2,
  bottom: 2,
  right: 1,
  width: DOOR_THICKNESS_PX,
});
export const doorWest = style({
  top: 2,
  bottom: 2,
  left: 1,
  width: DOOR_THICKNESS_PX,
});

/** Airtightness overlay: a red ring drawn around cells in a breached
 *  compartment, signalling that the compartment's perimeter is not sealed and
 *  its crew is exposed. Drawn as a box-shadow inset so it layers on top of the
 *  cell colour without obscuring the surface tint. */
export const breachOverlay = style({
  boxShadow: "inset 0 0 0 2px #e8453c",
});

/** Pan/zoom viewport. The grid sits inside a scrollable, horizontally and
 *  vertically overflowable container; `transform: scale()` applies zoom. The
 *  container has a fixed max height so large ships scroll instead of
 *  stretching the page. */
export const zoomViewport = style({
  overflow: "auto",
  maxHeight: "min(560px, 60vh)",
  minHeight: 200,
  resize: "vertical",
  border: "1px solid rgba(140,160,220,0.18)",
  borderRadius: 4,
  padding: 8,
  background: "rgba(8,10,18,0.6)",
});

/** Inner wrapper that the scale transform applies to. Width is set inline to
 *  the grid's natural pixel width so the viewport scrolls correctly when
 *  zoomed in. */
export const zoomInner = style({
  transformOrigin: "top left",
});
