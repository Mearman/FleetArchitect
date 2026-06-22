import { style } from "@vanilla-extract/css";
import { vars } from "@/ui/theme/vars.css";

/**
 * Shared screen chassis styles — reused by any route that wraps a display
 * (battle arena, ship designer grid viewport, etc.).
 */

/**
 * The screen chassis — a raised metal frame the display sits recessed inside,
 * with the camera buttons and indicator lamps mounted on its bezel strip rather
 * than floating on the glass. Compose `panelScrews` for corner fasteners.
 * Mirrors the cassette-panel surface so the screen and its flanking control
 * wings read as one continuous console.
 */
export const screenChassis = style({
  position: "relative",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 12,
  background: `linear-gradient(180deg, ${vars.material.surfaceTop} 0%, ${vars.color.panel} 55%, ${vars.material.surfaceBottom} 100%)`,
  border: `1px solid ${vars.color.border}`,
  borderRadius: 0,
  boxShadow: [
    `inset 1px 1px 0 ${vars.material.bevelHighlight}`,
    `inset -1px -1px 0 ${vars.material.bevelShadow}`,
    `0 0 0 1px ${vars.color.border}`,
    `0 3px 10px -3px ${vars.material.elevation}`,
  ].join(", "),
});

/**
 * Recessed control tray set into the chassis face below the screen. Indicator
 * lamps cluster on the left, camera buttons on the right.
 */
export const bezelStrip = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  flexWrap: "wrap",
  padding: "6px 8px",
  background: vars.color.base,
  borderRadius: 1,
  boxShadow: [
    `inset 0 1px 3px ${vars.material.bevelShadowDeep}`,
    `inset 0 -1px 0 ${vars.material.bevelHighlight}`,
    `0 0 0 1px ${vars.color.border}`,
  ].join(", "),
});

/** A cluster of lamps or buttons within the bezel strip. */
export const bezelGroup = style({
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
});
