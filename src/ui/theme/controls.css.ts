import { style } from "@vanilla-extract/css";
import { vars } from "@/ui/theme/vars.css";

/**
 * Backlit hardware-key box-shadow as a real CSS class, not Mantine `styles`.
 * Mantine applies flat `styles` props inline, and an inline box-shadow cannot be
 * overridden by a :hover/:active rule — so the activation glow (and the press
 * sink) only work when the whole box-shadow lives in a class like this, applied
 * via the component's `classNames`.
 *
 * A control rests as a raised bevelled key. It lights with an amber glow when it
 * becomes active — hover or keyboard focus — and brightest under the finger on
 * press, where it also sinks flush to the panel plane. Disabled keys are flat
 * and dark.
 */
const raisedKey = (side: string): string =>
  [
    `inset 0 1px 0 ${vars.material.bevelHighlightStrong}`,
    `inset 0 -1px 0 ${vars.material.bevelShadow}`,
    `0 ${side} 0 ${vars.material.bezelBottom}`,
    `0 3px 5px -1px ${vars.material.elevation}`,
  ].join(", ");

const pressed = [
  `inset 0 1px 2px ${vars.material.bevelShadowDeep}`,
  `inset 0 -1px 0 ${vars.material.bevelHighlight}`,
  `0 0 0 1px ${vars.color.border}`,
].join(", ");

/** Amber bloom layered onto the bevel when the key becomes active. */
const GLOW = "0 0 12px -2px rgba(255,176,0,0.55)";
const GLOW_STRONG = "0 0 16px -1px rgba(255,176,0,0.85)";

function hardwareKeyStyle(side: string, travel: string): string {
  return style({
    boxShadow: raisedKey(side),
    transition: "transform 60ms ease, box-shadow 120ms ease",
    selectors: {
      "&:hover": { boxShadow: `${raisedKey(side)}, ${GLOW}` },
      "&:focus-visible": { boxShadow: `${raisedKey(side)}, ${GLOW}` },
      "&:active": {
        transform: `translateY(${travel})`,
        boxShadow: `${pressed}, ${GLOW_STRONG}`,
      },
      "&:disabled": { boxShadow: "none", transform: "none" },
    },
    "@media": {
      "(prefers-reduced-motion: reduce)": { transition: "none" },
    },
  });
}

/** Full-size pressable key — for Button. */
export const hardwareKey = hardwareKeyStyle("2px", "2px");
/** Smaller key with shorter travel — for ActionIcon. */
export const hardwareKeySmall = hardwareKeyStyle("1px", "1px");
