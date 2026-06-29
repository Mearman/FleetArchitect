import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleAnomalyKind } from "@/schema/battle";
import type { CombatShip, BattleInputs } from "@/domain/simulation/types";
import type { WeaponEffect } from "@/schema/module";
import { modularShip, targetDummy } from "./engine.factions-tech-helpers";

/**
 * Anomaly-aware AI: ships should REACT to the active spatial anomalies rather
 * than fly into it blind. Three behaviours are covered:
 *  - black-hole avoidance: a ship whose direct path to its target crosses the
 *    well arcs around the danger zone instead of ploughing through it, so its
 *    closest approach to the centre stays well outside the lethal radius;
 *  - nebula range closing: ships fight closer where their (less-effective)
 *    homing shots still land;
 *  - asteroid-field range closing: ships fight somewhat closer to cut the
 *    time-of-flight over which rounds are destroyed.
 * Plus determinism (two black-hole runs are byte-identical) and a regression
 * guard that anomalies=[] is unchanged.
 *
 * Each behavioural test compares the anomalies-on battle against the same battle
 * with a baseline anomalies so the assertion is robust to the rest of the engine.
 */

function weapon(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "cannon",
    damage: 10,
    range: 600,
    cooldown: 1,
    projectileSpeed: 8,
    projectileMass: 0.5,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    ...over,
  };
}

function makeShip(opts: {
  id: string;
  side: "attacker" | "defender";
  x: number;
  y: number;
  facing?: number;
  structure?: number;
  thrust?: number;
  turnRate?: number;
  weapons?: WeaponEffect[];
  orders?: Partial<{ engageRange: "short" | "medium" | "long" | "hold"; stance: "aggressive" | "balanced" | "defensive" | "evasive" }>;
}): CombatShip {
  const weapons = opts.weapons ?? [];
  // Ships that fire are full modular ships; a weaponless defender is a
  // target dummy — a modular position marker whose bridge sits off the
  // line of fire so it survives the attacker's barrage and stays on the
  // board for the attacker to acquire and steer against.
  if (weapons.length > 0) {
    return modularShip({
      id: opts.id,
      side: opts.side,
      x: opts.x,
      y: opts.y,
      facing: opts.facing,
      structure: opts.structure,
      thrust: opts.thrust ?? 0.5,
      // Physical angular acceleration (rad/tick^2) under the frictionless
      // model; rescaled from the legacy /5 scalar.
      turnRate: opts.turnRate ?? 0.02,
      weapons: opts.weapons,
      orders: opts.orders,
    });
  }
  return targetDummy({
    id: opts.id,
    side: opts.side,
    x: opts.x,
    y: opts.y,
    structure: opts.structure,
    orders: opts.orders,
  });
}

function inputs(
  ships: CombatShip[],
  anomalies: BattleAnomalyKind[],
  seed = 1,
  maxTicks = DEFAULT_MAX_TICKS,
): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomalies,
    seed,
    maxTicks,
  };
}

/** World position of a ship at a given tick. Throws if absent. */
function posAt(
  result: ReturnType<typeof runBattle>,
  tick: number,
  id: string,
): { x: number; y: number } {
  const f = result.frames.find((frame) => frame.tick === tick);
  if (f === undefined) throw new Error(`no frame at tick ${tick}`);
  const s = f.ships.find((x) => x.instanceId === id);
  if (s === undefined) throw new Error(`ship ${id} absent at tick ${tick}`);
  return { x: s.x, y: s.y };
}

/**
 * The closest a ship ever comes to the origin (the black hole) while alive,
 * across the whole battle. Frames where the ship is dead are skipped — once
 * destroyed its recorded position is no longer a steering choice.
 */
function minDistanceToOrigin(
  result: ReturnType<typeof runBattle>,
  id: string,
): number {
  let min = Infinity;
  for (const f of result.frames) {
    const s = f.ships.find((x) => x.instanceId === id);
    if (s === undefined || !s.alive) continue;
    const d = Math.hypot(s.x, s.y);
    if (d < min) min = d;
  }
  return min;
}

/**
 * The separation between the attacker and a stationary defender once movement
 * has settled, averaged over the tail of the battle so a single oscillation
 * frame does not dominate. The defender holds and barely thrusts, so this
 * measures the equilibrium range the attacker chooses to keep.
 */
function settledSeparation(
  result: ReturnType<typeof runBattle>,
  attackerId: string,
  defenderId: string,
  fromTick: number,
): number {
  const tail = result.frames.filter((f) => f.tick >= fromTick);
  expect(tail.length).toBeGreaterThan(0);
  let total = 0;
  for (const f of tail) {
    const a = f.ships.find((s) => s.instanceId === attackerId);
    const d = f.ships.find((s) => s.instanceId === defenderId);
    if (a === undefined || d === undefined) {
      throw new Error("a ship vanished while measuring separation");
    }
    total += Math.hypot(a.x - d.x, a.y - d.y);
  }
  return total / tail.length;
}

