import { describe, expect, it } from "vitest";
import {
  computeOccluders,
  segmentBlocked,
  ASTEROID_OCCLUDER_COUNT,
  ASTEROID_MIN_R,
  ASTEROID_MAX_R,
  FIELD_X_MIN,
  FIELD_X_MAX,
  FIELD_Y_MIN,
  FIELD_Y_MAX,
  BLACK_HOLE_RADIUS,
} from "@/domain/occluders";

// ---------------------------------------------------------------------------
// computeOccluders
// ---------------------------------------------------------------------------

describe("computeOccluders", () => {
  describe("empty set (open space)", () => {
    it("returns an empty array", () => {
      expect(computeOccluders([], 42)).toEqual([]);
    });
  });

  describe("nebula", () => {
    it("returns an empty array (nebula attenuates sensors but has no hard occluders)", () => {
      expect(computeOccluders(["nebula"], 99)).toEqual([]);
    });
  });

  describe("blackHole", () => {
    it("returns exactly one disc", () => {
      const discs = computeOccluders(["blackHole"], 1);
      expect(discs).toHaveLength(1);
    });

    it("places the disc at the origin", () => {
      const [disc] = computeOccluders(["blackHole"], 1);
      expect(disc).toBeDefined();
      if (disc === undefined) return;
      expect(disc.x).toBe(0);
      expect(disc.y).toBe(0);
    });

    it("uses the black-hole lethal radius as the disc radius", () => {
      const [disc] = computeOccluders(["blackHole"], 1);
      expect(disc).toBeDefined();
      if (disc === undefined) return;
      expect(disc.r).toBe(BLACK_HOLE_RADIUS);
    });
  });

  describe("asteroidField", () => {
    it("returns exactly ASTEROID_OCCLUDER_COUNT discs", () => {
      const discs = computeOccluders(["asteroidField"], 7);
      expect(discs).toHaveLength(ASTEROID_OCCLUDER_COUNT);
    });

    it("positions all discs within the field bounds", () => {
      const discs = computeOccluders(["asteroidField"], 7);
      for (const disc of discs) {
        expect(disc.x).toBeGreaterThanOrEqual(FIELD_X_MIN);
        expect(disc.x).toBeLessThan(FIELD_X_MAX);
        expect(disc.y).toBeGreaterThanOrEqual(FIELD_Y_MIN);
        expect(disc.y).toBeLessThan(FIELD_Y_MAX);
      }
    });

    it("gives every disc a radius in [ASTEROID_MIN_R, ASTEROID_MAX_R)", () => {
      const discs = computeOccluders(["asteroidField"], 7);
      for (const disc of discs) {
        expect(disc.r).toBeGreaterThanOrEqual(ASTEROID_MIN_R);
        expect(disc.r).toBeLessThan(ASTEROID_MAX_R);
      }
    });

    it("is reproducible — two calls with the same seed produce deep-equal results", () => {
      const seed = 12345;
      expect(computeOccluders(["asteroidField"], seed)).toEqual(
        computeOccluders(["asteroidField"], seed),
      );
    });

    it("differs between seeds", () => {
      const a = computeOccluders(["asteroidField"], 1);
      const b = computeOccluders(["asteroidField"], 2);
      // It would be astronomically unlikely for two independent random sequences to
      // produce identical positions; a deep-inequality check is sufficient.
      expect(a).not.toEqual(b);
    });
  });

  describe("combinable anomalies", () => {
    it("unions the black-hole disc and the asteroid discs (black hole emitted first)", () => {
      const discs = computeOccluders(["asteroidField", "blackHole"], 7);
      expect(discs).toHaveLength(ASTEROID_OCCLUDER_COUNT + 1);
      // Canonical order: the black-hole disc is first, at the origin...
      expect(discs[0]?.x).toBe(0);
      expect(discs[0]?.y).toBe(0);
      expect(discs[0]?.r).toBe(BLACK_HOLE_RADIUS);
    });

    it("asteroid positions are identical whether or not a black hole is also active", () => {
      const seed = 314;
      const asteroidOnly = computeOccluders(["asteroidField"], seed);
      const combined = computeOccluders(["asteroidField", "blackHole"], seed);
      // Combined = [blackHoleDisc, ...asteroidDiscs]; the asteroid tail must match asteroid-only,
      // because the black-hole disc draws no RNG.
      expect(combined.slice(1)).toEqual(asteroidOnly);
    });

    it("nebula adds nothing on top of other anomalies", () => {
      const without = computeOccluders(["asteroidField"], 7);
      const withNebula = computeOccluders(["asteroidField", "nebula"], 7);
      expect(withNebula).toEqual(without);
    });

    it("is order-independent: any permutation of the set yields the same discs", () => {
      const seed = 256;
      const a = computeOccluders(["blackHole", "asteroidField", "nebula"], seed);
      const b = computeOccluders(["nebula", "asteroidField", "blackHole"], seed);
      expect(a).toEqual(b);
    });
  });

  describe("reproducibility", () => {
    it("returns the same result on repeated calls for blackHole", () => {
      expect(computeOccluders(["blackHole"], 0)).toEqual(
        computeOccluders(["blackHole"], 0),
      );
    });

    it("returns the same result on repeated calls for the empty set", () => {
      expect(computeOccluders([], 0)).toEqual(computeOccluders([], 0));
    });
  });
});

