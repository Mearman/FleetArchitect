import { style } from "@vanilla-extract/css";
import { vars } from "@/ui/theme/vars.css";
import { PHOSPHOR_GREEN } from "@/ui/theme/tokens";

/**
 * Ship designer console layout. Mirrors the BattleWorkspace fixed-wing pattern:
 * a flex-row of two CassettePanel wings flanking a centre column holding the grid.
 * Reflows to a column on mobile with the grid up top.
 */

/**
 * Route root: full-height flex column so the route fills the bounded AppShell.Main
 * region on desktop. `minHeight: 0` is required so flex children can shrink below
 * their content height and the viewport does not overflow.
 */
export const designerRouteRoot = style({
  height: "100%",
  flex: "1 1 auto",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  "@media": {
    "(max-width: 48em)": {
      height: "auto",
      flex: "none",
    },
  },
});

/**
 * Slim one-line title strip replacing the large h1 heading. Mono amber label
 * with a hairline separator — matches the panelLabel vocabulary so it reads as
 * part of the console chrome rather than generic page text.
 */
export const designerTitleStrip = style({
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontFamily: vars.font.mono,
  fontSize: "0.63rem",
  fontWeight: 600,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: vars.color.amber,
  paddingBottom: "0.3rem",
  borderBottom: `1px solid ${vars.color.border}`,
  userSelect: "none",
  flexShrink: 0,
});

/** Outer flex-row holding the left wing, centre grid, and right wing. */
export const designerConsole = style({
  display: "flex",
  flexDirection: "row",
  alignItems: "stretch",
  width: "100%",
  flex: "1 1 auto",
  minHeight: 0,
  gap: 8,
  "@media": {
    "(max-width: 48em)": {
      flexDirection: "column",
      flex: "none",
      minHeight: "auto",
    },
  },
});

/**
 * Side wing — fixed-width cassette panel alongside the grid.
 * Body scrolls internally on desktop; on mobile becomes full-width.
 */
