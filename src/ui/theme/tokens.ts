/**
 * Design tokens — Cassette-Futurism x Cyberpunk palette.
 * Single source of truth consumed by mantineTheme.ts (via colorsTuple),
 * vars.css.ts (via createGlobalTheme), and canvas/designer modules directly.
 */

// 10-shade arrays for Mantine. Index 0 = lightest, index 9 = darkest.
// primaryShade dark: 4 means index 4 is the hero shade in dark mode.
export const amberShades: string[] = [
  "#fff9e6",
  "#fff0b3",
  "#ffe680",
  "#ffd633",
  "#ffb000", // index 4 — phosphor amber, the primary action colour
  "#e69a00",
  "#bf7f00",
  "#8f6000",
  "#5e4000",
  "#2e1f00",
];

export const cyanShades: string[] = [
  "#e0fbff",
  "#b3f5ff",
  "#80edff",
  "#33e8ff",
  "#00e5ff", // index 4 — neon cyan (defender side)
  "#00c2d6",
  "#0099ad",
  "#006e7d",
  "#003d47",
  "#001c22",
];

export const magentaShades: string[] = [
  "#ffe0fb",
  "#ffb3f4",
  "#ff66e8",
  "#ff40dc",
  "#ff2bd6", // index 4 — neon magenta (weapon/alarm)
  "#d620b3",
  "#ad1890",
  "#7d1066",
  "#4f093f",
  "#240319",
];

export const phosphorGreenShades: string[] = [
  "#e6ffe9",
  "#b3ffc4",
  "#66ff8a",
  "#33ff66",
  "#1fe052", // index 4 — phosphor green (HP-healthy, engine)
  "#16c844",
  "#0f9e36",
  "#087429",
  "#054a1a",
  "#02200c",
];

/**
 * Neutral/dark shades. Index 0 is lightest (phosphor off-white text).
 * Overrides Mantine's built-in "dark" palette so every default surface inherits
 * the near-black base and phosphor text without per-component styling.
 */
export const neutralShades: string[] = [
  "#c9d4c4", // 0 — phosphor off-white text (TEXT_PRIMARY)
  "#aab4a6", // 1
  "#8b9488", // 2
  "#6c746a", // 3
  "#4d544c", // 4
  "#2f342e", // 5
  "#1c2620", // 6 — chrome borders (CHROME_BORDER)
  "#141a16", // 7
  "#0d1014", // 8 — panel fill (BASE_PANEL)
  "#0a0c08", // 9 — void background (BASE_VOID)
];

// Semantic token exports (raw hex, for canvas and vanilla-extract imports).
export const BASE_VOID = "#0a0c08";
export const BASE_PANEL = "#0d1014";
export const CHROME_BORDER = "#1c2620";
export const TEXT_PRIMARY = "#c9d4c4";
export const PHOSPHOR_AMBER = "#ffb000";
export const PHOSPHOR_GREEN = "#33ff66";
export const NEON_CYAN = "#00e5ff";
export const NEON_MAGENTA = "#ff2bd6";

// Font stacks — straight quotes only (copy-paste-safe).
export const FONT_DISPLAY = "'Chakra Petch', 'Orbitron', sans-serif";
export const FONT_MONO = "'IBM Plex Mono', ui-monospace, monospace";
export const FONT_BODY = "'Inter', system-ui, sans-serif";

// Radii — cassette aesthetic uses near-zero radii (sharp panels).
export const RADIUS_XS = "1px";
export const RADIUS_SM = "2px";
