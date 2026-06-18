import { describe, expect, it } from "vitest";
import { interpolateFrame } from "./interpolateFrame";
import type { BattleFrame, CrewSnapshot } from "@/schema/battle";

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
      projectiles: [{ id: "proj-0", x: 1, y: 2, kind: "cannon" }],
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
      projectiles: [{ id: "proj-0", x: 5, y: 2, kind: "cannon" }],
    };

    // Alpha = 0.3 → nearest is lo (frameA)
    const result = interpolateFrame([frameA, frameB], 0.3);
    const ship = result.ships[0];
    // Discrete: structure from frameA
    expect(ship?.structure).toBe(100);
    // Continuous: x interpolated
    expect(ship?.x).toBeCloseTo(3);
    // Projectile interpolated (lerp 1→5 at alpha 0.3 = 2.2)
    expect(result.projectiles[0]?.x).toBeCloseTo(2.2);
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
      projectiles: [{ id: "proj-0", x: 1, y: 2, kind: "cannon" }],
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
      projectiles: [{ id: "proj-0", x: 5, y: 2, kind: "cannon" }],
    };

    // Alpha = 0.7 → nearest is hi (frameB)
    const result = interpolateFrame([frameA, frameB], 0.7);
    const ship = result.ships[0];
    // Discrete: structure from frameB
    expect(ship?.structure).toBe(80);
    // Continuous: x interpolated
    expect(ship?.x).toBeCloseTo(7);
    // Projectile interpolated (lerp 1→5 at alpha 0.7 = 3.8)
    expect(result.projectiles[0]?.x).toBeCloseTo(3.8);
  });

  // ---------------------------------------------------------------------------
  // Crew interpolation
  // ---------------------------------------------------------------------------

  describe("crew interpolation", () => {
    function makeCrewFrame(
      tick: number,
      crew: CrewSnapshot[],
    ): BattleFrame {
      return {
        tick,
        ships: [
          {
            instanceId: "ship-1",
            side: "attacker",
            x: 0,
            y: 0,
            structure: 100,
            shield: 0,
            alive: true,
            crew,
          },
        ],
        projectiles: [],
      };
    }

    it("lerps crew x and y at the midpoint", () => {
      const frameA = makeCrewFrame(0, [
        { id: "c1", x: 0, y: 0, state: "idle", hp: 100 },
      ]);
      const frameB = makeCrewFrame(1, [
        { id: "c1", x: 20, y: 40, state: "walking", hp: 100 },
      ]);

      const result = interpolateFrame([frameA, frameB], 0.5);
      const crew = result.ships[0]?.crew;
      expect(crew).toHaveLength(1);
      expect(crew?.[0]?.x).toBeCloseTo(10);
      expect(crew?.[0]?.y).toBeCloseTo(20);
    });

    it("takes discrete state from the lo frame when alpha < 0.5", () => {
      const frameA = makeCrewFrame(0, [
        { id: "c1", x: 0, y: 0, state: "idle", hp: 100 },
      ]);
      const frameB = makeCrewFrame(1, [
        { id: "c1", x: 20, y: 0, state: "manning", hp: 80, carrying: "ammo" },
      ]);

      // alpha = 0.3 → nearest is lo
      const result = interpolateFrame([frameA, frameB], 0.3);
      const c = result.ships[0]?.crew?.[0];
      expect(c?.state).toBe("idle");
      expect(c?.hp).toBe(100);
      expect(c?.carrying).toBeUndefined();
    });

    it("takes discrete state from the hi frame when alpha >= 0.5", () => {
      const frameA = makeCrewFrame(0, [
        { id: "c1", x: 0, y: 0, state: "idle", hp: 100 },
      ]);
      const frameB = makeCrewFrame(1, [
        { id: "c1", x: 20, y: 0, state: "manning", hp: 80, carrying: "power" },
      ]);

      // alpha = 0.7 → nearest is hi
      const result = interpolateFrame([frameA, frameB], 0.7);
      const c = result.ships[0]?.crew?.[0];
      expect(c?.state).toBe("manning");
      expect(c?.hp).toBe(80);
      expect(c?.carrying).toBe("power");
    });

    it("carries through crew present only in the lo frame", () => {
      const frameA = makeCrewFrame(0, [
        { id: "c1", x: 5, y: 10, state: "idle", hp: 100 },
        { id: "c2", x: 15, y: 20, state: "hauling", hp: 50, carrying: "ammo" },
      ]);
      const frameB = makeCrewFrame(1, [
        // c2 absent (e.g. just killed)
        { id: "c1", x: 25, y: 30, state: "walking", hp: 100 },
      ]);

      const result = interpolateFrame([frameA, frameB], 0.5);
      const crew = result.ships[0]?.crew ?? [];
      const c2 = crew.find((c) => c.id === "c2");
      expect(c2).toBeDefined();
      expect(c2?.x).toBeCloseTo(15);
      expect(c2?.y).toBeCloseTo(20);
    });

    it("carries through crew present only in the hi frame", () => {
      const frameA = makeCrewFrame(0, [
        { id: "c1", x: 0, y: 0, state: "idle", hp: 100 },
      ]);
      const frameB = makeCrewFrame(1, [
        { id: "c1", x: 20, y: 0, state: "idle", hp: 100 },
        // c2 newly spawned in hi
        { id: "c2", x: 50, y: 50, state: "idle", hp: 100 },
      ]);

      const result = interpolateFrame([frameA, frameB], 0.5);
      const crew = result.ships[0]?.crew ?? [];
      const c2 = crew.find((c) => c.id === "c2");
      expect(c2).toBeDefined();
      expect(c2?.x).toBeCloseTo(50);
    });

    it("two crew members do not cross-contaminate", () => {
      const frameA = makeCrewFrame(0, [
        { id: "c1", x: 0, y: 0, state: "idle", hp: 100 },
        { id: "c2", x: 100, y: 100, state: "manning", hp: 80 },
      ]);
      const frameB = makeCrewFrame(1, [
        { id: "c1", x: 20, y: 0, state: "idle", hp: 100 },
        { id: "c2", x: 120, y: 100, state: "manning", hp: 80 },
      ]);

      const result = interpolateFrame([frameA, frameB], 0.5);
      const crew = result.ships[0]?.crew ?? [];
      const c1 = crew.find((c) => c.id === "c1");
      const c2 = crew.find((c) => c.id === "c2");
      // c1 interpolated between (0,0) and (20,0): midpoint = (10,0)
      expect(c1?.x).toBeCloseTo(10);
      expect(c1?.y).toBeCloseTo(0);
      // c2 interpolated between (100,100) and (120,100): midpoint = (110,100)
      expect(c2?.x).toBeCloseTo(110);
      expect(c2?.y).toBeCloseTo(100);
    });

    it("returns undefined crew when both frames have no crew", () => {
      const frameA: BattleFrame = {
        tick: 0,
        ships: [
          { instanceId: "s", side: "attacker", x: 0, y: 0, structure: 100, shield: 0, alive: true },
        ],
        projectiles: [],
      };
      const frameB: BattleFrame = {
        tick: 1,
        ships: [
          { instanceId: "s", side: "attacker", x: 10, y: 0, structure: 100, shield: 0, alive: true },
        ],
        projectiles: [],
      };
      const result = interpolateFrame([frameA, frameB], 0.5);
      expect(result.ships[0]?.crew).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Awareness (discrete — taken from nearest frame, never interpolated)
  // ---------------------------------------------------------------------------

  describe("awareness interpolation", () => {
    function makeAwarenessFrame(tick: number, x: number, contactX: number): BattleFrame {
      return {
        tick,
        ships: [
          { instanceId: "s1", side: "attacker", x, y: 0, structure: 100, shield: 0, alive: true },
        ],
        projectiles: [],
        awareness: {
          occluders: [],
          clusters: [
            {
              id: `cluster-${tick}`,
              side: "attacker",
              memberIds: ["s1"],
              coverage: [{ x: contactX, y: 0, r: 50 }],
            },
          ],
          contacts: [],
          ghosts: [],
          links: [],
          dishAngles: [],
        },
      };
    }

    it("carries awareness from the lo frame when alpha < 0.5", () => {
      const frameA = makeAwarenessFrame(0, 0, 10);
      const frameB = makeAwarenessFrame(1, 10, 20);

      // alpha = 0.3 → nearest is lo (frameA)
      const result = interpolateFrame([frameA, frameB], 0.3);
      expect(result.awareness).toBeDefined();
      expect(result.awareness?.clusters[0]?.id).toBe("cluster-0");
      // Coverage disc is from frameA, not interpolated
      expect(result.awareness?.clusters[0]?.coverage[0]?.x).toBe(10);
    });

    it("carries awareness from the hi frame when alpha >= 0.5", () => {
      const frameA = makeAwarenessFrame(0, 0, 10);
      const frameB = makeAwarenessFrame(1, 10, 20);

      // alpha = 0.7 → nearest is hi (frameB)
      const result = interpolateFrame([frameA, frameB], 0.7);
      expect(result.awareness).toBeDefined();
      expect(result.awareness?.clusters[0]?.id).toBe("cluster-1");
      // Coverage disc is from frameB, not interpolated
      expect(result.awareness?.clusters[0]?.coverage[0]?.x).toBe(20);
    });

    it("carries undefined awareness when neither frame has awareness", () => {
      const frameA: BattleFrame = {
        tick: 0,
        ships: [{ instanceId: "s", side: "attacker", x: 0, y: 0, structure: 100, shield: 0, alive: true }],
        projectiles: [],
      };
      const frameB: BattleFrame = {
        tick: 1,
        ships: [{ instanceId: "s", side: "attacker", x: 10, y: 0, structure: 100, shield: 0, alive: true }],
        projectiles: [],
      };

      const result = interpolateFrame([frameA, frameB], 0.5);
      expect(result.awareness).toBeUndefined();
    });

    it("is never a blend of lo and hi awareness values", () => {
      const frameA = makeAwarenessFrame(0, 0, 100);
      const frameB = makeAwarenessFrame(1, 10, 200);

      // At alpha = 0.5 (boundary), nearest is hi — coverage.x must be exactly
      // 200 (frameB's value), not 150 (a blend of 100 and 200).
      const result = interpolateFrame([frameA, frameB], 0.5);
      const coverageX = result.awareness?.clusters[0]?.coverage[0]?.x;
      expect(coverageX).toBe(200);
    });
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
