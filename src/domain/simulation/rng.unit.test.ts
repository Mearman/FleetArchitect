import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/domain/simulation/rng";

/**
 * The RNG underpins battle determinism: a fresh `mulberry32(seed)` must draw the
 * same sequence it always has (so existing battles stay byte-identical), and the
 * `getState`/`initialState` pair must let a draw sequence be checkpointed and
 * resumed exactly — the foundation the resumable-checkpoint work rests on.
 */
describe("mulberry32", () => {
  it("draws the canonical sequence for a fresh seed", () => {
    // Frozen reference: the exact first draws of `mulberry32(seed >>> 0)` under
    // the original arithmetic. If the per-call maths ever changes, this fails —
    // which would mean every existing battle's frames have shifted.
    const seed = 12345;
    const rng = mulberry32(seed);
    const drawn = [rng(), rng(), rng(), rng(), rng()];

    // Reconstruct the reference inline with the same algorithm and an
    // independent state variable, so the test is self-contained and proves the
    // exported function matches the canonical mulberry32 step.
    let state = seed >>> 0;
    const reference = Array.from({ length: 5 }, () => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    });

    expect(drawn).toEqual(reference);
  });

  it("resumes from a captured state so the tail matches an uninterrupted run", () => {
    const seed = 0xc0ffee;
    const advanceBy = 7;

    // One generator runs straight through; the tail is its draws after the
    // first `advanceBy` draws.
    const continuous = mulberry32(seed);
    for (let i = 0; i < advanceBy; i += 1) continuous();
    const continuousTail = [continuous(), continuous(), continuous()];

    // A second generator runs to the same point, has its state captured, and a
    // third resumes from that state. The resumed tail must be byte-identical.
    const advanced = mulberry32(seed);
    for (let i = 0; i < advanceBy; i += 1) advanced();
    const captured = advanced.getState();

    const resumed = mulberry32(seed, captured);
    const resumedTail = [resumed(), resumed(), resumed()];

    expect(resumedTail).toEqual(continuousTail);
  });

  it("round-trips getState: capturing and restoring yields identical onward draws", () => {
    const seed = 98765;
    const rng = mulberry32(seed);
    for (let i = 0; i < 4; i += 1) rng();

    const captured = rng.getState();
    const restored = mulberry32(seed, captured);

    // Both generators continue from the same internal state, so every onward
    // draw and every onward state must agree.
    for (let i = 0; i < 10; i += 1) {
      expect(restored()).toBe(rng());
      expect(restored.getState()).toBe(rng.getState());
    }
  });

  it("treats the initial state as the canonical seed state when resuming from the start", () => {
    const seed = 42;
    // A generator that has drawn nothing has state `seed >>> 0`; resuming from
    // that state must reproduce the fresh sequence exactly.
    const fresh = mulberry32(seed);
    const startState = fresh.getState();
    expect(startState).toBe(seed >>> 0);

    const resumedFromStart = mulberry32(seed, startState);
    expect([resumedFromStart(), resumedFromStart(), resumedFromStart()]).toEqual([
      fresh(),
      fresh(),
      fresh(),
    ]);
  });
});
