import { style } from "@vanilla-extract/css";
import { vars } from "@/ui/theme/vars.css";

/**
 * A recessed ship-preview tile in the cassette vocabulary: a sunken slab (inset
 * bevel rims) with a faction-accent hairline border, holding a thumbnail above
 * its name, class badge, and stat strip. The selected state lifts the fill and
 * adds a faint accent bloom; a pressable variant gains a hover cue.
 */
export const shipCard = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "0.4rem",
  padding: "0.55rem 0.5rem 0.5rem",
  position: "relative",
  width: "100%",
  textAlign: "center",
  background: `linear-gradient(180deg, ${vars.material.surfaceBottom} 0%, ${vars.color.base} 100%)`,
  border: `1px solid ${vars.color.border}`,
  borderRadius: 0,
  color: vars.color.text,
  boxShadow: [
    `inset 1px 1px 0 ${vars.material.bevelShadow}`,
    `inset -1px -1px 0 ${vars.material.bevelHighlight}`,
  ].join(", "),
  transition: "box-shadow 120ms ease, transform 120ms ease",
  selectors: {
    "&:hover": {
      boxShadow: [
        `inset 1px 1px 0 ${vars.material.bevelShadow}`,
        `inset -1px -1px 0 ${vars.material.bevelHighlight}`,
        "0 0 16px -6px rgba(255,176,0,0.3)",
      ].join(", "),
    },
    "&[data-selected='true']": {
      background: `linear-gradient(180deg, ${vars.material.surfaceTop} 0%, ${vars.color.panel} 100%)`,
      boxShadow: [
        `inset 1px 1px 0 ${vars.material.bevelHighlight}`,
        `inset -1px -1px 0 ${vars.material.bevelShadow}`,
        "0 0 22px -6px rgba(255,176,0,0.45)",
      ].join(", "),
    },
  },
});

/** Top-right corner slot for a per-card action (e.g. a delete button). */
export const shipCardAction = style({
  position: "absolute",
  top: "0.25rem",
  right: "0.25rem",
  zIndex: 2,
});

/** Stacked text block beneath the thumbnail. */
export const shipCardMeta = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "0.2rem",
  width: "100%",
});

/** Ship name in the mono display face. */
export const shipCardName = style({
  fontFamily: vars.font.mono,
  fontSize: "0.78rem",
  fontWeight: 600,
  letterSpacing: "0.02em",
  color: vars.color.text,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: "100%",
});

/** Class chip: small, uppercase, amber. */
export const shipCardBadge = style({
  fontFamily: vars.font.mono,
  fontSize: "0.58rem",
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: vars.color.amber,
  border: `1px solid ${vars.color.border}`,
  borderRadius: 0,
  padding: "0.05rem 0.35rem",
});

/** Row of compact stat readouts. */
export const shipCardStats = style({
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "center",
  gap: "0.45rem",
  marginTop: "0.1rem",
});

/** A single mono stat readout. */
export const shipCardStat = style({
  fontFamily: vars.font.mono,
  fontSize: "0.6rem",
  letterSpacing: "0.04em",
  color: vars.color.green,
});
