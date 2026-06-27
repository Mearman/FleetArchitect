import { style } from "@vanilla-extract/css";
import { vars } from "@/ui/theme/vars.css";

/**
 * Doctrine editor styling — matches the console/chassis aesthetic of the fleet
 * builder. Reuses the panel surface gradient and bevel vocabulary so the editor
 * reads as part of the same console rather than a Mantine default card.
 */

/** Outer editor body: a vertical stack with tight gaps. */
export const doctrineEditor = style({
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
});

/** Section label above a control group — mono uppercase amber phosphor. */
export const sectionLabel = style({
  fontFamily: vars.font.mono,
  fontSize: "0.55rem",
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: `color-mix(in srgb, ${vars.color.amber} 55%, ${vars.color.text})`,
  marginBottom: "0.2rem",
});

/** Horizontal strip of posture-preset annunciator buttons (wraps). */
export const presetRow = style({
  display: "flex",
  flexWrap: "wrap",
  gap: "0.3rem",
});

/** A rule card: a beveled surface with a header line and a body. */
export const ruleCard = style({
  background: `linear-gradient(180deg, ${vars.material.surfaceTop} 0%, ${vars.color.panel} 100%)`,
  border: `1px solid ${vars.color.border}`,
  padding: "0.5rem 0.55rem",
  boxShadow: [
    `inset 1px 1px 0 ${vars.material.bevelHighlight}`,
    `inset -1px -1px 0 ${vars.material.bevelShadow}`,
  ].join(", "),
});

/** Header line of a rule: the condition → action summary plus its controls. */
export const ruleHeader = style({
  display: "flex",
  alignItems: "center",
  gap: "0.4rem",
});

/** The summary text of a rule (condition → action). */
export const ruleSummary = style({
  flex: "1 1 auto",
  minWidth: 0,
  fontFamily: vars.font.mono,
  fontSize: "0.62rem",
  lineHeight: 1.35,
  color: vars.color.text,
});

/** A row of small controls (move/remove) on a rule. */
export const ruleControls = style({
  display: "flex",
  alignItems: "center",
  gap: "0.2rem",
  flexShrink: 0,
});

/** The inline editor body of a rule (condition + action builders). */
export const ruleBody = style({
  display: "flex",
  flexDirection: "column",
  gap: "0.45rem",
  paddingTop: "0.45rem",
  marginTop: "0.4rem",
  borderTop: `1px solid ${vars.color.border}`,
});

/** A two-up grid for paired inputs (e.g. min/max range). */
export const pairGrid = style({
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "0.4rem",
});

/** A nested group (all/any) — indented with a left border in the formation colour. */
export const nestedGroup = style({
  marginLeft: "0.75rem",
  paddingLeft: "0.55rem",
  borderLeft: `2px solid ${vars.color.amber}`,
  display: "flex",
  flexDirection: "column",
  gap: "0.35rem",
});

/** A between-reference row: two pickers side by side with an alpha slider. */
export const betweenRow = style({
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "0.4rem",
});

/** Muted hint text under a control. */
export const hint = style({
  fontFamily: vars.font.mono,
  fontSize: "0.55rem",
  letterSpacing: "0.04em",
  color: `color-mix(in srgb, ${vars.color.text} 50%, transparent)`,
  marginTop: "0.15rem",
});
