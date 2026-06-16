/**
 * Deterministic pseudo-random number generator. The battle must be reproducible
 * from its seed, so every random draw (weapon spread, asteroid deflection,
 * staggered initial cooldowns) flows through the single generator created from
 * `BattleInputs.seed`. Draw order is fixed by the simulation loop, which makes
 * the whole battle a pure function of its inputs.
 *
 * mulberry32: fast, stateless-seed, good enough distribution for a game, and
 * its output is identical across browsers and Node for a given seed.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic float in [min, max). */
export function ranged(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}
