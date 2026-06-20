import { globalStyle, style } from "@vanilla-extract/css";

/** Outer wrapper so the space gradient fills the viewport. */
export const appShell = style({
  minHeight: "100dvh",
});

/** Base style for all nav links — plain text, no underline. */
export const navLinkBase = style({
  fontSize: "0.875rem",
  fontWeight: 500,
  color: "inherit",
  textDecoration: "none",
  transition: "color 0.15s ease",
  ":hover": {
    color: "var(--mantine-color-indigo-3)",
    textDecoration: "none",
  },
});

/** Applied on top of navLinkBase when the route is active. */
export const navLinkActive = style({
  fontWeight: 700,
  color: "var(--mantine-color-indigo-3)",
});

globalStyle(":root", {
  colorScheme: "dark",
});

globalStyle("html, body, #root", {
  height: "100%",
});

globalStyle("body", {
  margin: 0,
  backgroundColor: "#05060a",
  backgroundImage:
    "radial-gradient(1200px circle at 50% -10%, #121a3a 0%, #0a0d1c 45%, #05060a 75%)",
  backgroundAttachment: "fixed",
  color: "#d8dcea",
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
});

globalStyle("canvas", {
  display: "block",
});
