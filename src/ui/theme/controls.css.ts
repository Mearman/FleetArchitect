import { style } from "@vanilla-extract/css";
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
