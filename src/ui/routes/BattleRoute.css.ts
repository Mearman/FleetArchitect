import { style } from "@vanilla-extract/css";
import { vars } from "@/ui/theme/vars.css";

/**
 * Battle canvas styles. The workspace layout (fixed console wings flanking the
 * screen) lives in BattleWorkspace.css.ts; the shared screen chassis, bezel
 * strip, and bezel group live in @/ui/components/screen.css.ts; these styles
 * cover the recessed canvas well and the canvas element itself.
 */

/**
 * Route root: fills the bounded region delivered by AppShell.Main. On desktop
 * this is a fixed-height flex column (height driven by the shell); on mobile
 * it reverts to auto height so the page can scroll.
 */
export const routeRoot = style({
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  "@media": {
    "(max-width: 48em)": {
      height: "auto",
      minHeight: "auto",
    },
  },
});

/**
 * Slim title strip — one line of amber mono text with the winner badge inline.
 * Sits above the workspace and takes only its natural (small) height, leaving
 * the rest to the BattleWorkspace.
 */
export const titleStrip = style({
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexShrink: 0,
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
 * The flex-fill wrapper inside the centre column: the screenChassis sits here
 * and grows to fill all remaining height, with the playback bar pinned below.
 */
export const centreColumn = style({
  display: "flex",
  flexDirection: "column",
  flex: "1 1 auto",
  minHeight: 0,
});

/**
 * The screenChassis override for the centre: fills the centreColumn so the
 * canvas grows with the viewport. The playback bar follows as a natural footer.
 */
export const screenChassisFill = style({
  flex: "1 1 auto",
  minHeight: 0,
});

/**
 * Canvas container: fills the available height driven by the flex parent
 * (screenChassisFill). The canvas inside stretches to fill it; the
 * world-to-display transform letterboxes to preserve aspect ratio.
 *
 * Under (max-width: 48em) the mobile stacked layout uses a fixed-ish height so
 * a usable canvas is visible even without the viewport-lock.
 *
 * Includes the neon-cyan frame treatment: cyan border, bloom shadow, and amber
 * corner ticks via ::before / ::after.
 */
const BRACKET_ARM = "10px";
const BRACKET_WEIGHT = "2px";

export const canvasBox = style({
  position: "relative",
  width: "100%",
  flex: "1 1 auto",
  minHeight: 0,
  overflow: "hidden",
  "@media": {
    "(max-width: 48em)": {
      flex: "none",
      height: "min(60vh, 600px)",
      minHeight: 280,
    },
  },
  borderRadius: 0,
  border: `1px solid ${vars.color.cyan}`,
  boxShadow: [
    // top-left interior sink — screen recessed into the bezel
    `inset 2px 2px 8px ${vars.material.bevelShadowDeep}`,
    // bottom-right interior counter-shadow
    `inset -1px -1px 4px rgba(0,0,0,0.5)`,
    // existing chrome hairline border
    `0 0 0 1px ${vars.color.border}`,
    // existing inner cyan tint
    `inset 0 0 14px -4px rgba(0,229,255,0.12)`,
    // existing outer cyan bloom — outermost so it escapes beyond the drop shadow
    `0 0 14px -2px rgba(0,229,255,0.55)`,
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

// Camera controls and legends no longer float on the glass — they are mounted
// on the chassis bezel strip (see screenChassis / bezelStrip above), styled as
// annunciator buttons and lamps.

/**
 * Glass-glare overlay: a diagonal highlight that makes the canvas read as a
 * real CRT screen under a glass panel. Off by default; lit up only when
 * data-fx="full" (the full-effects tier). Uses mix-blend-mode: screen so it
 * brightens without washing out the battle colours underneath.
 *
 * The element must sit inside the canvas box (canvasBox / neonCanvasFrame) as
 * an aria-hidden child, since both ::before and ::after on canvasBox are
 * already claimed by the amber corner ticks.
 */
export const glassGlare = style({
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  zIndex: 3,
  opacity: 0,
  selectors: {
    'html[data-fx="full"] &': {
      opacity: 1,
      background: "linear-gradient(125deg, rgba(255,255,255,0.06) 0%, transparent 22%, transparent 78%, rgba(255,255,255,0.03) 100%)",
      mixBlendMode: "screen",
    },
  },
});
