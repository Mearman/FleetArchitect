import { describe, expect, it } from "vitest";
import type { BattleFrame, MediumSnapshot } from "@/schema/battle";
import { resolveMediumField } from "./mediumShared";

/**
 * The medium overlays resolve the field per-tick via {@link resolveMediumField}
 * rather than a module-scoped "last-seen" cache. These tests pin the contract
 * that makes that scrub-safe: the field is a PURE FUNCTION OF THE TICK, so
 * forward and backward scrub to the same tick resolve to the identical field
 * regardless of which frames were rendered beforehand.
 *
 * Frames carry `medium` only on emission ticks (every RESOURCE_EVERY ticks);
 * ticks between emissions carry none. The resolver must return the most recent
 * emission AT OR BEFORE the requested tick.
 */

/** Minimal frame carrying only the fields `resolveMediumField` reads. */
function makeFrame(tick: number, medium?: MediumSnapshot): BattleFrame {
  return {
    tick,
    ships: [],
    projectiles: [],
    ...(medium !== undefined ? { medium } : {}),
  };
}

/** A distinguishable field so tests can assert WHICH emission was resolved,
 *  by identity (referential equality), not just that some field came back. */
function makeField(tag: number): MediumSnapshot {
  return {
    rho: new Float64Array([tag]),
    eps: new Float64Array([tag]),
    widthM: 1,
    heightM: 1,
    pitchM: 1,
  };
}

describe("resolveMediumField", () => {
  it("returns the most recent emission at or before the tick", () => {
    // Emissions at ticks 0 and 6; ticks 1-5 and 7-8 carry no medium.
    const a = makeField(1);
    const b = makeField(2);
    const frames: BattleFrame[] = [
      makeFrame(0, a),
      makeFrame(1),
      makeFrame(2),
      makeFrame(3),
      makeFrame(4),
      makeFrame(5),
      makeFrame(6, b),
      makeFrame(7),
      makeFrame(8),
    ];

    expect(resolveMediumField(frames, 8)).toBe(b); // after emission 6
    expect(resolveMediumField(frames, 6)).toBe(b); // exactly on emission 6
    expect(resolveMediumField(frames, 5)).toBe(a); // between 0 and 6 -> earlier
    expect(resolveMediumField(frames, 1)).toBe(a); // just after emission 0
    expect(resolveMediumField(frames, 0)).toBe(a); // first emission
  });

  it("is order-independent: scrub forward then backward resolves the same field", () => {
    // The core determinism assertion the scrub bug violated. A forward-only
    // "last-seen" cache would, after visiting tick 13 (emission 12 = c), return
    // c for tick 9; after visiting tick 0 (emission 0 = a), return a for tick 9.
    // A pure tick-based resolver must return emission 6 (= b) in every case.
    const a = makeField(1);
    const b = makeField(2);
    const c = makeField(3);
    const frames: BattleFrame[] = [
      makeFrame(0, a),
      makeFrame(1),
      makeFrame(2),
      makeFrame(3),
      makeFrame(4),
      makeFrame(5),
      makeFrame(6, b),
      makeFrame(7),
      makeFrame(8),
      makeFrame(9),
      makeFrame(10),
      makeFrame(11),
      makeFrame(12, c),
      makeFrame(13),
    ];

    // Scrub forward past emission 12, then back to tick 9: still emission 6.
    resolveMediumField(frames, 13);
    expect(resolveMediumField(frames, 9)).toBe(b);

    // Scrub all the way back to tick 0, then forward to tick 9: still emission 6.
    resolveMediumField(frames, 0);
    expect(resolveMediumField(frames, 9)).toBe(b);

    // Repeated resolution at the same tick is stable.
    expect(resolveMediumField(frames, 9)).toBe(resolveMediumField(frames, 9));
  });

  it("clamps the tick to the available frame range", () => {
    const a = makeField(1);
    const frames: BattleFrame[] = [makeFrame(0, a), makeFrame(1)];

    expect(resolveMediumField(frames, -5)).toBe(a); // before start -> clamp to 0
    expect(resolveMediumField(frames, 99)).toBe(a); // past end -> clamp, scan back to 0
  });

  it("returns undefined when no frame carries a medium field", () => {
    // A vacuum-anomaly battle (or a pre-medium replay): no frame has a field.
    const frames: BattleFrame[] = [makeFrame(0), makeFrame(1), makeFrame(2)];

    expect(resolveMediumField(frames, 2)).toBeUndefined();
  });

  it("returns undefined for an empty frame history", () => {
    expect(resolveMediumField([], 0)).toBeUndefined();
  });
});
