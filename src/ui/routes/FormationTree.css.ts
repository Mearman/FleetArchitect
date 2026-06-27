import { style } from "@vanilla-extract/css";
import { vars } from "@/ui/theme/vars.css";

/**
 * Formation-tree styling — the recursive roster of a fleet's formation tree.
 * Children indent under their parent formation with a coloured rail so the
 * tree's depth reads at a glance. Reuses the fleet-row-card surface vocabulary
 * (see {@link FleetBuilderRoute.css}) so leaves match the existing roster.
 */

/** A tree node wrapper: indents nested children under a left rail. */
export const treeNode = style({
  display: "flex",
  flexDirection: "column",
  gap: "0.4rem",
});

/** Indented children region — a coloured left rail marks the parent edge. */
export const treeChildren = style({
  marginLeft: "0.85rem",
  paddingLeft: "0.7rem",
  borderLeft: `2px solid ${vars.color.border}`,
  display: "flex",
  flexDirection: "column",
  gap: "0.4rem",
});

/** A formation node card header: role + layout + facing + controls. */
export const formationHeader = style({
  display: "flex",
  alignItems: "center",
  gap: "0.45rem",
  flexWrap: "wrap",
});

/** The formation's role/name label. */
export const formationRole = style({
  fontFamily: vars.font.mono,
  fontSize: "0.72rem",
  fontWeight: 700,
  letterSpacing: "0.04em",
  color: vars.color.amber,
  textTransform: "uppercase",
});

/** A small chip showing a formation or template attribute. */
export const formationChip = style({
  fontFamily: vars.font.mono,
  fontSize: "0.55rem",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: `color-mix(in srgb, ${vars.color.text} 70%, transparent)`,
  border: `1px solid ${vars.color.border}`,
  padding: "0.05rem 0.3rem",
  whiteSpace: "nowrap",
});

/** A template-reference card (a `template` node). */
export const templateRefCard = style({
  background: `linear-gradient(180deg, ${vars.material.surfaceTop} 0%, ${vars.color.panel} 100%)`,
  border: `1px dashed ${vars.color.amber}`,
  padding: "0.45rem 0.55rem",
  display: "flex",
  alignItems: "center",
  gap: "0.45rem",
});

/** The template-ref's name (or "missing" badge when the template is absent). */
export const templateRefName = style({
  fontFamily: vars.font.mono,
  fontSize: "0.68rem",
  fontWeight: 600,
  color: vars.color.text,
  flex: "1 1 auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

/** Missing-template warning badge (magenta). */
export const missingBadge = style({
  fontFamily: vars.font.mono,
  fontSize: "0.52rem",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: vars.color.magenta,
  border: `1px solid ${vars.color.magenta}`,
  padding: "0.05rem 0.3rem",
  whiteSpace: "nowrap",
});

/** A row of small action buttons under a formation node (add ship/formation/etc). */
export const formationActions = style({
  display: "flex",
  flexWrap: "wrap",
  gap: "0.3rem",
  alignItems: "center",
});

/** The doctrine editor collapse region inside a formation node. */
export const doctrineRegion = style({
  marginTop: "0.35rem",
  paddingTop: "0.45rem",
  borderTop: `1px solid ${vars.color.border}`,
});

// ── Ship-leaf card ───────────────────────────────────────────────────────────

/** A ship-leaf card: the same beveled surface as the flat fleet row, with a
 *  header, compact doctrine quick-rows, a one-line summary, and an expandable
 *  full doctrine editor. */
export const leafCard = style({
  background: `linear-gradient(180deg, ${vars.material.surfaceTop} 0%, ${vars.color.panel} 100%)`,
  border: `1px solid ${vars.color.border}`,
  borderLeft: `3px solid ${vars.color.amber}`,
  padding: "0.5rem 0.55rem",
  boxShadow: [
    `inset 1px 1px 0 ${vars.material.bevelHighlight}`,
    `inset -1px -1px 0 ${vars.material.bevelShadow}`,
  ].join(", "),
  display: "flex",
  flexDirection: "column",
  gap: "0.35rem",
});

/** Header line of a leaf: thumbnail + name/class/cost + controls. */
export const leafHeader = style({
  display: "flex",
  alignItems: "center",
  gap: "0.45rem",
});

/** Name + class + summary block, filling remaining space. */
export const leafMeta = style({
  flex: "1 1 auto",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.1rem",
});

/** Ship name in a leaf card. */
export const leafName = style({
  fontFamily: vars.font.mono,
  fontSize: "0.72rem",
  fontWeight: 600,
  letterSpacing: "0.02em",
  color: vars.color.text,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
});

/** One-line doctrine summary under the name — mono, muted. */
export const leafSummary = style({
  fontFamily: vars.font.mono,
  fontSize: "0.56rem",
  letterSpacing: "0.02em",
  color: `color-mix(in srgb, ${vars.color.text} 60%, transparent)`,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
});

/** Compact horizontal strip of quick-doctrine annunciator buttons. */
export const quickRow = style({
  display: "flex",
  flexWrap: "wrap",
  gap: "0.25rem",
  alignItems: "center",
});

/** Small mono label above a quick-row. */
export const quickLabel = style({
  fontFamily: vars.font.mono,
  fontSize: "0.5rem",
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: `color-mix(in srgb, ${vars.color.amber} 50%, ${vars.color.text})`,
  marginRight: "0.2rem",
});

/** Per-node controls (up/down/remove) — top-right of any card. */
export const nodeControls = style({
  display: "flex",
  alignItems: "center",
  gap: "0.15rem",
  flexShrink: 0,
});

/** Class badge on a leaf — small amber uppercase chip. */
export const leafClass = style({
  fontFamily: vars.font.mono,
  fontSize: "0.52rem",
  fontWeight: 600,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: vars.color.amber,
  border: `1px solid ${vars.color.border}`,
  padding: "0.03rem 0.25rem",
  alignSelf: "flex-start",
});

/** Cost chip on a leaf (green; magenta when over budget). */
export const leafCost = style({
  fontFamily: vars.font.mono,
  fontSize: "0.56rem",
  fontWeight: 600,
  color: vars.color.green,
  border: `1px solid ${vars.color.border}`,
  padding: "0.05rem 0.25rem",
  whiteSpace: "nowrap",
  selectors: {
    "&[data-over='true']": {
      color: vars.color.magenta,
      borderColor: vars.color.magenta,
    },
  },
});
