import { createVar, style } from "@vanilla-extract/css";
import { vars } from "@/ui/theme/vars.css";

/** Raised-key box-shadow: lit top edge, shaded bottom edge, an extruded side of
 *  `side`px, and a drop shadow that shrinks as the key sinks towards the panel. */
const raised = (side: number, dropY: number, dropBlur: number): string =>
  [
    `inset 0 1px 0 ${vars.material.bevelHighlightStrong}`,
    `inset 0 -1px 0 ${vars.material.bevelShadow}`,
    `0 ${side}px 0 ${vars.material.bezelBottom}`,
    `0 ${dropY}px ${dropBlur}px -1px ${vars.material.elevation}`,
  ].join(", ");

/** Flush, fully-pressed key sunk to the panel plane. */
const pressed = [
  `inset 0 1px 2px ${vars.material.bevelShadowDeep}`,
  `inset 0 -1px 0 ${vars.material.bevelHighlight}`,
  `0 0 0 1px ${vars.color.border}`,
].join(", ");

/** Amber glow — the keycap lights from within when fully pressed or latched on.
 *  Two inset layers (tight + soft) so the illumination sits inside the key's own
 *  face rather than bleeding outwards onto the panel. Listed before the pressed
 *  bevel so the light reads on top of the sunk surface. */
const GLOW = [
  "inset 0 0 6px rgba(255,176,0,0.7)",
  "inset 0 0 14px rgba(255,176,0,0.4)",
].join(", ");
const litShadow = `${GLOW}, ${pressed}`;

interface KeySpec {
  rest: string;
  hover: string;
  hoverTravel: string;
  fullTravel: string;
}

/**
 * Pressable hardware key as a CSS class — Mantine applies flat `styles` props
 * inline, which would block these :hover/:active rules. The key rests raised and
 * dark; hovering sinks it slightly without lighting it (it is not yet engaged);
 * an actual press sinks it flush and lights it with an amber glow. That lit,
 * fully-pressed look also latches via [data-active="true"] / [aria-pressed="true"],
 * so one key serves both momentary buttons (lit only while held) and toggle
 * buttons (lit while on). A latched rule sits after :hover so a hovered toggle-on
 * key stays fully lit rather than dropping to the half-pressed hover state.
 */
function hardwareKeyStyle(spec: KeySpec): string {
  const lit = {
    transform: `translateY(${spec.fullTravel})`,
    boxShadow: litShadow,
  };
  return style({
    boxShadow: spec.rest,
    transition: "transform 80ms ease, box-shadow 120ms ease",
    selectors: {
      "&:hover": {
        transform: `translateY(${spec.hoverTravel})`,
        boxShadow: spec.hover,
      },
      "&:active": lit,
      '&[data-active="true"]': lit,
      '&[aria-pressed="true"]': lit,
      "&:disabled": { transform: "none", boxShadow: "none" },
    },
    "@media": {
      "(prefers-reduced-motion: reduce)": { transition: "none" },
    },
  });
}

/** Full-size key — for Button. */
export const hardwareKey = hardwareKeyStyle({
  rest: raised(2, 3, 5),
  hover: raised(1, 2, 4),
  hoverTravel: "1px",
  fullTravel: "2px",
});

/** Smaller key with shorter travel — for ActionIcon. */
export const hardwareKeySmall = hardwareKeyStyle({
  rest: raised(1, 2, 4),
  hover: raised(0.5, 1, 3),
  hoverTravel: "0.5px",
  fullTravel: "1px",
});

// ── Annunciator legend lamps ──────────────────────────────────────────────
//
// A backlit panel pushbutton (the illuminated legend switch you see on a
// cockpit or control-room console). Distinct from the bevelled hardwareKey: the
// whole translucent cap floods with light when engaged rather than just glowing
// at its rim. Built for Mantine UnstyledButton / a plain element so it does NOT
// inherit the global hardwareKey treatment Mantine applies to Button/ActionIcon.

