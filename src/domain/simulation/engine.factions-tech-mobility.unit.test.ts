import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import {
  baseStats,
  beam,
  commandModule,
  inputs,
  moduleOf,
  shipAt,
} from "./engine.factions-tech-helpers";

// ---------------------------------------------------------------------------
// Blink drive
// ---------------------------------------------------------------------------

describe("engine.factions-tech – blink (tactical)", () => {
  /**
   * Setup: aggressive attacker with a tactical blink drive, facing the enemy.
   * The drive has cooldown=0 so it fires on tick 1 before movement. The enemy
   * is 500 units away; the blink range is 200, so the attacker should jump
   * 200 units toward the enemy — meaning its x should be near 200 by tick 1.
   */
  function blinkAttacker(withBlink: boolean): CombatShip {
    const modules: ResolvedModule[] = [
      moduleOf("p1", { kind: "power", output: 100 }, 0, 0, 50, 5, 0),
      // Engine: exhaust aft (facing π) → thrust forward (+x toward enemy at +x)
      moduleOf("e1", { kind: "engine", thrust: 0.8, facing: Math.PI }, 1, 0, 50, 5, 0),
      moduleOf("w1", beam({ damage: 5, range: 400 }), -1, 0, 50, 5, 0),
      // All-round sensor so the attacker acquires the enemy (fog-of-war
      // awareness) — blink jumps toward ship.target, which needs a target.
      moduleOf(
        "snr",
        { kind: "sensor", sensorType: "omni", arc: Math.PI, bearing: 0, detectionRange: 2000, nebulaImmune: false },
        2,
        1,
        50,
        5,
        0,
      ),
      // Command module required for the per-module firing path
      commandModule(0, -1),
    ];
    if (withBlink) {
      modules.push(
        moduleOf(
          "bk1",
          {
            kind: "blink",
            mode: "tactical",
            jumpRange: 200,
            cooldown: 30,
          },
          0,
          1,
          50,
          5,
          0,
        ),
      );
    }
    return {
      instanceId: "attacker",
      designId: "d-attacker",
      faction: "test",
      side: "attacker",
      // stats.thrust = hull base + engine thrust. Engine = 0.8, hull base = 0.
      stats: baseStats({ thrust: 0.8, turnRate: 0.15, weapons: [{ slotId: "w1", effect: beam({ damage: 5, range: 400 }) }] }),
      position: { x: 0, y: 0 },
      facing: 0,
      orders: { ...defaultOrders, stance: "aggressive" },
      classification: "frigate",
      modules,
    };
  }

  function staticDefender(): CombatShip {
    return {
      instanceId: "defender",
      designId: "d-defender",
      faction: "test",
      side: "defender",
      stats: baseStats({ structure: 99999, weapons: [] }),
      position: { x: 500, y: 0 },
      facing: Math.PI,
      orders: { ...defaultOrders, engageRange: "hold" },
      classification: "frigate",
    };
  }

  it("an aggressive ship with a blink drive jumps toward its target", () => {
    const result = runBattle(inputs([blinkAttacker(true), staticDefender()], 10));
    // Frame 0 is deployment: attacker at x=0. After tick 1 (step 1b fires blink
    // before movement) the attacker should have jumped forward significantly.
    const t0 = shipAt(result, 0, "attacker");
    const t1 = shipAt(result, 1, "attacker");
    expect(t0.x).toBe(0);
    // The blink range is 200; the enemy is at 500 so the attacker should jump
    // ~200 units toward +x (exact value depends on movement that same tick, but
    // it must be well beyond what thrust alone can achieve in one tick).
    expect(t1.x).toBeGreaterThan(100);
  });

  it("without the blink drive the attacker does NOT jump", () => {
    const result = runBattle(inputs([blinkAttacker(false), staticDefender()], 10));
    const t0 = shipAt(result, 0, "attacker");
    const t1 = shipAt(result, 1, "attacker");
    expect(t0.x).toBe(0);
    // Pure thrust from rest for one tick on a 10+hull mass ship is tiny
    expect(t1.x).toBeLessThan(5);
  });

  it("with blink drive, jumps much further than without over first few ticks", () => {
    const withBlink = runBattle(inputs([blinkAttacker(true), staticDefender()], 5));
    const without = runBattle(inputs([blinkAttacker(false), staticDefender()], 5));
    const blinkX = shipAt(withBlink, 1, "attacker").x;
    const thrustX = shipAt(without, 1, "attacker").x;
    expect(blinkX).toBeGreaterThan(thrustX + 100);
  });
});