// ---------------------------------------------------------------------------
// segmentBlocked
// ---------------------------------------------------------------------------

describe("segmentBlocked", () => {
  it("returns false when discs array is empty", () => {
    expect(segmentBlocked(0, 0, 10, 0, [])).toBe(false);
  });

  it("returns true when the segment passes through a disc centre", () => {
    // Disc centred at (5, 0) with radius 2. Segment goes straight through it.
    const discs = [{ x: 5, y: 0, r: 2 }];
    expect(segmentBlocked(0, 0, 10, 0, discs)).toBe(true);
  });

  it("returns false when the segment passes clearly outside a disc", () => {
    // Disc centred at (5, 10) with radius 2. Segment runs along y = 0.
    const discs = [{ x: 5, y: 10, r: 2 }];
    expect(segmentBlocked(0, 0, 10, 0, discs)).toBe(false);
  });

  it("returns true when the segment grazes within the disc radius", () => {
    // Disc at (5, 1) with r = 2. Closest point on segment y=0 is (5, 0);
    // distance = 1, which is <= r = 2. Should be blocked.
    const discs = [{ x: 5, y: 1, r: 2 }];
    expect(segmentBlocked(0, 0, 10, 0, discs)).toBe(true);
  });

  it("returns false when the segment just misses the disc (distance > r)", () => {
    // Disc at (5, 3) with r = 2. Closest point on segment y=0 is (5, 0);
    // distance = 3, which is > r = 2. Should NOT be blocked.
    const discs = [{ x: 5, y: 3, r: 2 }];
    expect(segmentBlocked(0, 0, 10, 0, discs)).toBe(false);
  });

  it("returns false when the disc is beyond the segment endpoints", () => {
    // Disc at (15, 0) with r = 2. Segment ends at x=10; closest point is (10, 0),
    // distance = 5 > r = 2. Should NOT be blocked.
    const discs = [{ x: 15, y: 0, r: 2 }];
    expect(segmentBlocked(0, 0, 10, 0, discs)).toBe(false);
  });

  it("returns true when ANY disc blocks the segment", () => {
    const discs = [
      { x: 5, y: 100, r: 2 },  // miss
      { x: 5, y: 0, r: 2 },    // hit
    ];
    expect(segmentBlocked(0, 0, 10, 0, discs)).toBe(true);
  });

  it("handles a zero-length segment (point query)", () => {
    // A zero-length segment from (5, 0) to (5, 0) against a disc at (5, 0).
    // The point lies exactly on the disc centre; distance = 0 <= r.
    const discs = [{ x: 5, y: 0, r: 2 }];
    expect(segmentBlocked(5, 0, 5, 0, discs)).toBe(true);
  });

  it("handles a zero-length segment outside any disc", () => {
    const discs = [{ x: 5, y: 0, r: 2 }];
    expect(segmentBlocked(0, 0, 0, 0, discs)).toBe(false);
  });
});