export const designerWing = style({
  flex: "0 0 280px",
  height: "100%",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  padding: 12,
  "@media": {
    "(max-width: 48em)": {
      flex: "1 1 auto",
      height: "auto",
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

/** Centre column: slim title strip + name/faction row + grid chassis + action bar. */
export const designerCentre = style({
  flex: "1 1 auto",
  minWidth: 0,
  height: "100%",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  "@media": {
    "(max-width: 48em)": {
      order: -1,
      height: "auto",
    },
  },
});

/** Colour of the grid cell boundary lines. Drawn on the grid overlay that tilts
 *  with the board, so the lines stay aligned with the cells in both flat 2D and
 *  isometric 2.5D (the overlay carries the same transform as the board). */
export const GRID_LINE = "rgba(28,38,32,0.55)";

/**
 * Grid-line overlay. Sits inside the board wrapper, fills the board area, and
 * carries the same iso transform as the board (applied inline) so the cell
 * boundary lines tilt with the cells in 2.5D. Not hull-clipped (the clipPath
 * lives on the board itself), so the grid still shows where empty cells can be
 * painted. `backgroundSize` is set inline to track the zoomed cell pitch.
 */
export const gridOverlay = style({
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  backgroundImage: `linear-gradient(to right, ${GRID_LINE} 0 1px, transparent 1px), linear-gradient(to bottom, ${GRID_LINE} 0 1px, transparent 1px)`,
  backgroundRepeat: "repeat, repeat",
});

/**
 * The grid canvas: a CSS grid whose tracks position the (sparse) built cells.
 * Empty cells are not rendered as nodes (painting is hit-tested by coordinate);
 * the cell boundary lines are drawn by the viewport behind it. This keeps a large
 * grid cheap: node count tracks the built cells, not cols*rows. Transparent so
 * the viewport's grid lines show through.
 */
export const gridBoard = style({
  position: "relative",
  display: "grid",
  gap: 0,
  width: "100%",
  cursor: "pointer",
  userSelect: "none",
  touchAction: "none",
});

/**
 * One built (non-empty) cell, placed on its grid track via `gridColumn`/`gridRow`
 * (set inline). Position relative so edge indicators and overlays anchor to it.
 */
export const gridCell = style({
  position: "relative",
  minWidth: 0,
  minHeight: 0,
  border: `1px solid rgba(28,38,32,0.4)`,
  padding: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 10,
  fontWeight: 700,
  color: vars.color.base,
  lineHeight: 1,
  userSelect: "none",
});

/** Selection highlight, placed on the selected cell's grid track. Non-interactive
 *  so it never intercepts a paint. */
export const gridSelection = style({
  pointerEvents: "none",
  outline: `2px solid ${PHOSPHOR_GREEN}`,
  outlineOffset: -2,
  zIndex: 2,
});

/** Placement-preview ghost tiles for a multi-cell module's footprint — one per
 *  offset, placed on its grid track. `gridGhostFit` (green) when the module fits
 *  at the hovered anchor; `gridGhostMiss` (red) when the footprint is blocked.
 *  Non-interactive so the ghost never intercepts the placement click. */
export const gridGhostFit = style({
  pointerEvents: "none",
  outline: `2px solid ${PHOSPHOR_GREEN}`,
  outlineOffset: -2,
  background: "rgba(120, 240, 160, 0.22)",
  zIndex: 3,
});

export const gridGhostMiss = style({
  pointerEvents: "none",
  outline: `2px solid #ff5a5a`,
  outlineOffset: -2,
  background: "rgba(255, 90, 90, 0.22)",
  zIndex: 3,
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
 * Screen chassis wrapper that fills the available centre height on desktop.
 * `flex: 1 1 auto` with `minHeight: 0` lets it grow to fill between the
 * name/faction row and the action bar, without overflowing the viewport.
 * On mobile a min-height keeps the grid usable when panels stack.
 */
export const designerGridChassis = style({
  flex: "1 1 auto",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  "@media": {
    "(max-width: 48em)": {
      flex: "none",
      minHeight: 320,
    },
  },
});

/**
 * Pan/zoom viewport. Fills the screen chassis on desktop (`flex: 1 1 auto`,
 * `minHeight: 0`) so the grid grows with the window. The fixed `maxHeight` and
 * `resize: vertical` are removed — size is now governed by flex layout.
 * Recessed screen well: dark inset bevel shadows sink the grid surface.
 */
export const zoomViewport = style({
  flex: "1 1 auto",
  minHeight: 0,
  // Containing block for the absolutely-positioned board, so `overflow: hidden`
  // clips it and — crucially — the board never contributes to this element's
  // height. Otherwise the rows (derived from the measured viewport height) would
  // feed back into the board height and grow the page without bound on mobile,
  // where the column is not height-constrained.
  position: "relative",
  // The board is sized to overhang the viewport and positioned by a transform to
  // keep the content centred, so the overhang is simply clipped — no scrolling.
  overflow: "hidden",
  borderRadius: 0,
  // Recessed screen gradient only. The per-cell grid lines live on the grid
  // overlay inside the board wrapper (see `gridOverlay`), so they tilt with the
  // cells in 2.5D; this element stays a flat backdrop filling the viewport.
  backgroundImage: `linear-gradient(180deg, ${vars.material.surfaceBottom} 0%, ${vars.color.base} 100%)`,
  backgroundRepeat: "no-repeat",
  boxShadow: [
    `inset 2px 2px 8px ${vars.material.bevelShadowDeep}`,
    `inset -1px -1px 4px rgba(0,0,0,0.5)`,
    `0 0 0 1px ${vars.color.border}`,
  ].join(", "),
  "@media": {
    "(max-width: 48em)": {
      minHeight: 280,
    },
  },
});

/** Inner wrapper the centring transform applies to (width set inline). Absolutely
 *  positioned so the board is out of flow and never expands the viewport — see
 *  the note on `zoomViewport`. */
export const zoomInner = style({
  position: "absolute",
  top: 0,
  left: 0,
  transformOrigin: "top left",
});

/**
 * Positioned wrapper around the viewport so the CRT screen overlay pins over it.
 * Also a flex column filling the chassis so the viewport can grow to fill it.
 */
export const zoomScreen = style({
  position: "relative",
  flex: "1 1 auto",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
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
