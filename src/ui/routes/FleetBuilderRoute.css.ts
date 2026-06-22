import { style } from "@vanilla-extract/css";
import { vars } from "@/ui/theme/vars.css";

/**
 * Three-zone fleet-builder console layout.
 *
 * Desktop: [ saved-fleets wing | roster centre | ship-browser wing ]
 * Mobile:  vertical stack; CSS `order` puts the roster on top.
 */

/** Outer flex-row holding the two wings and the roster centre. */
export const workspace = style({
  display: "flex",
  flexDirection: "row",
  alignItems: "stretch",
  width: "100%",
  gap: 8,
  "@media": {
    "(max-width: 48em)": {
      flexDirection: "column",
    },
  },
});

/**
 * Fixed side wing — a cassette panel bolted alongside the roster. On desktop
 * it fills the column height (the row stretches it) and scrolls internally.
 * On mobile it becomes full-width.
 */
export const wing = style({
  flex: "0 0 280px",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  padding: 12,
  "@media": {
    "(max-width: 48em)": {
      flex: "1 1 auto",
      minHeight: "auto",
    },
  },
});

/** Scrollable inner body of a side wing. */
export const wingBody = style({
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  "@media": {
    "(max-width: 48em)": {
      overflowY: "visible",
    },
  },
});

/** Wider browser wing for the ship browser (more cards to show). */
export const browserWing = style({
  flex: "0 0 320px",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  padding: 12,
  "@media": {
    "(max-width: 48em)": {
      flex: "1 1 auto",
      minHeight: "auto",
    },
  },
});

/** Centre column: fleet name, roster, budget, actions. On mobile it rises to top. */
export const centre = style({
  flex: "1 1 auto",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  "@media": {
    "(max-width: 48em)": {
      order: -1,
    },
  },
});

/** Recessed section within the centre pane for inputs and the roster. */
export const centreBody = style({
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 12,
});

// ── Budget gauge ─────────────────────────────────────────────────────────────

/** Container for the budget readout. */
export const budgetRow = style({
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: "0.4rem",
});

/** Neon-fill budget gauge track. */
export const budgetTrack = style({
  flex: "1 1 auto",
  height: 6,
  background: vars.color.base,
  border: `1px solid ${vars.color.border}`,
  boxShadow: `inset 0 1px 2px ${vars.material.bevelShadowDeep}`,
  borderRadius: 0,
  overflow: "hidden",
  position: "relative",
});

/** Filled portion of the budget gauge. Width is set via inline style. */
export const budgetFill = style({
  position: "absolute",
  top: 0,
  left: 0,
  height: "100%",
  transition: "width 300ms ease, background 300ms ease",
});

/** Budget text: the "X / Y pts" readout. */
export const budgetText = style({
  fontFamily: vars.font.mono,
  fontSize: "0.65rem",
  fontWeight: 600,
  letterSpacing: "0.06em",
  color: vars.color.text,
  whiteSpace: "nowrap",
});

/** Over-budget warning label. */
export const budgetOverWarning = style({
  fontFamily: vars.font.mono,
  fontSize: "0.6rem",
  letterSpacing: "0.06em",
  color: vars.color.magenta,
  marginTop: "0.2rem",
});

// ── Fleet row card ────────────────────────────────────────────────────────────

/** One fleet-ship row: thumbnail + meta + doctrine controls. */
export const fleetRowCard = style({
  position: "relative",
  background: `linear-gradient(180deg, ${vars.material.surfaceTop} 0%, ${vars.color.panel} 100%)`,
  border: `1px solid ${vars.color.border}`,
  padding: "0.6rem 0.6rem 0.5rem",
  boxShadow: [
    `inset 1px 1px 0 ${vars.material.bevelHighlight}`,
    `inset -1px -1px 0 ${vars.material.bevelShadow}`,
  ].join(", "),
});

/** Horizontal header strip: thumbnail + name/class block + cost badge + delete. */
export const fleetRowHeader = style({
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  marginBottom: "0.5rem",
});

/** Name + class block, filling remaining space. */
export const fleetRowMeta = style({
  flex: "1 1 auto",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.15rem",
});

/** Ship name in a row card. */
export const fleetRowName = style({
  fontFamily: vars.font.mono,
  fontSize: "0.75rem",
  fontWeight: 600,
  letterSpacing: "0.02em",
  color: vars.color.text,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
});

/** Class badge on a row card — small, amber, uppercase. */
export const fleetRowClass = style({
  fontFamily: vars.font.mono,
  fontSize: "0.55rem",
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: vars.color.amber,
  border: `1px solid ${vars.color.border}`,
  padding: "0.05rem 0.3rem",
  alignSelf: "flex-start",
});

/** Cost chip (green, over-budget variant is magenta). */
export const fleetRowCost = style({
  fontFamily: vars.font.mono,
  fontSize: "0.6rem",
  fontWeight: 600,
  letterSpacing: "0.06em",
  color: vars.color.green,
  border: `1px solid ${vars.color.border}`,
  padding: "0.1rem 0.3rem",
  whiteSpace: "nowrap",
  selectors: {
    "&[data-over='true']": {
      color: vars.color.magenta,
      borderColor: vars.color.magenta,
    },
  },
});

/** Horizontal strip of doctrine annunciator buttons. */
export const doctrineRow = style({
  display: "flex",
  flexWrap: "wrap",
  gap: "0.3rem",
  marginBottom: "0.3rem",
});

/** Small section label above a doctrine control group. */
export const doctrineLabel = style({
  fontFamily: vars.font.mono,
  fontSize: "0.55rem",
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: `color-mix(in srgb, ${vars.color.amber} 55%, ${vars.color.text})`,
  marginBottom: "0.2rem",
});

/** Advanced controls collapse area. */
export const advancedBody = style({
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  paddingTop: "0.5rem",
  borderTop: `1px solid ${vars.color.border}`,
  marginTop: "0.4rem",
});

// ── Saved fleets list ─────────────────────────────────────────────────────────

/** One saved-fleet row: name button + faction chip + delete icon. */
export const fleetListRow = style({
  display: "flex",
  alignItems: "center",
  gap: "0.3rem",
  padding: "0.35rem 0.4rem",
  border: `1px solid ${vars.color.border}`,
  background: "transparent",
  cursor: "pointer",
  transition: "background 120ms ease",
  selectors: {
    "&:hover": {
      background: vars.material.surfaceTop,
    },
    "&[data-active='true']": {
      background: vars.material.surfaceTop,
      borderColor: vars.color.amber,
    },
  },
});

/** Fleet name text in the list. */
export const fleetListName = style({
  fontFamily: vars.font.mono,
  fontSize: "0.68rem",
  fontWeight: 600,
  letterSpacing: "0.04em",
  color: vars.color.text,
  flex: "1 1 auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  textAlign: "left",
});

/** Faction chip on a fleet list row. */
export const fleetListFaction = style({
  fontFamily: vars.font.mono,
  fontSize: "0.52rem",
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: `color-mix(in srgb, ${vars.color.amber} 55%, ${vars.color.text})`,
  border: `1px solid ${vars.color.border}`,
  padding: "0.05rem 0.25rem",
  whiteSpace: "nowrap",
  flexShrink: 0,
});

/** Action button strip at the bottom of the builder. */
export const actionBar = style({
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  paddingTop: 6,
  borderTop: `1px solid ${vars.color.border}`,
});
