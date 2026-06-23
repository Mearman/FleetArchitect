/**
 * SI engineering-prefix formatting for the huge energy (joule) and power (watt)
 * figures the SI re-grounding produces (GJ structure, GW reactors, MJ shields).
 *
 * The formatter picks the tightest engineering prefix — the one whose
 * coefficient sits in [1, 1000) — and renders up to 3 significant figures,
 * trimming trailing zeros so a reader sees "3.42 GJ" or "6 GJ" rather than
 * "3420000000". Purely presentational: no domain or engine value is changed here.
 *
 * Supported dimensions: energy (joules) and power (watts). The base unit
 * symbol is supplied by the caller; the prefix is prepended to it.
 */

/** Engineering prefix steps, ascending from the unit prefix (10^0). Each step
 *  is a factor of 1000. The formatter walks up until the coefficient would be
 *  less than 1 at the next step, then stops. */
const PREFIX_STEPS: readonly { factor: number; symbol: string }[] = [
  { factor: 1, symbol: "" },
  { factor: 1_000, symbol: "k" },
  { factor: 1_000_000, symbol: "M" },
  { factor: 1_000_000_000, symbol: "G" },
  { factor: 1_000_000_000_000, symbol: "T" },
];

/**
 * Format a raw SI quantity (joules or watts) with an engineering prefix.
 *
 * `unitSymbol` is the base unit letter ("J" for joules, "W" for watts); the
 * prefix is prepended to it (e.g. "GJ", "MW"). Zero and sub-unit magnitudes
 * render in the base unit with no prefix. Negative values are handled (the
 * sign is preserved through the coefficient).
 *
 * Significant figures: up to 3. Coefficients ≥ 100 round to the nearest
 * integer ("123 MW"); coefficients with two integer digits carry one decimal
 * place ("42 kJ"); single-digit integer coefficients carry two ("3.42 GJ").
 * Trailing zeros are trimmed so "6.00 GJ" renders as "6 GJ".
 */
export function formatSi(value: number, unitSymbol: string): string {
  if (value === 0) return `0 ${unitSymbol}`;
  const negative = value < 0;
  const magnitude = Math.abs(value);

  // Walk up the prefix ladder until the coefficient at the next step would
  // fall below 1, or we run out of prefixes.
  let stepIndex = 0;
  for (let i = 0; i < PREFIX_STEPS.length; i++) {
    const step = PREFIX_STEPS[i];
    if (step === undefined) break;
    const next = PREFIX_STEPS[i + 1];
    // Stop if there is no higher prefix, or if moving up would push the
    // coefficient below 1.
    if (next === undefined || magnitude / next.factor < 1) {
      stepIndex = i;
      break;
    }
  }
  const step = PREFIX_STEPS[stepIndex];
  // stepIndex is always set inside the loop (i starts at 0), so step is defined.
  if (step === undefined) return `${value} ${unitSymbol}`;

  const coefficient = magnitude / step.factor;
  // 3 significant figures, trimming trailing zeros so "6.00 GJ" renders as
  // "6 GJ" and "3.40 GW" as "3.4 GW". Coefficients ≥ 100 have all three sig
  // figs in the integer part; smaller coefficients carry decimals as needed.
  const formatted = formatCoefficient(coefficient);
  const sign = negative ? "-" : "";
  return `${sign}${formatted} ${step.symbol}${unitSymbol}`;
}

/** Render a coefficient to 3 significant figures, stripping trailing zeros
 *  and any trailing decimal point so the result is compact (6, not 6.00). */
function formatCoefficient(coefficient: number): string {
  // Three integer digits or more: round to the nearest integer.
  if (coefficient >= 100) return Math.round(coefficient).toString();
  // Two integer digits: one decimal place gives three sig figs.
  if (coefficient >= 10) return trimZeros(coefficient.toFixed(1));
  // One integer digit: two decimal places give three sig figs.
  return trimZeros(coefficient.toFixed(2));
}

/** Drop trailing zeros and a trailing decimal point from a fixed-notation number string. */
function trimZeros(s: string): string {
  if (!s.includes(".")) return s;
  const trimmed = s.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed;
}

/** Format an energy quantity (joules) with an SI prefix: J / kJ / MJ / GJ / TJ. */
export function formatJoules(joules: number): string {
  return formatSi(joules, "J");
}

/** Format a power quantity (watts) with an SI prefix: W / kW / MW / GW / TW. */
export function formatWatts(watts: number): string {
  return formatSi(watts, "W");
}
