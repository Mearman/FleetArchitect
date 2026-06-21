import { style } from "@vanilla-extract/css";
import { vars } from "@/ui/theme/vars.css";

/** Arm length of the cassette corner-bracket markers in px. */
const BRACKET_ARM = "10px";
/** Thickness of the corner-bracket strokes. */
const BRACKET_WEIGHT = "2px";

/**
 * Base cassette panel: dark fill, 1 px chrome border, amber corner brackets
 * on the top-left and bottom-right corners (::before / ::after).
 * Apply cornerBL and cornerTR to child divs for the other two corners.
 */
export const cassettePanel = style({
  position: "relative",
  // Vertical surface gradient so the panel reads as a lit, raised slab rather
  // than a flat fill — lighter at the top, settling to the panel base, then
  // darkening into the shaded bottom edge.
  background: `linear-gradient(180deg, ${vars.material.surfaceTop} 0%, ${vars.color.panel} 55%, ${vars.material.surfaceBottom} 100%)`,
  border: `1px solid ${vars.color.border}`,
  borderRadius: 0,
  // One ordered box-shadow list (insets first, hairline border, tight drop
  // shadow, then the existing amber bloom outermost) so the bevel rims and the
  // neon halo occupy different regions and never collide.
  boxShadow: [
    `inset 1px 1px 0 ${vars.material.bevelHighlight}`,
    `inset -1px -1px 0 ${vars.material.bevelShadow}`,
    `0 0 0 1px ${vars.color.border}`,
    `0 2px 6px -2px ${vars.material.elevation}`,
    "0 0 24px -8px rgba(255,176,0,0.2)",
  ].join(", "),
  "::before": {
    content: '""',
    position: "absolute",
    top: -1,
    left: -1,
    width: BRACKET_ARM,
    height: BRACKET_ARM,
    borderTop: `${BRACKET_WEIGHT} solid ${vars.color.amber}`,
    borderLeft: `${BRACKET_WEIGHT} solid ${vars.color.amber}`,
    pointerEvents: "none",
    zIndex: 1,
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
    pointerEvents: "none",
    zIndex: 1,
  },
});

/** Diameter of a corner screw-head in px. */
const SCREW_SIZE = "7px";
/** Inset of each screw-head from the panel edge in px. */
const SCREW_INSET = "6px";

/**
 * Opt-in corner fasteners: four screw-heads, one per corner. Owns its OWN
 * ::before (top-left + bottom-right) and ::after (top-right + bottom-left), so
 * it composes with cassettePanel — whose pseudos paint the amber brackets —
 * without colliding. Each screw is a small radial gradient with a top-left
 * glint, body, and recessed slot. Apply only to larger chrome frames.
 */
export const panelScrews = style({
  "::before": {
    content: '""',
    position: "absolute",
    inset: 0,
    backgroundImage: [
      `radial-gradient(circle at 35% 30%, ${vars.material.screwHighlight} 0%, ${vars.material.screwHead} 45%, ${vars.material.screwSlot} 100%)`,
      `radial-gradient(circle at 35% 30%, ${vars.material.screwHighlight} 0%, ${vars.material.screwHead} 45%, ${vars.material.screwSlot} 100%)`,
    ].join(", "),
    backgroundRepeat: "no-repeat",
    backgroundSize: `${SCREW_SIZE} ${SCREW_SIZE}`,
    backgroundPosition: [
      `${SCREW_INSET} ${SCREW_INSET}`,
      `right ${SCREW_INSET} bottom ${SCREW_INSET}`,
    ].join(", "),
    pointerEvents: "none",
    zIndex: 1,
  },
  "::after": {
    content: '""',
    position: "absolute",
    inset: 0,
    backgroundImage: [
      `radial-gradient(circle at 35% 30%, ${vars.material.screwHighlight} 0%, ${vars.material.screwHead} 45%, ${vars.material.screwSlot} 100%)`,
      `radial-gradient(circle at 35% 30%, ${vars.material.screwHighlight} 0%, ${vars.material.screwHead} 45%, ${vars.material.screwSlot} 100%)`,
    ].join(", "),
    backgroundRepeat: "no-repeat",
    backgroundSize: `${SCREW_SIZE} ${SCREW_SIZE}`,
    backgroundPosition: [
      `right ${SCREW_INSET} top ${SCREW_INSET}`,
      `left ${SCREW_INSET} bottom ${SCREW_INSET}`,
    ].join(", "),
    pointerEvents: "none",
    zIndex: 1,
  },
});

/**
 * Opt-in anisotropic brushed-metal grain, gated behind html[data-fx="full"].
 * Pure CSS gradients (no raster): a fine 90deg repeating-linear-gradient grain
 * crossed with a vertical light/shade wash, blended over the surface. Uses its
 * OWN ::after, so on a panel that ALSO needs panelScrews (which owns ::after
 * too), put brushedMetal on the OUTER element and panelScrews on an inner frame
 * element to avoid the pseudo-element clash.
 */
export const brushedMetal = style({
  selectors: {
    'html[data-fx="full"] &::after': {
      content: '""',
      position: "absolute",
      inset: 0,
      backgroundImage: [
        "repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, rgba(0,0,0,0.05) 1px, rgba(0,0,0,0.05) 2px)",
        "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 40%, transparent 60%, rgba(0,0,0,0.12) 100%)",
      ].join(", "),
      opacity: 0.5,
      mixBlendMode: "overlay",
      pointerEvents: "none",
      zIndex: 0,
    },
  },
});

/** Bottom-left corner bracket — place as an aria-hidden child of cassettePanel. */
export const cornerBL = style({
  position: "absolute",
  bottom: -1,
  left: -1,
  width: BRACKET_ARM,
  height: BRACKET_ARM,
  borderBottom: `${BRACKET_WEIGHT} solid ${vars.color.amber}`,
  borderLeft: `${BRACKET_WEIGHT} solid ${vars.color.amber}`,
  pointerEvents: "none",
  zIndex: 1,
});

/** Top-right corner bracket — place as an aria-hidden child of cassettePanel. */
export const cornerTR = style({
  position: "absolute",
  top: -1,
  right: -1,
  width: BRACKET_ARM,
  height: BRACKET_ARM,
  borderTop: `${BRACKET_WEIGHT} solid ${vars.color.amber}`,
  borderRight: `${BRACKET_WEIGHT} solid ${vars.color.amber}`,
  pointerEvents: "none",
  zIndex: 1,
});

/**
 * Mono uppercase header-label strip inside a cassette panel.
 * Renders the panel title in amber phosphor above a hairline separator.
 */
export const panelLabel = style({
  fontFamily: vars.font.mono,
  fontSize: "0.63rem",
  fontWeight: 600,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: vars.color.amber,
  paddingBottom: "0.3rem",
  marginBottom: "0.5rem",
  borderBottom: `1px solid ${vars.color.border}`,
  userSelect: "none",
});

/**
 * Ensures coarse-pointer (touch) devices get ≥ 44 px touch targets on icon buttons.
 * Apply alongside ActionIcon className on camera controls.
 */
export const touchTarget = style({
  "@media": {
    "(pointer: coarse)": {
      minWidth: "44px",
      minHeight: "44px",
    },
  },
});

/**
 * Neon canvas frame for the battle viewport — cyan bloom with amber corner ticks.
 * Apply as a className alongside the existing canvasBox class.
 */
export const neonCanvasFrame = style({
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