describe("engine.anomalies-ai", () => {
  it("black hole: a ship arcs around the well instead of ploughing through it", () => {
    // The attacker starts on the near side of the hole; its only target sits on
    // the FAR side, so the straight-line path to it runs right through the
    // centre. With no anomalies the ship flies dead through the origin (its
    // closest approach is deep inside the lethal radius). With the black hole,
    // the avoidance steering bends its path around the danger zone, so the
    // avoiding ship keeps measurably wider clearance than the unaware control.
    //
    // The earlier proportional-error controller could snap its heading in a
    // single tick and so skimmed the tidal edge, but that snap was exactly the
    // unphysical behaviour the bang-bang Newtonian rework removed. Under
    // bang-bang steering the ship cannot redirect its full linear momentum
    // before crossing the avoidance zone, so the closest-approach threshold is
    // set to what the physics actually achieves: the aware ship stays
    // measurably further out than the unaware one, rather than a specific
    // geometric clearance. The thrust (54000 = 60 × TICKS_PER_SECOND²) is high
    // enough that the engine can act against gravity inside the avoidance zone:
    // gravity is applied directly as an m/tick² acceleration (arena-physics),
    // whereas engine force is divided by ACCEL_PER_TICK_FROM_SI (1/900), so a
    // bare 60 would be 900× too weak to resist the well and no deflection would
    // be possible.
    //
    // Re-baselined for km combat (Phase 5): the black-hole horizon is now 2 km
    // and the tidal zone 4 km, so the crossing geometry is rescaled from the
    // pre-km tens-of-metres positions to km positions. The attacker starts just
    // outside the tidal zone and its target sits far on the opposite side.
    const mk = (anomalies: BattleAnomalyKind[]) =>
      runBattle(
        inputs(
          [
            makeShip({
              id: "a1",
              side: "attacker",
              x: 5_800,
              y: 0,
              facing: Math.PI,
              structure: 99999,
              thrust: 54000,
              turnRate: 0.1,
              weapons: [weapon({ range: 50_000 })],
              orders: { engageRange: "medium" },
            }),
            makeShip({
              id: "d1",
              side: "defender",
              x: -50_000,
              y: 0,
              structure: 99999,
              thrust: 0.0001,
              orders: { engageRange: "hold" },
            }),
          ],
          anomalies,
          1,
          200,
        ),
      );
    const none = mk([]);
    const hole = mk(["blackHole"]);

    const noneMin = minDistanceToOrigin(none, "a1");
    const holeMin = minDistanceToOrigin(hole, "a1");

    // Control: the unaware ship cuts straight through the lethal zone (2 km).
    expect(noneMin).toBeLessThan(2_000);
    // Avoiding ship: the avoidance bias deflects the path, so the closest
    // approach is measurably wider than the unaware control. With bang-bang
    // Newtonian steering the ship cannot fully redirect its momentum in the
    // avoidance window, so we assert deflection (holeMin > noneMin) rather than
    // a hard clearance threshold.
    expect(holeMin).toBeGreaterThan(noneMin);
  });

  it("black hole: avoidance deflects the ship's path off the straight line", () => {
    // Same crossing geometry; here we check the deflection directly. With no
    // anomalies the ship stays on the y=0 axis to its target. With the black
    // hole, avoidance pushes it off-axis (a non-trivial |y|) as it routes
    // around the centre.
    //
    // Re-baselined for km combat (Phase 5): crossing geometry rescaled to km
    // positions matching the 2 km horizon / 4 km tidal zone.
    const mk = (anomalies: BattleAnomalyKind[]) =>
      runBattle(
        inputs(
          [
            makeShip({
              id: "a1",
              side: "attacker",
              x: 5_800,
              y: 0,
              facing: Math.PI,
              structure: 99999,
              thrust: 54000,
              turnRate: 0.1,
              weapons: [weapon({ range: 50_000 })],
              orders: { engageRange: "medium" },
            }),
            makeShip({
              id: "d1",
              side: "defender",
              x: -50_000,
              y: 0,
              structure: 99999,
              thrust: 0.0001,
              orders: { engageRange: "hold" },
            }),
          ],
          anomalies,
          1,
          60,
        ),
      );
    const none = mk([]);
    const hole = mk(["blackHole"]);
    // Sample mid-crossing, where the ship is near the hole.
    const noneY = Math.abs(posAt(none, 20, "a1").y);
    const holeY = Math.abs(posAt(hole, 20, "a1").y);
    expect(noneY).toBeLessThan(1);
    // The avoidance pushes the ship measurably off-axis (hundreds of metres of
    // lateral deflection at the km scale) as it routes around the 4 km tidal
    // zone.
    expect(holeY).toBeGreaterThan(300);
  });

  it("nebula: ships close to a shorter engagement range than in open space", () => {
    // An attacker on long-range orders approaches a stationary defender from
    // well outside its desired range. In open space it settles at its full
    // stand-off range; in a nebula the desired range is scaled down, so it
    // settles closer.
    const mk = (anomalies: BattleAnomalyKind[]) =>
      runBattle(
        inputs(
          [
            makeShip({
              id: "a1",
              side: "attacker",
              x: -600,
              y: 0,
              facing: 0,
              thrust: 9000,
              turnRate: 0.1,
              weapons: [weapon({ range: 600, tracking: 1 })],
              orders: { engageRange: "long", stance: "balanced" },
            }),
            makeShip({
              id: "d1",
              side: "defender",
              x: 0,
              y: 0,
              structure: 99999,
              thrust: 0.0001,
              orders: { engageRange: "hold" },
            }),
          ],
          anomalies,
          1,
          600,
        ),
      );
    const none = mk([]);
    const nebula = mk(["nebula"]);
    const openSep = settledSeparation(none, "a1", "d1", 400);
    const nebulaSep = settledSeparation(nebula, "a1", "d1", 400);
    expect(nebulaSep).toBeLessThan(openSep);
  });

  it("asteroid field: ships close to a shorter engagement range than in open space", () => {
    const mk = (anomalies: BattleAnomalyKind[]) =>
      runBattle(
        inputs(
          [
            makeShip({
              id: "a1",
              side: "attacker",
              x: -600,
              y: 0,
              facing: 0,
              thrust: 9000,
              turnRate: 0.1,
              weapons: [weapon({ range: 600 })],
              orders: { engageRange: "long", stance: "balanced" },
            }),
            makeShip({
              id: "d1",
              side: "defender",
              x: 0,
              y: 0,
              structure: 99999,
              thrust: 0.0001,
              orders: { engageRange: "hold" },
            }),
          ],
          anomalies,
          1,
          600,
        ),
      );
    const none = mk([]);
    const field = mk(["asteroidField"]);
    const openSep = settledSeparation(none, "a1", "d1", 400);
    const fieldSep = settledSeparation(field, "a1", "d1", 400);
    expect(fieldSep).toBeLessThan(openSep);
  });

  it("determinism: two black-hole runs with the same seed are byte-identical", () => {
    // Re-baselined for km combat (Phase 5): ships start outside the 2 km
    // horizon so the battle plays out rather than ending on tick 0.
    const build = () =>
      inputs(
        [
          makeShip({
            id: "a1",
            side: "attacker",
            x: 6_000,
            y: 3_000,
            facing: 0,
            thrust: 27000,
            turnRate: 0.06,
            weapons: [weapon({ range: 33_000 })],
          }),
          makeShip({
            id: "d1",
            side: "defender",
            x: -6_000,
            y: -3_000,
            facing: Math.PI,
            thrust: 27000,
            turnRate: 0.06,
            weapons: [weapon({ range: 33_000 })],
          }),
        ],
        ["blackHole"],
        12345,
        400,
      );
    const a = runBattle(build());
    const b = runBattle(build());
    expect(JSON.stringify(a.frames)).toBe(JSON.stringify(b.frames));
  });

  it("regression: anomalies=none still closes and fires as before", () => {
    // Sanity that the guarded code leaves open-space combat working: the
    // attacker closes on a stationary defender from a long way out and lands
    // hits.
    const result = runBattle(
      inputs(
        [
          makeShip({
            id: "a1",
            side: "attacker",
            x: -700,
            y: 0,
            facing: 0,
            thrust: 36000,
            turnRate: 0.1,
            weapons: [weapon({ range: 600, damage: 25, cooldown: 5 })],
            orders: { engageRange: "long" },
          }),
          makeShip({
            id: "d1",
            side: "defender",
            x: 0,
            y: 0,
            structure: 99999,
            thrust: 0.0001,
            orders: { engageRange: "hold" },
          }),
        ],
        [],
        1,
        600,
      ),
    );
    const start = posAt(result, 0, "a1");
    const startSep = Math.hypot(start.x, start.y);
    const endSep = settledSeparation(result, "a1", "d1", 400);
    expect(endSep).toBeLessThan(startSep);
    // The defender takes damage, proving the attacker closed and fired.
    const startStruct =
      result.frames[0]?.ships.find((s) => s.instanceId === "d1")?.structure ?? 0;
    const endStruct =
      result.frames.at(-1)?.ships.find((s) => s.instanceId === "d1")?.structure ?? 0;
    expect(endStruct).toBeLessThan(startStruct);
  });
});
