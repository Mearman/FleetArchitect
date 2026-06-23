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

/**
 * A deterministic random source: callable for the next draw in `[0, 1)`, plus
 * `getState()` to read the generator's current internal state so a battle can
 * be checkpointed and resumed byte-identically. The state is the value that,
 * passed back as `mulberry32`'s `initialState`, reproduces the remaining draw
 * sequence exactly from where it left off.
 */
export interface Rng {
  (): number;
  getState(): number;
}

/**
 * Construct a deterministic `Rng` from a seed. When `initialState` is omitted a
 * fresh generator is seeded `seed >>> 0` and its draw sequence is identical to
 * the original `() => number` form — the per-call arithmetic is unchanged, so
 * existing battles stay byte-for-byte reproducible. Passing the `getState()`
 * value captured from an earlier generator as `initialState` resumes the
 * sequence from that point, which is how a checkpointed battle continues without
 * diverging.
 */
export function mulberry32(seed: number, initialState?: number): Rng {
  let state = initialState === undefined ? seed >>> 0 : initialState >>> 0;
  const next = (): number => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.getState = (): number => state >>> 0;
  return next;
}

/** Deterministic float in [min, max). */
export function ranged(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}
