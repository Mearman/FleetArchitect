import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import type { CombatShip, BattleInputs } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ShipClassification } from "@/schema/armor";
import type { WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Sonnet-tier: the AI movement modes in moveShips — closing, in-range
 * hold, the kiting reverse-thrust when too close, retreating, and the
 * explicit `hold` orders stance. Each test isolates one mode by placing
 * the attacker and defender in a position that triggers exactly that
 * branch, and asserts the expected facing / position / velocity.
 *
 * Helper duplicated so this file is self-contained.
 */

function weapon(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 5,
    range: 300,
    cooldown: 10,
    projectileSpeed: 0,
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
  weapons?: WeaponEffect[];
  classification?: ShipClassification;
  orders?: Partial<typeof defaultOrders>;
}): CombatShip {
  const weapons = opts.weapons ?? [];
  const stats: ShipStats = {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: opts.structure ?? 100,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 1,
    shieldRechargeDelay: 30,
    thrust: 0.5,
    turnRate: 0.1,
    weapons: weapons.map((w) => ({ slotId: `slot-${opts.id}`, effect: w })),
    // These tests exercise the movement bands (close / hold / kite / retreat),
    // which require the ship to have acquired its target at the band's range.
    // The ships are fully sensor-equipped so detection isn't the variable under
    // test; fog of war is covered by the awareness suite.
    compartments: 0,
  airtightCompartments: 0,
};
  return {
    instanceId: opts.id,
    designId: `design-${opts.id}`,
    faction: "test",
    side: opts.side,
    stats,
    position: { x: opts.x, y: opts.y },
    facing: opts.facing ?? 0,
    orders: { ...defaultOrders, ...opts.orders },
    classification: (opts.classification ?? "frigate"),
  };
}

function inputs(ships: CombatShip[]): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomaly: "none",
    seed: 1,
    // These tests sample movement state by tick 80 at the latest; a short cap
    // keeps them fast (the tanky 99999-structure defender never resolves the
    // battle, so without a cap it would otherwise run the full DEFAULT_MAX_TICKS).
    maxTicks: 120,
  };
}

function attackerAt(result: ReturnType<typeof runBattle>, tick: number, id: string) {
  const f = result.frames.find((frame) => frame.tick === tick);
  if (f === undefined) throw new Error(`no frame at tick ${tick}`);
  const s = f.ships.find((ship) => ship.instanceId === id);
  if (s === undefined) throw new Error(`attacker ${id} missing in frame ${tick}`);
  return s;
}

describe("engine.movement-modes", () => {
  it("closing: a far attacker accelerates toward the target", () => {
    // With weapon range 300 and medium/balanced, want ≈ 165 (outer edge of the
    // at-range band). Place the defender at x=300 (well beyond want).
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          facing: 0,
          weapons: [weapon()],
        }),
        makeShip({ id: "d1", side: "defender", x: 300, y: 0, structure: 99999 }),
      ]),
    );
    // After 30 ticks the attacker should have moved noticeably toward +x.
    expect(attackerAt(result, 30, "a1").x).toBeGreaterThan(5);
  });

  it("in-range band: the attacker holds position and aims at the target", () => {
    // want ≈ 165 (range 300 * medium fraction 0.55). With defaultOrders
    // rangeKeepingBand=0.3, the at-range zone is [want*(1-0.3), want]
    // = [115.5, 165]. Place the defender at x=140 (inside the dead-zone).
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          facing: 0,
          weapons: [weapon()],
        }),
        makeShip({ id: "d1", side: "defender", x: 140, y: 0, structure: 99999 }),
      ]),
    );
    // In the band, shouldThrust=false → velocity decays to ~0, so position
    // barely moves. We give it a generous tolerance.
    expect(Math.abs(attackerAt(result, 60, "a1").x)).toBeLessThan(5);
  });

  it("too close: the attacker faces the target and reverse-thrusts (kite)", () => {
    // want ≈ 165, too-close threshold = want*(1−band) ≈ 115.5. Place the
    // defender at x=50 (well inside the reverse-thrust zone).
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          facing: 0,
          weapons: [weapon()],
        }),
        makeShip({ id: "d1", side: "defender", x: 50, y: 0, structure: 99999 }),
      ]),
    );
    const late = attackerAt(result, 80, "a1");
    // Facing the target (≈ 0, toward +x).
    expect(late.facing ?? 0).toBeLessThan(0.3);
    // Velocity is negative — moving away from the defender at +x.
    expect(late.vx ?? 0).toBeLessThan(-0.05);
  });

  it("hold orders: the attacker pins in place and faces the target", () => {
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          facing: 0,
          weapons: [weapon()],
          orders: { engageRange: "hold" },
        }),
        makeShip({ id: "d1", side: "defender", x: 200, y: 0, structure: 99999 }),
      ]),
    );
    // Hold → shouldThrust=false → no positional drift.
    expect(Math.abs(attackerAt(result, 60, "a1").x)).toBeLessThan(1);
    expect(Math.abs(attackerAt(result, 60, "a1").y)).toBeLessThan(1);
  });

  it("retreating: a damaged attacker faces away and flees", () => {
    // The defender hits the attacker enough to drop structure below the
    // retreatThreshold but leaves it alive (two hits of 40 from 100 → 20),
    // then we assert the attacker orients away and flees.
    // The 130 wu separation is within the innate visual radius so both ships
    // detect each other from tick 0 without a sensor module — the test is
    // about the retreat manoeuvre, not detection.
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          weapons: [weapon({ damage: 1, range: 600, cooldown: 20 })],
          orders: { retreatThreshold: 0.5 },
        }),
        makeShip({
          id: "d1",
          side: "defender",
          x: 0,
          y: 130,
          structure: 99999,
          // One big hit (100 → 40, below the 0.5 threshold) with a cooldown
          // long enough that no second shot lands during the sample window, so
          // the attacker stays alive and visibly retreating. (A second hit at
          // ~40 ticks would kill it mid-turn before the now-realistic, slower
          // rotation has swung it around and carried it clear.)
          weapons: [weapon({ damage: 60, range: 400, cooldown: 400 })],
          orders: { engageRange: "hold" },
        }),
      ]),
    );
    // Once structure/100 < 0.5 the attacker should be retreating; find that
    // point and assert the facing is away from the defender.
    const frames = result.frames;
    let retreatTick: number | undefined;
    for (const f of frames) {
      const a = f.ships.find((s) => s.instanceId === "a1");
      if (a?.alive === true && a.structure < 50) {
        retreatTick = f.tick;
        break;
      }
    }
    expect(retreatTick, "attacker should be damaged below retreat threshold").toBeDefined();
    if (retreatTick === undefined) return;
    // After retreating, sample a later frame: the facing should point into
    // the lower half-plane (fleeing the defender at +y) and the y-coordinate
    // should drop below 0. The window allows for the realistic rate-limited
    // turn: caught mid-turn toward the enemy when hit, the ship must first
    // bleed off that spin (drifting +y a little) before its heading swings to
    // -π/2 and it accelerates clear — it recrosses y=0 around +40 ticks.
    const later = attackerAt(result, retreatTick + 40, "a1");
    expect(Math.sin(later.facing ?? 0)).toBeLessThan(0);
    expect(later.y).toBeLessThan(0);
  });
});
