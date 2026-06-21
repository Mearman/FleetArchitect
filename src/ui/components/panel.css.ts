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
  backgroundColor: vars.color.panel,
  border: `1px solid ${vars.color.border}`,
  borderRadius: 0,
  boxShadow: `0 0 0 1px ${vars.color.border}, 0 0 24px -8px rgba(255,176,0,0.2)`,
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
