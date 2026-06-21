import { style } from "@vanilla-extract/css";
import { vars } from "@/ui/theme/vars.css";

/**
 * Three-zone battle workspace layout.
 *
 * Desktop: [ setup dock | canvas centre | controls dock ]
 * Mobile:  vertical stack; docks rendered as bottom-sheet Drawers via the Route.
 */

/** Outer flex-row that holds the two docks and the canvas centre. */
export const workspace = style({
  display: "flex",
  flexDirection: "row",
  alignItems: "stretch",
  width: "100%",
  gap: 0,
  "@media": {
    "(max-width: 48em)": {
      flexDirection: "column",
    },
  },
});

/** Expanded side dock — shared by both setup (left) and controls (right). */
export const dock = style({
  flex: "0 0 284px",
  display: "flex",
  flexDirection: "column",
  backgroundColor: vars.color.panel,
  border: `1px solid ${vars.color.border}`,
  overflowY: "auto",
  // Hidden on mobile — drawers take over.
  "@media": {
    "(max-width: 48em)": {
      display: "none",
    },
  },
});

/** Collapsed dock rail: a slim strip showing a vertical label + expand affordance. */
export const dockRail = style({
  flex: "0 0 32px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "10px 0 8px",
  gap: 6,
  backgroundColor: vars.color.panel,
  border: `1px solid ${vars.color.border}`,
  cursor: "pointer",
  userSelect: "none",
  "@media": {
    "(max-width: 48em)": {
      display: "none",
    },
  },
  ":hover": {
    borderColor: vars.color.amber,
  },
});

/** Vertical text label rendered in the collapsed rail. */
export const railLabel = style({
  writingMode: "vertical-rl",
  transform: "rotate(180deg)",
  fontFamily: vars.font.mono,
  fontSize: "0.55rem",
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: vars.color.amber,
});

/** Header strip inside an expanded dock: title + collapse chevron. */
export const dockHeader = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 10px",
  flexShrink: 0,
  borderBottom: `1px solid ${vars.color.border}`,
});

/** Mono uppercase dock title. */
export const dockTitle = style({
  fontFamily: vars.font.mono,
  fontSize: "0.63rem",
  fontWeight: 600,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: vars.color.amber,
  userSelect: "none",
});

/** Scrollable content area inside an expanded dock. */
export const dockBody = style({
  flex: "1 1 auto",
  overflowY: "auto",
  padding: "12px 10px",
});

/** Centre column: canvas + playback bar, takes all remaining width. */
export const centre = style({
  flex: "1 1 auto",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 8,
});

/**
 * Mobile-only bar rendered between canvas and playback controls when a battle
 * is running. Shows SETUP and CONTROLS drawer triggers. Hidden on desktop.
 */
export const mobileDockBar = style({
  display: "none",
  "@media": {
    "(max-width: 48em)": {
      display: "flex",
      gap: 8,
      paddingTop: 4,
    },
  },
});
