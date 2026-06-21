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
  BEVEL_HIGHLIGHT,
  BEVEL_HIGHLIGHT_STRONG,
  BEVEL_SHADOW,
  BEVEL_SHADOW_DEEP,
  ELEVATION_SHADOW,
  BEZEL_TOP,
  BEZEL_BOTTOM,
} from "./tokens";
import { hardwareKey, hardwareKeySmall } from "@/ui/theme/controls.css";

// Skeuomorphic surface recipes — built as plain strings (no `as` assertions).
// One ordered box-shadow list per element: insets first, then the 0 0 0 1px
// hairline border, then a tight outer drop shadow (existing neon blooms, where
// present, stay outermost on the owning element).

/** Raised-key face gradient layered OVER the variant background colour. */
const KEY_FACE_GRADIENT = `linear-gradient(180deg, ${BEVEL_HIGHLIGHT_STRONG} 0%, transparent 45%, ${BEVEL_SHADOW} 100%)`;

/** Recessed field — data cut into the panel (opposite of a raised key). */
const INSET_FIELD_GRADIENT = `linear-gradient(180deg, ${BEVEL_SHADOW} 0%, transparent 40%)`;
const insetFieldShadow = [
  `inset 0 1px 3px ${BEVEL_SHADOW_DEEP}`,
  `inset 0 -1px 0 ${BEVEL_HIGHLIGHT}`,
].join(", ");
const insetFieldFocusShadow = [
  `inset 0 1px 3px ${BEVEL_SHADOW_DEEP}`,
  `0 0 6px -1px rgba(255,176,0,0.5)`,
].join(", ");

/** Recessed track for the segmented control. */
const recessedTrackShadow = [
  `inset 0 1px 3px ${BEVEL_SHADOW_DEEP}`,
  `inset 0 -1px 0 ${BEVEL_HIGHLIGHT}`,
].join(", ");

/** Raised active indicator riding inside the recessed segmented track. */
const segmentIndicatorShadow = [
  `inset 0 1px 0 ${BEVEL_HIGHLIGHT_STRONG}`,
  `0 1px 2px ${ELEVATION_SHADOW}`,
].join(", ");

/**
 * Shared recessed-field styling for text/number/select inputs. The field sits
 * below the panel plane: a darker void fill, a faint top-edge shade gradient and
 * inset shadows, lifting to an amber focus bloom.
 */
const recessedInput = {
  backgroundColor: BASE_VOID,
  backgroundImage: INSET_FIELD_GRADIENT,
  boxShadow: insetFieldShadow,
  borderColor: CHROME_BORDER,
  "&:focus": {
    borderColor: PHOSPHOR_AMBER,
    boxShadow: insetFieldFocusShadow,
  },
};

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
      // The pressable bevel + activation glow live in a class (hardwareKey), not
      // here: Mantine applies flat `styles` props inline, and an inline box-shadow
      // can't be overridden by the :hover/:active rules the glow needs.
      classNames: { root: hardwareKey },
      styles: {
        // The gradient layers OVER the variant backgroundColor (no backgroundColor
        // override) so the amber primary fill survives beneath the bevel.
        root: {
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontFamily: FONT_MONO,
          fontWeight: "600",
          backgroundImage: KEY_FACE_GRADIENT,
        },
      },
    },
    ActionIcon: {
      defaultProps: { radius: "xs" },
      // Same pressable key as Button, with shorter travel (hardwareKeySmall).
      classNames: { root: hardwareKeySmall },
      styles: {
        root: {
          backgroundImage: KEY_FACE_GRADIENT,
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
        input: recessedInput,
        label: {
          textTransform: "uppercase",
          fontFamily: FONT_MONO,
          fontSize: "0.7rem",
          letterSpacing: "0.08em",
          color: PHOSPHOR_AMBER,
        },
      },
    },
    NumberInput: {
      defaultProps: { radius: "xs" },
      styles: { input: recessedInput },
    },
    Select: {
      defaultProps: { radius: "xs" },
      styles: { input: recessedInput },
    },
    NativeSelect: {
      defaultProps: { radius: "xs" },
      styles: { input: recessedInput },
    },
    SegmentedControl: {
      defaultProps: { radius: "xs" },
      styles: {
        // Recess the track, raise the active indicator out of it.
        root: {
          backgroundColor: BASE_VOID,
          boxShadow: recessedTrackShadow,
        },
        indicator: {
          backgroundImage: `linear-gradient(180deg, ${BEZEL_TOP}, ${BEZEL_BOTTOM})`,
          boxShadow: segmentIndicatorShadow,
        },
      },
    },
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
