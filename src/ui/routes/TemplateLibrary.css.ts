import { style } from "@vanilla-extract/css";
import { vars } from "@/ui/theme/vars.css";

/**
 * Template-library wing styling — a compact list of stored formation templates
 * with insert/edit/delete actions. Reuses the saved-fleet-list row vocabulary so
 * the wing reads as a sibling catalogue.
 */

/** One template row: name + faction chip + actions. */
export const templateRow = style({
  display: "flex",
  alignItems: "center",
  gap: "0.3rem",
  padding: "0.35rem 0.4rem",
  border: `1px solid ${vars.color.border}`,
  background: "transparent",
  transition: "background 120ms ease",
  selectors: {
    "&:hover": {
      background: vars.material.surfaceTop,
    },
  },
});

/** Template name text. */
export const templateName = style({
  fontFamily: vars.font.mono,
  fontSize: "0.66rem",
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

/** Faction chip on a template row. */
export const templateFaction = style({
  fontFamily: vars.font.mono,
  fontSize: "0.5rem",
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: `color-mix(in srgb, ${vars.color.amber} 55%, ${vars.color.text})`,
  border: `1px solid ${vars.color.border}`,
  padding: "0.05rem 0.25rem",
  whiteSpace: "nowrap",
  flexShrink: 0,
});

/** Child-count chip (how many leaves the template's formation has). */
export const templateCount = style({
  fontFamily: vars.font.mono,
  fontSize: "0.5rem",
  fontWeight: 600,
  letterSpacing: "0.08em",
  color: `color-mix(in srgb, ${vars.color.text} 60%, transparent)`,
  border: `1px solid ${vars.color.border}`,
  padding: "0.05rem 0.25rem",
  whiteSpace: "nowrap",
});

/** Action button strip inside a row. */
export const templateActions = style({
  display: "flex",
  alignItems: "center",
  gap: "0.15rem",
  flexShrink: 0,
});

/** Empty-state copy. */
export const templateEmpty = style({
  fontFamily: vars.font.mono,
  fontSize: "0.58rem",
  letterSpacing: "0.04em",
  color: `color-mix(in srgb, ${vars.color.text} 50%, transparent)`,
  padding: "0.4rem",
});

/** A header strip above the list with a "new template" hint. */
export const templateHeader = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.4rem",
  marginBottom: "0.3rem",
});
