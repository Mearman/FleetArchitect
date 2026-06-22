import { style } from "@vanilla-extract/css";
import { vars } from "@/ui/theme/vars.css";

/** The grouped browser column: stacked faction sections. */
export const shipBrowser = style({
  display: "flex",
  flexDirection: "column",
  gap: "0.9rem",
});

/** One faction's section. */
export const shipBrowserFaction = style({
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
});

/**
 * Faction header in the panel-label idiom (mono, uppercase, ruled underline).
 * The accent colour is supplied per faction inline.
 */
export const shipBrowserFactionHeader = style({
  margin: 0,
  fontFamily: vars.font.mono,
  fontSize: "0.72rem",
  fontWeight: 700,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  paddingBottom: "0.25rem",
  borderBottom: `1px solid ${vars.color.border}`,
});

/** One class bucket within a faction. */
export const shipBrowserClass = style({
  display: "flex",
  flexDirection: "column",
  gap: "0.35rem",
});

/** Small mono class sub-header. */
export const shipBrowserClassHeader = style({
  margin: 0,
  fontFamily: vars.font.mono,
  fontSize: "0.58rem",
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: vars.color.amber,
  opacity: 0.85,
});

/** Empty-state notice in the recessed mono idiom. */
export const shipBrowserEmpty = style({
  fontFamily: vars.font.mono,
  fontSize: "0.7rem",
  letterSpacing: "0.06em",
  color: vars.color.text,
  opacity: 0.55,
  padding: "0.75rem",
  textAlign: "center",
});
