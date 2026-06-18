import { describe, expect, it } from "vitest";
import {
  hashStringUnit,
  isSectorCoverage,
  sectorAngles,
} from "./battleFog";

/**
 * Unit tests for the pure helpers exported from battleFog.ts.
 * Canvas drawing itself is not unit-tested; only the deterministic pure
 * functions that inform rendering are covered here.
 */
describe("hashStringUnit", () => {
  it("returns a value in [0, 1)", () => {
    const samples = ["cluster-1", "cluster-abc", "attacker-99", "", "x"];
    for (const s of samples) {
      const h = hashStringUnit(s);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it("is deterministic — same input always produces the same output", () => {
    const ids = ["cluster-0", "cluster-1", "abc", "def"];
    for (const id of ids) {
      const first = hashStringUnit(id);
      const second = hashStringUnit(id);
      expect(first).toBe(second);
    }
  });

  it("produces distinct values for different strings", () => {
    // Not a guarantee for all strings (hash collisions exist), but a basic
    // smoke-test that the function is not a constant.
    const a = hashStringUnit("cluster-attacker-1");
    const b = hashStringUnit("cluster-attacker-2");
    expect(a).not.toBe(b);
  });

  it("empty string does not throw and returns a value in [0, 1)", () => {
    const h = hashStringUnit("");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(1);
  });
});

describe("isSectorCoverage", () => {
  it("returns true when both bearing and arc are present", () => {
    expect(isSectorCoverage({ x: 0, y: 0, r: 10, bearing: 1, arc: 0.5 })).toBe(true);
  });

  it("returns false when both bearing and arc are absent", () => {
    expect(isSectorCoverage({ x: 0, y: 0, r: 10 })).toBe(false);
  });

  it("returns false when only bearing is present (treated as full circle)", () => {
    expect(isSectorCoverage({ x: 0, y: 0, r: 10, bearing: 1 })).toBe(false);
  });

  it("returns false when only arc is present (treated as full circle)", () => {
    expect(isSectorCoverage({ x: 0, y: 0, r: 10, arc: 0.5 })).toBe(false);
  });

  it("narrows bearing and arc to numbers inside the guard", () => {
    const cov: { x: number; y: number; r: number; bearing?: number; arc?: number } = {
      x: 1,
      y: 2,
      r: 3,
      bearing: 0.7,
      arc: 0.2,
    };
    if (isSectorCoverage(cov)) {
      // Both must be numbers; assigning to a number-typed const verifies narrowing.
      const b: number = cov.bearing;
      const a: number = cov.arc;
      expect(b).toBe(0.7);
      expect(a).toBe(0.2);
    }
  });

  it("is deterministic — same input always yields the same result", () => {
    const cov = { x: 5, y: 5, r: 20, bearing: 2.1, arc: 0.4 };
    expect(isSectorCoverage(cov)).toBe(isSectorCoverage(cov));
  });
});

describe("sectorAngles", () => {
  it("returns start = bearing - arc and end = bearing + arc", () => {
    expect(sectorAngles(1, 0.5)).toEqual({ start: 0.5, end: 1.5 });
  });

  it("handles zero arc (degenerate sector — a single bearing line)", () => {
    expect(sectorAngles(2, 0)).toEqual({ start: 2, end: 2 });
  });

  it("handles negative bearings", () => {
    expect(sectorAngles(-1, 0.25)).toEqual({ start: -1.25, end: -0.75 });
  });

  it("is deterministic — same inputs always yield the same outputs", () => {
    const a = sectorAngles(3.3, 0.6);
    const b = sectorAngles(3.3, 0.6);
    expect(a).toEqual(b);
  });
});
