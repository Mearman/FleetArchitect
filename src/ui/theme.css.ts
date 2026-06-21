import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "@/ui/theme/vars.css";

/** Outer wrapper so the void gradient fills the viewport. */
export const appShell = style({ minHeight: "100dvh" });

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
});

globalStyle("canvas", { display: "block" });