describe("engine.factions-tech – blink (escape)", () => {
  /**
   * Escape blink: fires when structure fraction ≤ escapeThreshold.
   * We put a heavily wounded attacker (5% structure left) with an escape blink
   * and a single nearby enemy. The drive should jump the ship away.
   */
  function nearEnemy(): CombatShip {
    return {
      instanceId: "pursuer",
      designId: "d-pursuer",
      faction: "test",
      side: "defender",
      stats: baseStats({ structure: 99999, weapons: [{ slotId: "w1", effect: beam({ damage: 1 }) }] }),
      position: { x: 100, y: 0 },
      facing: Math.PI,
      orders: { ...defaultOrders, engageRange: "hold" },
      classification: "frigate",
    };
  }

  it("a ship below the escape threshold jumps away from enemies on tick 1", () => {
    // `escapeThreshold: 1.0` means "always in escape condition regardless of
    // current structure" — any structure fraction ≤ 1.0 triggers the jump.
    // This avoids the need to pre-damage the ship (CombatShip initialises
    // structure = stats.structure = maxStructure, so fraction is always 1.0
    // at the start; we can't set structure < maxStructure via the input type).
    const modules: ResolvedModule[] = [
      moduleOf("p1", { kind: "power", output: 100 }, 0, 0, 50, 5, 0),
      moduleOf("e1", { kind: "engine", thrust: 0.5 }, 1, 0, 50, 5, 0),
      moduleOf(
        "bk1",
        {
          kind: "blink",
          mode: "escape",
          jumpRange: 300,
          cooldown: 50,
          escapeThreshold: 1.0, // always-escape: any structure level triggers it
        },
        0,
        1,
        50,
        5,
        0,
      ),
    ];
    const alwaysEscaper: CombatShip = {
      instanceId: "escaper",
      designId: "d-escaper",
      faction: "test",
      side: "attacker",
      stats: baseStats({ structure: 100, thrust: 0.5, turnRate: 0.1, weapons: [] }),
      position: { x: 0, y: 0 },
      facing: 0,
      orders: { ...defaultOrders, engageRange: "hold" },
      classification: "frigate",
      modules,
    };
    const result = runBattle(inputs([alwaysEscaper, nearEnemy()], 5));
    const t0 = shipAt(result, 0, "escaper");
    const t1 = shipAt(result, 1, "escaper");
    expect(t0.x).toBe(0);
    // The escaper jumps 300 units away from the enemy at x=100.
    // Direction away from enemy (at +x) = -x. So escaper lands around x=-300.
    expect(t1.x).toBeLessThan(-200);
  });

  it("a ship above the escape threshold does NOT jump", () => {
    // escapeThreshold=0.1 (10%). Ship starts at structure=200 (=maxStructure=200),
    // so fraction=1.0 > 0.1: escape blink does not fire.
    const modules: ResolvedModule[] = [
      moduleOf("p1", { kind: "power", output: 100 }, 0, 0, 50, 5, 0),
      moduleOf("e1", { kind: "engine", thrust: 0.5 }, 1, 0, 50, 5, 0),
      moduleOf(
        "bk1",
        {
          kind: "blink",
          mode: "escape",
          jumpRange: 300,
          cooldown: 50,
          escapeThreshold: 0.1,
        },
        0,
        1,
        50,
        5,
        0,
      ),
    ];
    const healthyShip: CombatShip = {
      instanceId: "escaper",
      designId: "d-escaper",
      faction: "test",
      side: "attacker",
      stats: baseStats({ structure: 200, thrust: 0.5, turnRate: 0.1, weapons: [] }),
      position: { x: 0, y: 0 },
      facing: 0,
      orders: { ...defaultOrders, engageRange: "hold" },
      classification: "frigate",
      modules,
    };
    const result = runBattle(inputs([healthyShip, nearEnemy()], 5));
    const t1 = shipAt(result, 1, "escaper");
    // Should NOT have jumped 300 units; position stays near origin (small thrust only)
    expect(Math.abs(t1.x)).toBeLessThan(20);
  });
});

// ---------------------------------------------------------------------------
// Afterburner
// ---------------------------------------------------------------------------

