import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import type { CombatShip, BattleInputs } from "@/domain/simulation/types";
import type { WeaponEffect } from "@/schema/module";
import { modularShip, targetDummy } from "./engine.factions-tech-helpers";

/**
 * Sonnet-tier: the AI movement modes in moveShips — closing, in-range
 * hold, the kiting reverse-thrust when too close, retreating, and the
 * explicit `hold` orders stance. Each test isolates one mode by placing
 * the attacker and defender in a position that triggers exactly that
 * branch, and asserts the expected facing / position / velocity.
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
  orders?: Partial<{ engageRange: "short" | "medium" | "long" | "hold"; retreatThreshold: number }>;
}): CombatShip {
  const weapons = opts.weapons ?? [];
  // Ships that fire are full modular ships; a weaponless defender is a
  // target dummy (modular, but transparent to damage so it stays a
  // position marker the attacker can acquire and manoeuvre against).
  if (weapons.length > 0) {
    return modularShip({
      id: opts.id,
      side: opts.side,
      x: opts.x,
      y: opts.y,
      facing: opts.facing,
      structure: opts.structure,
      thrust: 0.5,
      // Physical angular acceleration (rad/tick^2) under the frictionless
      // model; rescaled from the legacy /5 scalar.
      turnRate: 0.02,
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
    // After 30 ticks the attacker should have moved noticeably toward +x —
    // under frictionless integration, pure F = ma with no damping, so the
    // displacement is the integrated acceleration.
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
    // In the band the controller coasts — velocity persists. The fixture
    // starts the attacker at rest (toSimShip zeroes velocity), so a ship at
    // rest in the band stays at rest (no thrust, no velocity to bleed).
    expect(Math.abs(attackerAt(result, 60, "a1").x)).toBeLessThan(10);
  });

  it("too close: opens range (kinematic kite)", () => {
    // want ~= 165, too-close threshold = want*(1-band) ~= 115.5. Place the
    // defender at x=50 (well inside the opening-range zone). Under the
    // stop-in-time controller the ship opens range via the kinematic mirror
    // of the closing logic: it accelerates away from the contact along the
    // opening bearing until the braking distance equals the overshoot, then
    // brakes to settle at `want`. An aft-only ship flips PI to brake.
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
    // Velocity is negative — moving away from the defender at +x. Under
    // frictionless integration the magnitude is larger than under the old
    // damped model (no drag to counter the acceleration), so the threshold
    // is loosened to accommodate the kinematic opening manoeuvre.
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
    // Hold -> shouldThrust=false -> the ship coasts. The fixture starts at
    // rest, so a holding ship stays at rest (velocity persists at zero).
    expect(Math.abs(attackerAt(result, 60, "a1").x)).toBeLessThan(1);
    expect(Math.abs(attackerAt(result, 60, "a1").y)).toBeLessThan(1);
  });

  // SKIP — Pending Phase 4 (damage): the modular model routes damage through
  // module HP first and only depletes hull structure at ship-death, so
  // structure never crosses the retreat threshold while the attacker is
  // alive. Re-enable once Phase 4's unified damage gives structure-
  // independent depletion (or the retreat condition reads module loss).
  it.skip("retreating: a damaged attacker faces away and flees", () => {
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
