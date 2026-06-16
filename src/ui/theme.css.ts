import { globalStyle, style } from "@vanilla-extract/css";

/** Outer wrapper so the space gradient fills the viewport. */
export const appShell = style({
  minHeight: "100dvh",
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
