import { globalStyle, keyframes, style } from "@vanilla-extract/css";
import { vars } from "@/ui/theme/vars.css";

const flicker = keyframes({
  "0%,100%": { opacity: 1 },
  "4%":      { opacity: 0.94 },
  "5%":      { opacity: 1 },
  "56%":     { opacity: 0.96 },
  "57%":     { opacity: 1 },
  "91%":     { opacity: 0.92 },
  "92%":     { opacity: 1 },
});

const boot = keyframes({
  "0%":   { transform: "scaleY(0.03)", filter: "brightness(4)" },
  "15%":  { transform: "scaleY(1)",    filter: "brightness(2.2)" },
  "50%":  { filter: "brightness(1.4)" },
  "100%": { filter: "brightness(1)" },
});

/**
 * Scanline overlay — visible at reduced and full levels. Positioned absolutely
 * so it fills a single display surface (the battle canvas or designer viewport),
 * not the whole app: the CRT scanlines belong on the screens, not smeared across
 * the metal chrome. Drop it inside a position:relative display container.
 */
export const overlay = style({
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  zIndex: 2,
  backgroundImage: [
    "repeating-linear-gradient(",
    "  to bottom,",
    "  transparent 0,",
    "  transparent 2px,",
    "  rgba(0,0,0,0.18) 2px,",
    "  rgba(0,0,0,0.18) 3px",
    ")",
  ].join(""),
  selectors: {
    'html[data-fx="full"] &': {
      animationName: flicker,
      animationDuration: "8s",
      animationIterationCount: "infinite",
      animationTimingFunction: "linear",
    },
  },
});

/**
 * Curvature vignette layer — darkens the screen edges. Sized for a single
 * display (the radial spread is proportional, the inset shadow modest) so it
 * reads as screen curvature rather than blacking out a small viewport.
 */
export const vignette = style({
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  zIndex: 2,
  background: "radial-gradient(ellipse at center, transparent 58%, rgba(0,0,0,0.5) 100%)",
  boxShadow: "inset 0 0 50px rgba(0,0,0,0.38)",
});

/**
 * Display power-on — the screen snaps from a thin bright line to full height
 * with a brightness flare, like a CRT switching on. Apply to a display
 * container (the battle canvas box, the designer viewport wrapper); the CSS
 * animation runs whenever the display mounts, so it fires on page load for a
 * display already on screen and when the battle canvas first appears after
 * engaging. Full level only.
 */
export const screenPowerOn = style({
  selectors: {
    'html[data-fx="full"] &': {
      animationName: boot,
      animationDuration: "0.6s",
      animationTimingFunction: "ease-out",
      animationFillMode: "both",
    },
  },
});

/** RGB chromatic-aberration shift — full level only. */
globalStyle(`html[data-fx="full"] .${overlay}::before`, {
  content: '""',
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  zIndex: 2,
  backgroundImage: [
    "repeating-linear-gradient(",
    "  to bottom,",
    "  transparent 0,",
    "  transparent 2px,",
    "  rgba(0,229,255,0.04) 2px,",
    "  rgba(0,229,255,0.04) 3px",
    ")",
  ].join(""),
  transform: "translateX(-0.6px)",
  mixBlendMode: "screen",
});

globalStyle(`html[data-fx="full"] .${overlay}::after`, {
  content: '""',
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  zIndex: 2,
  backgroundImage: [
    "repeating-linear-gradient(",
    "  to bottom,",
    "  transparent 0,",
    "  transparent 2px,",
    "  rgba(255,43,214,0.04) 2px,",
    "  rgba(255,43,214,0.04) 3px",
    ")",
  ].join(""),
  transform: "translateX(0.6px)",
  mixBlendMode: "screen",
});

/** Neon glow text classes — import and apply where needed. */
export const neonTextAmber = style({
  color: vars.color.amber,
  textShadow: `0 0 6px ${vars.color.amber}, 0 0 18px rgba(255,176,0,0.45)`,
});

export const neonTextCyan = style({
  color: vars.color.cyan,
  textShadow: `0 0 6px ${vars.color.cyan}, 0 0 18px rgba(0,229,255,0.45)`,
});

export const neonBoxAmber = style({
  boxShadow: `0 0 0 1px ${vars.color.border}, 0 0 20px -4px rgba(255,176,0,0.4)`,
});

export const neonBoxCyan = style({
  boxShadow: `0 0 0 1px ${vars.color.border}, 0 0 20px -4px rgba(0,229,255,0.4)`,
});
