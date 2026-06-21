/**
 * Breakpoint values matching Mantine's defaults (em units).
 * Centralised so useViewport and the Mantine theme consume the same numbers.
 */
export const bp: {
  readonly xs: string;
  readonly sm: string;
  readonly md: string;
  readonly lg: string;
  readonly xl: string;
} = {
  xs: "36em",
  sm: "48em",
  md: "62em",
  lg: "75em",
  xl: "88em",
};

/** Pixel equivalents (for non-Mantine media query strings). */
export const bpPx: {
  readonly xs: number;
  readonly sm: number;
  readonly md: number;
  readonly lg: number;
  readonly xl: number;
} = {
  xs: 576,
  sm: 768,
  md: 992,
  lg: 1200,
  xl: 1408,
};
