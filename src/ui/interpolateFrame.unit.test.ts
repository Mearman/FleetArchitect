import { describe, expect, it } from "vitest";
import { interpolateFrame } from "./interpolateFrame";
import type { BattleFrame } from "@/schema/battle";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFrame(tick: number, x: number, y: number, facing: number): BattleFrame {
  return {
    tick,
    ships: [
      {
        instanceId: "ship-1",
        side: "attacker",
        x,
        y,
        facing,
        vx: 0,
        vy: 0,
        structure: 100,
        shield: 50,
        alive: true,
        comX: 0,
        comY: 0,
      },
    ],
    projectiles: [],
  };
}

const FRAME_0 = makeFrame(0, 0, 0, 0);
const FRAME_1 = makeFrame(1, 10, 20, Math.PI / 2);
const FRAME_2 = makeFrame(2, 30, 40, Math.PI);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("interpolateFrame", () => {
  it("returns an empty frame when given no frames", () => {
    const result = interpolateFrame([], 0);
    expect(result.ships).toHaveLength(0);
    expect(result.projectiles).toHaveLength(0);
    expect(result.tick).toBe(0);
  });

  it("returns the first frame when t = 0", () => {
    const result = interpolateFrame([FRAME_0, FRAME_1], 0);
    const ship = result.ships[0];
    expect(ship?.x).toBe(0);
    expect(ship?.y).toBe(0);
    expect(ship?.facing).toBeCloseTo(0);
  });

  it("returns the last frame when t equals the last index", () => {
    const result = interpolateFrame([FRAME_0, FRAME_1], 1);
    const ship = result.ships[0];
    expect(ship?.x).toBe(10);
    expect(ship?.y).toBe(20);
    expect(ship?.facing).toBeCloseTo(Math.PI / 2);
  });

  it("clamps below zero", () => {
    const result = interpolateFrame([FRAME_0, FRAME_1], -5);
    const ship = result.ships[0];
    expect(ship?.x).toBe(0);
    expect(ship?.y).toBe(0);
  });

  it("clamps above last index", () => {
    const result = interpolateFrame([FRAME_0, FRAME_1, FRAME_2], 99);
    const ship = result.ships[0];
    expect(ship?.x).toBe(30);
    expect(ship?.y).toBe(40);
  });

  it("linearly interpolates position at midpoint (t = 0.5)", () => {
    const result = interpolateFrame([FRAME_0, FRAME_1], 0.5);
    const ship = result.ships[0];
    expect(ship?.x).toBeCloseTo(5);
    expect(ship?.y).toBeCloseTo(10);
  });

  it("linearly interpolates position at an arbitrary fractional t", () => {
    const result = interpolateFrame([FRAME_0, FRAME_1, FRAME_2], 1.25);
    // Between FRAME_1 (x=10) and FRAME_2 (x=30), alpha=0.25 → x = 10 + 20*0.25 = 15
    const ship = result.ships[0];
    expect(ship?.x).toBeCloseTo(15);
    expect(ship?.y).toBeCloseTo(25);
  });

  it("interpolates facing at midpoint", () => {
    const result = interpolateFrame([FRAME_0, FRAME_1], 0.5);
    const ship = result.ships[0];
    expect(ship?.facing).toBeCloseTo(Math.PI / 4);
  });

  it("takes the shortest arc when facing crosses the ±π boundary", () => {
    // From π - 0.1 to -(π - 0.1) — the short arc is −0.2 rad (crossing π),
    // NOT going the long way around (+2π − 0.2).
    const nearPosPI = Math.PI - 0.1;
    const nearNegPI = -(Math.PI - 0.1);
    const frameA: BattleFrame = {
      tick: 0,
      ships: [
        {
          instanceId: "s",
          side: "attacker",
          x: 0,
          y: 0,
          facing: nearPosPI,
          structure: 100,
          shield: 0,
          alive: true,
        },
      ],
      projectiles: [],
    };
    const frameB: BattleFrame = {
      tick: 1,
      ships: [
        {
          instanceId: "s",
          side: "attacker",
          x: 0,
          y: 0,
          facing: nearNegPI,
          structure: 100,
          shield: 0,
          alive: true,
        },
      ],
      projectiles: [],
    };

    const mid = interpolateFrame([frameA, frameB], 0.5);
    const ship = mid.ships[0];
    // Shortest arc midpoint is π (or equivalently −π) since the delta is 0.2 rad
    // and the facing at the boundary should be within a small epsilon of ±π.
    expect(Math.abs(ship?.facing ?? 0)).toBeCloseTo(Math.PI, 3);
  });

  it("uses the lo-frame for discrete state when alpha < 0.5", () => {
    const frameA: BattleFrame = {
      tick: 0,
      ships: [
        {
          instanceId: "s",
          side: "attacker",
          x: 0,
          y: 0,
          structure: 100,
          shield: 0,
          alive: true,
        },
      ],
      projectiles: [{ x: 1, y: 2, kind: "cannon" }],
    };
    const frameB: BattleFrame = {
      tick: 1,
      ships: [
        {
          instanceId: "s",
          side: "attacker",
          x: 10,
          y: 0,
          structure: 80,
          shield: 0,
          alive: true,
        },
      ],
      projectiles: [{ x: 5, y: 2, kind: "cannon" }],
    };

    // Alpha = 0.3 → nearest is lo (frameA)
    const result = interpolateFrame([frameA, frameB], 0.3);
    const ship = result.ships[0];
    // Discrete: structure from frameA
    expect(ship?.structure).toBe(100);
    // Continuous: x interpolated
    expect(ship?.x).toBeCloseTo(3);
    // Projectile from nearest (frameA)
    expect(result.projectiles[0]?.x).toBeCloseTo(1);
  });

  it("uses the hi-frame for discrete state when alpha >= 0.5", () => {
    const frameA: BattleFrame = {
      tick: 0,
      ships: [
        {
          instanceId: "s",
          side: "attacker",
          x: 0,
          y: 0,
          structure: 100,
          shield: 0,
          alive: true,
        },
      ],
      projectiles: [{ x: 1, y: 2, kind: "cannon" }],
    };
    const frameB: BattleFrame = {
      tick: 1,
      ships: [
        {
          instanceId: "s",
          side: "attacker",
          x: 10,
          y: 0,
          structure: 80,
          shield: 0,
          alive: true,
        },
      ],
      projectiles: [{ x: 5, y: 2, kind: "cannon" }],
    };

    // Alpha = 0.7 → nearest is hi (frameB)
    const result = interpolateFrame([frameA, frameB], 0.7);
    const ship = result.ships[0];
    // Discrete: structure from frameB
    expect(ship?.structure).toBe(80);
    // Continuous: x interpolated
    expect(ship?.x).toBeCloseTo(7);
    // Projectile from nearest (frameB)
    expect(result.projectiles[0]?.x).toBeCloseTo(5);
  });

  it("omits a ship from interpolation when it exists only in the lo frame", () => {
    const frameA: BattleFrame = {
      tick: 0,
      ships: [
        { instanceId: "s1", side: "attacker", x: 0, y: 0, structure: 100, shield: 0, alive: true },
        { instanceId: "s2", side: "defender", x: 50, y: 0, structure: 100, shield: 0, alive: true },
      ],
      projectiles: [],
    };
    const frameB: BattleFrame = {
      tick: 1,
      ships: [
        // s2 vanished (e.g. just destroyed and not yet snapshotted in hi frame)
        { instanceId: "s1", side: "attacker", x: 10, y: 0, structure: 100, shield: 0, alive: true },
      ],
      projectiles: [],
    };

    const result = interpolateFrame([frameA, frameB], 0.5);
    // s2 should fall back to the lo snapshot (position 50, not interpolated)
    const s2 = result.ships.find((s) => s.instanceId === "s2");
    expect(s2).toBeDefined();
    expect(s2?.x).toBe(50);
  });
});
