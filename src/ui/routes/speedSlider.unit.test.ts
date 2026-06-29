import { describe, expect, it } from "vitest";
import {
  DESIRED_MAX_SPEED,
  formatSpeed,
  MAX_SPEED,
  MIN_SPEED,
  posToSpeed,
  speedMarks,
  speedToPos,
} from "./speedSlider";

describe("speedSlider", () => {
  describe("speedToPos", () => {
    it("maps the rail bounds to 0 and 1", () => {
      expect(speedToPos(MIN_SPEED)).toBe(0);
      expect(speedToPos(MAX_SPEED)).toBe(1);
    });

    it("places the desired cap at five-sixths of the rail", () => {
      // 0.25 -> 16 is six doublings; 8 sits five doublings up.
      expect(speedToPos(DESIRED_MAX_SPEED)).toBeCloseTo(5 / 6, 10);
    });

    it("spaces each doubling equally (log scale)", () => {
      const step = speedToPos(0.5) - speedToPos(0.25);
      expect(speedToPos(1) - speedToPos(0.5)).toBeCloseTo(step, 10);
      expect(speedToPos(2) - speedToPos(1)).toBeCloseTo(step, 10);
      expect(speedToPos(4) - speedToPos(2)).toBeCloseTo(step, 10);
      expect(speedToPos(8) - speedToPos(4)).toBeCloseTo(step, 10);
      expect(speedToPos(16) - speedToPos(8)).toBeCloseTo(step, 10);
    });

    it("clamps out-of-range speeds to the rail ends", () => {
      expect(speedToPos(0)).toBe(0);
      expect(speedToPos(100)).toBe(1);
    });
  });

  describe("posToSpeed", () => {
    it("round-trips through speedToPos across the desired range", () => {
      for (const s of [0.25, 0.5, 1, 2, 4, 8]) {
        expect(posToSpeed(speedToPos(s))).toBeCloseTo(s, 10);
      }
    });

    it("hits the desired cap and never exceeds it", () => {
      expect(posToSpeed(1)).toBe(DESIRED_MAX_SPEED);
      expect(posToSpeed(0.95)).toBe(DESIRED_MAX_SPEED);
    });

    it("floors to the minimum at the left edge", () => {
      expect(posToSpeed(0)).toBe(MIN_SPEED);
    });

    it("puts the rail midpoint at the geometric mean (2x)", () => {
      // sqrt(0.25 * 16) = 2.
      expect(posToSpeed(0.5)).toBeCloseTo(2, 10);
    });
  });

  describe("speedMarks", () => {
    it("yields one mark per preset, ascending by position", () => {
      const marks = speedMarks();
      expect(marks).toHaveLength(6);
      const positions = marks.map((m) => m.value);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    });

    it("labels marks with formatSpeed", () => {
      const labels = speedMarks().map((m) => m.label);
      expect(labels).toEqual(["0.25x", "0.5x", "1x", "2x", "4x", "8x"]);
    });
  });

  describe("formatSpeed", () => {
    it("drops trailing zeros and the decimal point", () => {
      expect(formatSpeed(8)).toBe("8x");
      expect(formatSpeed(1)).toBe("1x");
      expect(formatSpeed(0.25)).toBe("0.25x");
      expect(formatSpeed(0.5)).toBe("0.5x");
      expect(formatSpeed(2.5)).toBe("2.5x");
      expect(formatSpeed(1.7)).toBe("1.7x");
    });

    it("keeps two decimals for arbitrary values", () => {
      expect(formatSpeed(1.7342)).toBe("1.73x");
    });
  });
});
