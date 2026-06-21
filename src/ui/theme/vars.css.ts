import { createGlobalTheme } from "@vanilla-extract/css";
import {
  BASE_VOID,
  BASE_PANEL,
  CHROME_BORDER,
  TEXT_PRIMARY,
  PHOSPHOR_AMBER,
  PHOSPHOR_GREEN,
  NEON_CYAN,
  NEON_MAGENTA,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_BODY,
  RADIUS_XS,
  BEVEL_HIGHLIGHT,
  BEVEL_HIGHLIGHT_STRONG,
  BEVEL_SHADOW,
  BEVEL_SHADOW_DEEP,
  ELEVATION_SHADOW,
  SURFACE_TOP,
  SURFACE_BOTTOM,
  BEZEL_TOP,
  BEZEL_BOTTOM,
  SCREW_HEAD,
  SCREW_HIGHLIGHT,
  SCREW_SLOT,
} from "./tokens";

/**
 * CSS custom properties emitted on :root. Import this file (as vars.css, no .ts
 * extension) from other .css.ts files to reference the typed var() strings.
 */
export const vars = createGlobalTheme(":root", {
  color: {
    base: BASE_VOID,
    panel: BASE_PANEL,
    border: CHROME_BORDER,
    text: TEXT_PRIMARY,
    amber: PHOSPHOR_AMBER,
    green: PHOSPHOR_GREEN,
    cyan: NEON_CYAN,
    magenta: NEON_MAGENTA,
  },
  font: {
    display: FONT_DISPLAY,
    mono: FONT_MONO,
    body: FONT_BODY,
  },
  radius: { xs: RADIUS_XS },
  material: {
    bevelHighlight:       BEVEL_HIGHLIGHT,
    bevelHighlightStrong: BEVEL_HIGHLIGHT_STRONG,
    bevelShadow:          BEVEL_SHADOW,
    bevelShadowDeep:      BEVEL_SHADOW_DEEP,
    elevation:            ELEVATION_SHADOW,
    surfaceTop:           SURFACE_TOP,
    surfaceBottom:        SURFACE_BOTTOM,
    bezelTop:             BEZEL_TOP,
    bezelBottom:          BEZEL_BOTTOM,
    screwHead:            SCREW_HEAD,
    screwHighlight:       SCREW_HIGHLIGHT,
    screwSlot:            SCREW_SLOT,
  },
});
