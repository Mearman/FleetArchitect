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
      // Engine force is a catalogue Newton figure: movement.ts converts F/m
      // (m/s²) into the m/tick² velocity clock by ACCEL_PER_TICK_FROM_SI
      // (1/TICKS_PER_SECOND² = 1/900). This synthetic thrust is sized so the
      // resulting per-tick acceleration matches the controller dynamics these
      // tests were calibrated against (the legacy direct-add 0.5 × 900).
      thrust: 450,
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

  it("in-range band: the attacker station-keeps at want range", () => {
    // want ≈ 165 (range 300 * medium fraction 0.55). With defaultOrders
    // rangeKeepingBand=0.3, the at-range zone is [want*(1-0.3), want]
    // = [115.5, 165]. Place the defender at x=140 (inside the band).
    //
    // The station-keeper (stationKeep PD controller) actively drives the
    // attacker to the want distance of 165 m from the defender. Starting
    // at x=0 with the defender at x=140, the attacker manoeuvres toward
    // x ≈ 140 - 165 = -25 so that the separation reaches want. After 60+
    // ticks the attacker should be noticeably west of the origin, and at
    // 100+ ticks it should be close to the target x≈-25.
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
    // The station-keeper moves the attacker toward want range: x should
    // be negative (attacker backing away from the near defender) and
    // the final separation should be close to want (165 m).
    const latePos = attackerAt(result, 100, "a1");
    expect(latePos.x).toBeLessThan(0);
    const separation = Math.abs(140 - latePos.x);
    expect(separation).toBeGreaterThan(140); // moved beyond the start separation of 140
    expect(separation).toBeLessThan(200); // didn't overshoot dramatically
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

  it("retreating: a damaged attacker faces away and flees", () => {
    // The defender chips the attacker just past its retreat threshold but leaves
    // it alive, then we assert the attacker orients away and flees.
    //
    // Retreat threshold is 0.85, NOT 0.5: under the modular damage model a hit
    // depletes the struck cells' HP and spills to hull structure only when a
    // cell is destroyed, so combined HP (structure + module HP) tracks the
    // ship's alive-cell mass. By the time a modular ship has lost half its
    // combined HP it has lost half its cells — which means its core has been
    // shot away and it is structurally dead (no command / severed graph), so a
    // 0.5 threshold is never crossed while the ship is alive: the crossing IS
    // the death. A combat-effectiveness threshold near the top of the HP band
    // (retreat after shedding ~15%) fires while the ship is still whole and
    // manoeuvrable, which is the point being tested — the retreat manoeuvre,
    // not the death throes.
    //
    // The 130 wu separation is within the innate visual radius so both ships
    // detect each other from tick 0 without a sensor module — the test is about
    // the retreat manoeuvre, not detection.
    const retreatThreshold = 0.85;
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          weapons: [weapon({ damage: 1, range: 600, cooldown: 20 })],
          orders: { retreatThreshold },
        }),
        makeShip({
          id: "d1",
          side: "defender",
          x: 0,
          y: 130,
          structure: 99999,
          // A hit drops the attacker past the 0.85 threshold early (the 15-tick
          // cooldown keeps the first shot inside the short sample window); once
          // retreating the attacker accelerates clear and outruns further
          // damage, so it stays alive and visibly fleeing.
          weapons: [weapon({ damage: 35, range: 400, cooldown: 15 })],
          orders: { engageRange: "hold" },
        }),
      ]),
    );
    // Find when the attacker's effective HP fraction (structure + module HP)
    // first drops below its retreat threshold — the tick the retreat manoeuvre
    // engages. The baseline is the initial total HP (at tick 0 everything is
    // undamaged, so that IS the max).
    const f0 = result.frames[0];
    const a0 = f0?.ships.find((s) => s.instanceId === "a1");
    const initialHp = (a0?.structure ?? 0) + (a0?.cells ?? []).reduce((sum, m) => sum + (m.hp ?? 0), 0);
    let retreatTick: number | undefined;
    for (const frame of result.frames) {
      const ship = frame.ships.find((s) => s.instanceId === "a1");
      if (ship?.alive !== true) continue;
      const hp = (ship.structure ?? 0) + (ship.cells ?? []).reduce((sum, m) => sum + (m.hp ?? 0), 0);
      if (initialHp > 0 && hp / initialHp < retreatThreshold) {
        retreatTick = frame.tick;
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
