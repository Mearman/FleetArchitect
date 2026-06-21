import { style } from "@vanilla-extract/css";
import { vars } from "@/ui/theme/vars.css";

/**
 * Battle arena canvas and stage styles. The workspace layout (three-zone flex
 * with collapsible docks) lives in BattleWorkspace.css.ts; these styles are
 * for the canvas element itself and its on-canvas overlays (legends, camera
 * controls cluster).
 */

/** Outer wrapper for the canvas stage. */
export const stage = style({
  position: "relative",
  width: "100%",
});

/**
 * Canvas container: a tall viewport-relative box. Height is clamped so it never
 * dwarfs short screens but takes most of a tall one. The canvas inside stretches
 * to fill it; the world-to-display transform letterboxes to preserve aspect, so
 * the container no longer needs to lock to the 960x600 ratio.
 *
 * Includes the neon-cyan frame treatment: cyan border, bloom shadow, and amber
 * corner ticks via ::before / ::after.
 */
const BRACKET_ARM = "10px";
const BRACKET_WEIGHT = "2px";

export const canvasBox = style({
  position: "relative",
  width: "100%",
  height: "min(72vh, 900px)",
  minHeight: 360,
  overflow: "hidden",
  "@media": {
    "(max-width: 48em)": {
      height: "min(60vh, 600px)",
      minHeight: 280,
    },
  },
  borderRadius: 0,
  border: `1px solid ${vars.color.cyan}`,
  boxShadow: `
    0 0 0 1px ${vars.color.border},
    0 0 14px -2px rgba(0,229,255,0.55),
    inset 0 0 14px -4px rgba(0,229,255,0.12)
  `,
  "::before": {
    content: '""',
    position: "absolute",
    top: -1,
    left: -1,
    width: BRACKET_ARM,
    height: BRACKET_ARM,
    borderTop: `${BRACKET_WEIGHT} solid ${vars.color.amber}`,
    borderLeft: `${BRACKET_WEIGHT} solid ${vars.color.amber}`,
    zIndex: 2,
    pointerEvents: "none",
  },
  "::after": {
    content: '""',
    position: "absolute",
    bottom: -1,
    right: -1,
    width: BRACKET_ARM,
    height: BRACKET_ARM,
    borderBottom: `${BRACKET_WEIGHT} solid ${vars.color.amber}`,
    borderRight: `${BRACKET_WEIGHT} solid ${vars.color.amber}`,
    zIndex: 2,
    pointerEvents: "none",
  },
});

/** The canvas itself fills its container; the backing store is DPR-scaled. */
export const canvas = style({
  display: "block",
  width: "100%",
  height: "100%",
  touchAction: "none",
  cursor: "grab",
});

export const canvasGrabbing = style({
  cursor: "grabbing",
});

/** Zoom in / zoom out / fit — the three camera action buttons on the canvas. */
export const cameraControls = style({
  position: "absolute",
  top: 8,
  right: 8,
  display: "flex",
  gap: 6,
  alignItems: "center",
  zIndex: 3,
});

/** The active-anomaly legend pinned to the top-left of the canvas. */
export const anomalyLegend = style({
  position: "absolute",
  top: 8,
  left: 8,
  zIndex: 3,
  pointerEvents: "none",
});

/** The fog-of-war legend badge, shown below the anomaly legend when fog is active. */
export const fogLegend = style({
  position: "absolute",
  top: 34,
  left: 8,
  zIndex: 3,
  pointerEvents: "none",
});

// statusOverlay removed — module status now lives in the controls dock
// (BattleWorkspace right dock / mobile Drawer via BattleControlsPanel).