describe("engine.factions-tech – afterburner", () => {
  /**
   * Attacker closing on a distant enemy, with or without an afterburner.
   *
   * Engine facing convention: `facing` is the exhaust direction. A rear engine
   * (exhaust aft, facing = π) thrusts the ship forward (+x). We set
   * `facing: Math.PI` so the engine drives the ship toward the +x enemy.
   */
  function closingShip(withAfterburner: boolean): CombatShip {
    const modules: ResolvedModule[] = [
      moduleOf("p1", { kind: "power", output: 100 }, 0, 0, 50, 5, 0),
      // facing: Math.PI = exhaust aft → thrust forward (+x toward enemy at +x)
      moduleOf("e1", { kind: "engine", thrust: 1.0, facing: Math.PI }, 1, 0, 50, 5, 0),
      moduleOf("w1", beam({ damage: 5, range: 500 }), -1, 0, 50, 5, 0),
      commandModule(0, -1),
    ];
    if (withAfterburner) {
      modules.push(
        moduleOf(
          "ab1",
          {
            kind: "afterburner",
            thrustBoost: 3.0,
            turnBoost: 2.0,
            duration: 10,
            cooldown: 30,
          },
          0,
          1,
          50,
          5,
          0,
        ),
      );
    }
    return {
      instanceId: "attacker",
      designId: "d-attacker",
      faction: "test",
      side: "attacker",
      // hull thrust reflects the engine: stats.thrust = hull base + engine.thrust.
      // hullBaseThrust = stats.thrust − sum(engine thrust) in toSimShip.
      // Setting stats.thrust = 1.0 (the engine alone; hull base = 0) is correct.
      stats: baseStats({ thrust: 1.0, turnRate: 0.1, weapons: [{ slotId: "w1", effect: beam({ damage: 5, range: 500 }) }] }),
      position: { x: 0, y: 0 },
      facing: 0,
      orders: { ...defaultOrders, stance: "aggressive" },
      classification: "frigate",
      modules,
    };
  }

  function distantDefender(): CombatShip {
    return {
      instanceId: "defender",
      designId: "d-defender",
      faction: "test",
      side: "defender",
      stats: baseStats({ structure: 99999, weapons: [] }),
      position: { x: 600, y: 0 },
      facing: Math.PI,
      orders: { ...defaultOrders, engageRange: "hold" },
      classification: "frigate",
    };
  }

  it("a ship with an afterburner reaches the engagement range faster than one without", () => {
    // The afterburner ship (3× thrust boost for 10 ticks) closes toward the
    // defender much faster than the un-boosted ship. Both ships begin at x=0
    // and close toward the enemy at x=600; after 80 ticks neither has fully
    // crossed 600 units, but the afterburner ship has covered noticeably more
    // ground. We assert the positional lead at tick 80.
    const withAB = runBattle(inputs([closingShip(true), distantDefender()], 80));
    const without = runBattle(inputs([closingShip(false), distantDefender()], 80));

    const abX = shipAt(withAB, 80, "attacker").x;
    const noAbX = shipAt(without, 80, "attacker").x;

    // The afterburner ship should be at least 20 units ahead after 80 ticks.
    // Measured: AB≈117, noAB≈82, difference≈36 — so 20 is a comfortable margin.
    expect(abX).toBeGreaterThan(noAbX + 20);
  });

  it("without an afterburner the attacker is slower in the first few ticks", () => {
    // With a 3× boost for 10 ticks, at tick 5 the afterburner ship should have
    // greater speed (vx) toward the enemy than the un-boosted ship, which only
    // ever applies 1× thrust. We compare their vx at a tick while both are
    // still closing (before the afterburner ship overshoots the range).
    const without = runBattle(inputs([closingShip(false), distantDefender()], 8));
    const withAB = runBattle(inputs([closingShip(true), distantDefender()], 8));

    // At tick 4, both ships are closing. Check the afterburner ship has higher vx.
    // Measured: AB vx≈0.445, noAB vx≈0.185 — difference≈0.26, so 0.1 is a
    // comfortable threshold that proves the afterburner is accelerating the ship.
    const abState = shipAt(withAB, 4, "attacker");
    const noAbState = shipAt(without, 4, "attacker");
    expect(abState.vx ?? 0).toBeGreaterThan((noAbState.vx ?? 0) + 0.1);
  });
});
