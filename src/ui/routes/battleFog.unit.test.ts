import { describe, expect, it } from "vitest";
import { hashStringUnit } from "./battleFog";

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
