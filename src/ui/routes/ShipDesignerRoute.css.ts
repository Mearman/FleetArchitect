import { style } from "@vanilla-extract/css";
import { vars } from "@/ui/theme/vars.css";

/**
 * Ship designer console layout. Mirrors the BattleWorkspace fixed-wing pattern:
 * a flex-row of two CassettePanel wings flanking a centre column holding the grid.
 * Reflows to a column on mobile with the grid up top.
 */

/** Outer flex-row holding the left wing, centre grid, and right wing. */
export const designerConsole = style({
  display: "flex",
  flexDirection: "row",
  alignItems: "stretch",
  width: "100%",
  gap: 8,
  "@media": {
    "(max-width: 48em)": {
      flexDirection: "column",
    },
  },
});

/**
 * Side wing — fixed-width cassette panel alongside the grid.
 * Body scrolls internally on desktop; on mobile becomes full-width.
 */
export const designerWing = style({
  flex: "0 0 280px",
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

/** Scrollable body inside a wing. */
export const designerWingBody = style({
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  "@media": {
    "(max-width: 48em)": {
      overflowY: "visible",
    },
  },
});

/** Centre column: screen chassis + bezel strip + action bar. */
export const designerCentre = style({
  flex: "1 1 auto",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  "@media": {
    "(max-width: 48em)": {
      order: -1,
    },
  },
});

/**
 * The grid canvas: a CSS grid laying out one button per cell. The column
 * template is set inline per render (it depends on the grid width).
 */
export const gridBoard = style({
  display: "grid",
  gap: 2,
  width: "100%",
});

/**
 * One paintable cell. Square, with a subtle border so empty cells are still
 * visible targets. Position relative so edge indicators and overlays can
 * anchor to the cell.
 */
export const gridCell = style({
  position: "relative",
  aspectRatio: "1 / 1",
  border: `1px solid rgba(28,38,32,0.4)`,
  borderRadius: 3,
  padding: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 10,
  fontWeight: 700,
  cursor: "pointer",
  color: vars.color.base,
  lineHeight: 1,
  userSelect: "none",
  touchAction: "none",
  selectors: {
    "&:focus-visible": {
      outline: `2px solid ${vars.color.cyan}`,
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
 * render as a thinner bar with a different colour.
 */
const EDGE_THICKNESS_PX = 4;
const DOOR_THICKNESS_PX = 3;

export const edgeBarBase = style({
  position: "absolute",
  pointerEvents: "auto",
  cursor: "pointer",
});

/** Wall edge: a thick desaturated steel bar sealing the side. */
export const edgeWall = [
  edgeBarBase,
  style({
    background: "#3a3f3c",
  }),
];

/** Door edge (closed): a warm amber bar — sealed but operable. */
export const edgeDoorClosed = [
  edgeBarBase,
  style({
    background: vars.color.amber,
  }),
];

/** Door edge (open): a thin amber outline — passable, leaks air. */
export const edgeDoorOpen = [
  edgeBarBase,
  style({
    background: "transparent",
    boxShadow: `inset 0 0 0 1px ${vars.color.amber}`,
  }),
];

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

/** Airtightness overlay: a magenta ring around cells in a breached compartment. */
export const breachOverlay = style({
  boxShadow: `inset 0 0 0 2px ${vars.color.magenta}`,
});

/**
 * Pan/zoom viewport. Scrollable container; transform: scale() applies zoom.
 * Recessed screen well: dark inset bevel shadows sink the grid surface.
 */
export const zoomViewport = style({
  overflow: "auto",
  maxHeight: "min(560px, 60vh)",
  minHeight: 200,
  resize: "vertical",
  borderRadius: 0,
  background: `linear-gradient(180deg, ${vars.material.surfaceBottom} 0%, ${vars.color.base} 100%)`,
  boxShadow: [
    `inset 2px 2px 8px ${vars.material.bevelShadowDeep}`,
    `inset -1px -1px 4px rgba(0,0,0,0.5)`,
    `0 0 0 1px ${vars.color.border}`,
  ].join(", "),
});

/** Inner wrapper that the scale transform applies to. Width set inline. */
export const zoomInner = style({
  transformOrigin: "top left",
});

/** Positioned wrapper around the viewport so the CRT screen overlay pins over it. */
export const zoomScreen = style({
  position: "relative",
});

/** Row of dimension + action controls in the bezel area. */
export const controlRow = style({
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
});

/** Action bar below the grid chassis: share/copy/history/save keys. */
export const actionBar = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  flexWrap: "wrap",
});

/** Left group in the action bar. */
export const actionBarLeft = style({
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
});

/** Right group in the action bar. */
export const actionBarRight = style({
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
});
