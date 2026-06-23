/**
 * Performance-guard toggles for the O(C^2) engine hot paths (W5b).
 *
 * Each guard bounds or short-circuits a damage / power path that, unoptimised,
 * re-scans every cell of a ship per event — fine for a handful of cells, but
 * quadratic on a thousand-cell hull. Every guard is a pure optimisation: with
 * the flag on (the default) the engine produces byte-identical frames to the
 * naive path with it off. The flags exist ONLY so the determinism suite can run
 * a battle twice on one resolved snapshot — once optimised, once naive — and
 * assert the frame streams match, proving the optimisation preserves behaviour.
 * Production always runs with every guard on; nothing outside the test toggles
 * them, so the default object is the single live configuration.
 */
export interface PerfGuards {
  /** Skip break-apart's union-find when the alive-cell topology is unchanged
   *  since the last pass that found the ship whole. */
  breakApartTopology: boolean;
  /** Use a spatial pre-filter for chain-reaction blast targets instead of
   *  sorting every alive cell on the ship per blast. */
  chainReactionSpatial: boolean;
  /** Bound the brownout power-cut victim search so it does not re-scan every
   *  cell per cut. */
  brownoutBounded: boolean;
  /** Rebuild the per-side roster lists and id index only when the live ships
   *  array grows, rather than every tick. Membership only grows (break-apart
   *  chunks and phantom launches push into the same stable array) and ships
   *  never change side, so the rebuilt structures have identical contents
   *  whenever the length is unchanged. */
  incrementalRoster: boolean;
}

/** The live guard configuration. Mutated only by the determinism A/B test, which
 *  restores it afterwards; production never touches it. */
export const PERF_GUARDS: PerfGuards = {
  breakApartTopology: true,
  chainReactionSpatial: true,
  brownoutBounded: true,
  incrementalRoster: true,
};
