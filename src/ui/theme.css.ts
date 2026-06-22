import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "@/ui/theme/vars.css";
import { MOBILE_MEDIA_QUERY } from "@/ui/layoutConstants";

/**
 * Outer shell wrapper. On desktop it is locked to the viewport
 * (`height: 100dvh; overflow: hidden`) so the page never scrolls — the bounded
 * `AppShell.Main` (see layout.css.ts `mainRegion`) and the route inside it size
 * to the viewport and scroll their own inner panels instead. Under the mobile
 * breakpoint it reverts to growing with content so the page scrolls and the
 * consoles reflow to a column.
 */
export const appShell = style({
  height: "100dvh",
  overflow: "hidden",
  "@media": {
    [MOBILE_MEDIA_QUERY]: {
      height: "auto",
      minHeight: "100dvh",
      overflow: "visible",
    },
  },
});

/** Base style for all nav links — mono uppercase, no underline. */
export const navLinkBase = style({
  fontSize: "0.8rem",
  fontWeight: 500,
  fontFamily: vars.font.mono,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "inherit",
  textDecoration: "none",
  transition: "color 0.15s ease",
  ":hover": { color: vars.color.amber, textDecoration: "none" },
});

/** Applied on top of navLinkBase when the route is active. */
export const navLinkActive = style({
  fontWeight: 700,
  color: vars.color.amber,
});

globalStyle(":root", { colorScheme: "dark" });
globalStyle("html, body, #root", { height: "100%" });

globalStyle("body", {
  margin: 0,
  backgroundColor: vars.color.base,
  backgroundImage: [
    "radial-gradient(1200px circle at 50% -10%,",
    "#0d2018 0%,",
    vars.color.panel + " 45%,",
    vars.color.base + " 75%)",
  ].join(" "),
  backgroundAttachment: "fixed",
  color: vars.color.text,
  fontFamily: vars.font.body,
  // Desktop: the shell owns the viewport and clips, so the page itself must not
  // scroll. Mobile reverts to a scrolling page.
  overflow: "hidden",
  "@media": {
    [MOBILE_MEDIA_QUERY]: {
      overflow: "auto",
    },
  },
});

globalStyle("canvas", { display: "block" });