/** Per-lamp illumination colour. Tint-variant classes reassign it; the lit-state
 *  rules below read it, so one base class lights in whatever colour the variant
 *  sets. Defaults to amber. */
const tint = createVar();

/** Lit cap: the lens floods with the tint colour, the legend flips to a dark
 *  silhouette, the segmented grid reads as dark divisions, and an outer bloom
 *  appears. Shared by the momentary (:active) and latched
 *  ([data-active]/[aria-pressed]) states. */
const litCap = {
  transform: "translateY(1px)",
  background: `linear-gradient(180deg, color-mix(in srgb, ${tint} 85%, white) 0%, ${tint} 100%)`,
  color: vars.color.base,
  textShadow: "none",
  boxShadow: [
    `inset 0 0 0 1px color-mix(in srgb, ${tint} 60%, transparent)`,
    "inset 0 1px 4px rgba(0,0,0,0.35)",
    `0 0 12px -2px color-mix(in srgb, ${tint} 75%, transparent)`,
  ].join(", "),
};

/**
 * Annunciator base: an unlit dark plastic lens with a faint engraved legend and
 * a fine segmented-lens grid (::before). Lights via :active (momentary) and
 * [data-active="true"] / [aria-pressed="true"] (latched), so one class drives
 * momentary buttons, toggle buttons, and (via data-active on a non-interactive
 * element) status lamps.
 */
export const annunciator = style({
  vars: { [tint]: vars.color.amber },
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.4em",
  minWidth: 0,
  padding: "0.34rem 0.6rem",
  fontFamily: vars.font.mono,
  fontSize: "0.6rem",
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  lineHeight: 1,
  border: `1px solid ${vars.color.border}`,
  borderRadius: 1,
  cursor: "pointer",
  userSelect: "none",
  background: `linear-gradient(180deg, ${vars.material.bezelTop} 0%, ${vars.material.bezelBottom} 100%)`,
  color: `color-mix(in srgb, ${tint} 45%, ${vars.color.text})`,
  textShadow: "0 1px 0 rgba(0,0,0,0.6)",
  boxShadow: [
    `inset 0 1px 0 ${vars.material.bevelHighlight}`,
    `inset 0 -1px 0 ${vars.material.bevelShadow}`,
    `0 1px 2px -1px ${vars.material.elevation}`,
  ].join(", "),
  transition:
    "transform 80ms ease, color 120ms ease, box-shadow 120ms ease, background 120ms ease",
  "::before": {
    content: '""',
    position: "absolute",
    inset: 1,
    backgroundImage: [
      "repeating-linear-gradient(90deg, transparent 0, transparent 3px, rgba(0,0,0,0.3) 3px, rgba(0,0,0,0.3) 4px)",
      "repeating-linear-gradient(0deg, transparent 0, transparent 3px, rgba(0,0,0,0.3) 3px, rgba(0,0,0,0.3) 4px)",
    ].join(", "),
    opacity: 0.3,
    pointerEvents: "none",
  },
  selectors: {
    "&:active": litCap,
    '&[data-active="true"]': litCap,
    '&[aria-pressed="true"]': litCap,
    "&:disabled": { cursor: "not-allowed", opacity: 0.4 },
  },
  "@media": {
    "(prefers-reduced-motion: reduce)": { transition: "none" },
  },
});

/** Tint variants — assign the illumination colour. Defined after the base so the
 *  custom-property assignment wins the cascade. */
export const annunciatorAmber = style({ vars: { [tint]: vars.color.amber } });
export const annunciatorGreen = style({ vars: { [tint]: vars.color.green } });
export const annunciatorCyan = style({ vars: { [tint]: vars.color.cyan } });
export const annunciatorMagenta = style({ vars: { [tint]: vars.color.magenta } });

/** Non-interactive status-lamp modifier: same lens, no press affordance. Drive
 *  its lit state with data-active on the element. */
export const annunciatorLamp = style({ cursor: "default", pointerEvents: "none" });
