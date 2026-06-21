import { colorsTuple, createTheme } from "@mantine/core";
import {
  amberShades,
  cyanShades,
  magentaShades,
  phosphorGreenShades,
  neutralShades,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_BODY,
  BASE_VOID,
  BASE_PANEL,
  CHROME_BORDER,
  PHOSPHOR_AMBER,
  TEXT_PRIMARY,
} from "./tokens";

/** Cassette-Futurism x Cyberpunk Mantine theme. */
export const mantineTheme = createTheme({
  primaryColor: "amber",
  primaryShade: { light: 4, dark: 4 },
  defaultRadius: "xs",
  white: TEXT_PRIMARY,
  black: BASE_VOID,
  fontFamily: FONT_BODY,
  fontFamilyMonospace: FONT_MONO,
  headings: { fontFamily: FONT_DISPLAY, fontWeight: "700" },
  colors: {
    amber: colorsTuple(amberShades),
    cyan: colorsTuple(cyanShades),
    magenta: colorsTuple(magentaShades),
    green: colorsTuple(phosphorGreenShades),
    // Override built-in dark palette so all default surfaces inherit the
    // near-black base and phosphor text without per-component overrides.
    dark: colorsTuple(neutralShades),
  },
  components: {
    Paper: {
      defaultProps: { withBorder: true, radius: "xs" },
      styles: {
        root: { backgroundColor: BASE_PANEL, borderColor: CHROME_BORDER },
      },
    },
    Card: {
      defaultProps: { withBorder: true, radius: "xs" },
      styles: {
        root: { backgroundColor: BASE_PANEL, borderColor: CHROME_BORDER },
      },
    },
    Button: {
      defaultProps: { radius: "xs" },
      styles: {
        root: {
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontFamily: FONT_MONO,
          fontWeight: "600",
        },
      },
    },
    Badge: {
      defaultProps: { radius: "xs" },
      styles: {
        label: {
          fontFamily: FONT_MONO,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        },
      },
    },
    TextInput: {
      defaultProps: { radius: "xs" },
      styles: {
        label: {
          textTransform: "uppercase",
          fontFamily: FONT_MONO,
          fontSize: "0.7rem",
          letterSpacing: "0.08em",
          color: PHOSPHOR_AMBER,
        },
      },
    },
    NumberInput: { defaultProps: { radius: "xs" } },
    Select: { defaultProps: { radius: "xs" } },
    NativeSelect: { defaultProps: { radius: "xs" } },
    SegmentedControl: { defaultProps: { radius: "xs" } },
    Slider: { defaultProps: { radius: "xs" } },
    Drawer: {
      styles: {
        content: { backgroundColor: BASE_PANEL, borderColor: CHROME_BORDER },
        header: { backgroundColor: BASE_PANEL },
      },
    },
    Modal: {
      styles: {
        content: { backgroundColor: BASE_PANEL, borderColor: CHROME_BORDER },
        header: { backgroundColor: BASE_PANEL },
      },
    },
  },
});
