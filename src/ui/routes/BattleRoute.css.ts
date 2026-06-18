import { style } from "@vanilla-extract/css";

/**
 * Battle arena layout. The canvas is the dominant element: it fills the
 * available width and a tall slice of the viewport. The setup panel collapses
 * to a compact bar during playback and the module status panel becomes a
 * toggleable overlay rather than always-on chrome, so playback uses the whole
 * width instead of sharing it with controls.
 */

/** Outer wrapper for the playback stage so the overlay can position against it. */
export const stage = style({
  position: "relative",
  width: "100%",
});

/**
 * Canvas container: a tall viewport-relative box. Height is clamped so it never
 * dwarfs short screens but takes most of a tall one. The canvas inside stretches
 * to fill it; the world-to-display transform letterboxes to preserve aspect, so
 * the container no longer needs to lock to the 960x600 ratio.
 */
export const canvasBox = style({
  position: "relative",
  width: "100%",
  height: "min(72vh, 900px)",
  minHeight: 360,
  overflow: "hidden",
  borderRadius: 6,
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

/** A floating cluster of camera controls pinned to the top-right of the canvas. */
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

/** Module status overlay pinned to the right edge, toggled on demand. */
export const statusOverlay = style({
  position: "absolute",
  top: 52,
  right: 8,
  bottom: 8,
  width: "min(320px, 42%)",
  overflowY: "auto",
  zIndex: 2,
});
