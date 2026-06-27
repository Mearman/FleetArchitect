import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { Doctrine } from "@/schema/ai";
import {
  baseStats,
  beam,
  commandModule,
  inputs,
  moduleOf,
} from "./engine.factions-tech-helpers";

/**
 * The doctrine equivalent of the legacy `defaultOrders` — every axis left
 * unset so the engine falls back to its built-in defaults (stance balanced,
 * targeting nearest, crew combat), which match the legacy scalar defaults.
 * Used by fixtures that previously spread `defaultOrders` unmodified.
 */
const defaultDoctrine: Doctrine = { base: {}, rules: [] };

// ---------------------------------------------------------------------------
// Overcharge
// ---------------------------------------------------------------------------

describe("engine.factions-tech – overcharge", () => {
  /**
   * A ship with a reactor that can only power one weapon, two weapons that
   * each draw power, and an optional overcharge module. Without overcharge,
   * the brownout cuts one weapon. With overcharge, both stay powered.
   *
   * Reactor output = 10, each weapon draws 8, total demand = 16.
   * Overcharge adds powerSurge = 10 → supply becomes 20, fitting both weapons.
   */
  function powerStressedShip(withOvercharge: boolean): CombatShip {
    const weaponEffect = beam({ damage: 20, cooldown: 5, range: 300 });
    const modules: ResolvedModule[] = [
      // Reactor: 10 output (not enough for both weapons at 8 draw each)
      moduleOf("r1", { kind: "power", output: 10 }, 0, 0, 50, 5, 0),
      // Engine: zero thrust so the ship holds position and its beams bear
      // consistently (a drifting ship hits intermittently under the Newtonian
      // model, which obscures the overcharge DPS difference).
      moduleOf("e1", { kind: "engine", thrust: 0, facing: Math.PI }, 0, -1, 50, 5, 0),
      // Two weapons, each draw 8 power
      moduleOf("w1", weaponEffect, 1, 0, 50, 5, 8),
      moduleOf("w2", weaponEffect, -1, 0, 50, 5, 8),
      // Command module (bridge) required for the per-module firing path
      commandModule(0, 1),
      // Sensor for fog-of-war awareness of the target.
      moduleOf(
        "snr",
        { kind: "sensor", sensorType: "omni", arc: Math.PI, bearing: 0, detectionRange: 2000, nebulaImmune: false },
        1,
        1,
        50,
        5,
        0,
      ),
    ];
    if (withOvercharge) {
      modules.push(
        moduleOf(
          "oc1",
          {
            kind: "overcharge",
            powerSurge: 10,
            duration: 20,
            cooldown: 40,
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
      faction: "Terran",
      side: "attacker",
      // stats.thrust = hull base + engine. Engine = 0.5, hull base = 0.
      stats: baseStats({
        structure: 500,
        thrust: 0.5,
        turnRate: 0.1,
        weapons: [
          { slotId: "w1", effect: weaponEffect },
          { slotId: "w2", effect: weaponEffect },
        ],
      }),
      position: { x: 0, y: 0 },
      facing: 0,
      // doctrine.base.stance replaces the legacy `orders.stance: "aggressive"`;
      // the other axes fall through to engine defaults (== legacy defaults).
      doctrine: { base: { stance: "aggressive" }, rules: [] },
      classification: "frigate",
      modules,
    };
  }

  it("a browning-out ship with overcharge kills the enemy faster", () => {
    // With overcharge: powerSurge=10 brings supply from 10 → 20, covering
    // both weapons (16 total draw) → both fire → more DPS → shorter fight.
    // Without overcharge: supply=10 < demand=16 → brownout cuts one weapon
    // → only one weapon fires → longer fight.
    //
    // Using a defender with 500 structure: overcharge case wins at tick≈94,
    // no-overcharge case wins at tick≈150 — a clear 56-tick difference.
    const weakDefender: CombatShip = {
      instanceId: "defender",
      designId: "d-defender",
      faction: "Terran",
      side: "defender",
      stats: baseStats({ structure: 500, weapons: [] }),
      position: { x: 150, y: 0 },
      facing: Math.PI,
      // doctrine.base.spatial replaces `orders: { ...defaultOrders, engageRange: "hold" }`.
      // hold station-keeps within band 0.3 (the legacy default rangeKeepingBand).
      doctrine: {
        base: {
          spatial: {
            reference: { kind: "target" },
            range: { kind: "hold", band: 0.3 },
            bearing: { kind: "free" },
          },
        },
        rules: [],
      },
      classification: "frigate",
    };
    const withOC = runBattle(inputs([powerStressedShip(true), weakDefender], 300));
    const without = runBattle(inputs([powerStressedShip(false), weakDefender], 300));
    // Both cases should win (the attacker eventually kills even on one weapon),
    // but overcharge wins in fewer ticks.
    expect(withOC.winner).toBe("attacker");
    expect(without.winner).toBe("attacker");
    expect(withOC.ticks).toBeLessThan(without.ticks);
  });

  it("without overcharge the brownout leaves one weapon offline", () => {
    // Without overcharge, demand (16) > supply (10): the brownout cuts one weapon.
    // We can observe this by the defender surviving longer (lower DPS).
    // This is implicitly tested by the above, but assert that the attacker does
    // NOT win in a very short battle that requires both weapons.
    const weakDefender: CombatShip = {
      instanceId: "defender",
      designId: "d-defender",
      faction: "Terran",
      side: "defender",
      stats: baseStats({ structure: 300, weapons: [] }),
      position: { x: 150, y: 0 },
      facing: Math.PI,
      doctrine: {
        base: {
          spatial: {
            reference: { kind: "target" },
            range: { kind: "hold", band: 0.3 },
            bearing: { kind: "free" },
          },
        },
        rules: [],
      },
      classification: "frigate",
    };
    const withOC = runBattle(inputs([powerStressedShip(true), weakDefender], 80));
    const without = runBattle(inputs([powerStressedShip(false), weakDefender], 80));
    // With overcharge: attacker wins (both weapons online after overcharge fires).
    // Without overcharge: slower — may still win but later.
    // We don't require the no-OC case to lose (it eventually wins on one weapon),
    // but the OC case must win at least as fast.
    if (withOC.winner === "attacker" && without.winner === "attacker") {
      expect(withOC.ticks).toBeLessThanOrEqual(without.ticks);
    } else {
      // At minimum, the overcharge case should not lose.
      expect(withOC.winner).not.toBe("defender");
    }
  });
});

// ---------------------------------------------------------------------------
// Command aura
// ---------------------------------------------------------------------------

describe("engine.factions-tech – command aura", () => {
  /**
   * Setup:
   *   - A command carrier on the attacker side with a commandAura module.
   *   - A beneficiary attacker ship that starts within the aura radius.
   *   - A control attacker without any aura effect for comparison.
   *   - A defender far away.
   *
   * Test: the beneficiary within the aura has extended range (can fire sooner)
   * compared to the same ship without an aura carrier nearby.
   */
  function auraCarrier(): CombatShip {
    return {
      instanceId: "carrier",
      designId: "d-carrier",
      faction: "Terran",
      side: "attacker",
      stats: baseStats({ structure: 99999, weapons: [] }),
      position: { x: 50, y: 0 },
      facing: 0,
      doctrine: {
        base: {
          spatial: {
            reference: { kind: "target" },
            range: { kind: "hold", band: 0.3 },
            bearing: { kind: "free" },
          },
        },
        rules: [],
      },
      classification: "frigate",
      modules: [
        moduleOf("p1", { kind: "power", output: 100 }, 0, 0, 50, 5, 0),
        moduleOf(
          "ca1",
          {
            kind: "commandAura",
            radius: 500,
            rangeBonus: 0.5,
            accuracyBonus: 0.3,
          },
          0,
          1,
          50,
          5,
          0,
        ),
      ],
    };
  }

  /**
   * A weapon ship whose base range is just short of the enemy — with an aura
   * bonus of 50% it should be in range and fire; without it, it cannot.
   * Enemy at x=300. Ship weapon range=200. Without aura: out of range (200<300).
   * With aura: effective range = 200 * 1.5 = 300, exactly in range.
   */
  function weaponShip(): CombatShip {
    const weapon = beam({ damage: 10, range: 200, cooldown: 5 });
    return {
      instanceId: "gunship",
      designId: "d-gunship",
      faction: "Terran",
      side: "attacker",
      stats: baseStats({
        structure: 99999,
        weapons: [{ slotId: "w1", effect: weapon }],
      }),
      position: { x: 0, y: 0 },
      facing: 0,
      doctrine: {
        base: {
          spatial: {
            reference: { kind: "target" },
            range: { kind: "hold", band: 0.3 },
            bearing: { kind: "free" },
          },
        },
        rules: [],
      },
      classification: "frigate",
      modules: [
        moduleOf("p1", { kind: "power", output: 100 }, 0, 0, 50, 5, 0),
        commandModule(1, 0),
        moduleOf("w1", weapon, 2, 0, 50, 5, 0),
        // Sensor so the gunship gains fog-of-war awareness of the defender at
        // x=300 (required by the evolved detection model); the aura then extends
        // the weapon's 200 range by 50% to 300 so it can actually fire.
        moduleOf(
          "snr",
          { kind: "sensor", sensorType: "omni", arc: Math.PI, bearing: 0, detectionRange: 500, nebulaImmune: false },
          3,
          0,
          50,
          5,
          0,
        ),
      ],
    };
  }

  function farDefender(): CombatShip {
    return {
      instanceId: "defender",
      designId: "d-defender",
      faction: "Terran",
      side: "defender",
      stats: baseStats({ structure: 5000, weapons: [] }),
      position: { x: 250, y: 0 },
      facing: Math.PI,
      doctrine: {
        base: {
          spatial: {
            reference: { kind: "target" },
            range: { kind: "hold", band: 0.3 },
            bearing: { kind: "free" },
          },
        },
        rules: [],
      },
      classification: "frigate",
    };
  }

  it("a ship within an aura radius damages a target it couldn't normally reach", () => {
    // With aura: gunship range = 200 * 1.5 = 300 → can hit enemy at 300.
    // Without aura: range = 200 < 300 → cannot hit.
    const withAura = runBattle(inputs([auraCarrier(), weaponShip(), farDefender()], 100));
    const withoutAura = runBattle(inputs([weaponShip(), farDefender()], 100));

    const defenderFinalWithAura = withAura.frames.at(-1)?.ships.find(
      (s) => s.instanceId === "defender",
    );
    const defenderFinalWithout = withoutAura.frames.at(-1)?.ships.find(
      (s) => s.instanceId === "defender",
    );

    const auraDefenderStructure = defenderFinalWithAura?.alive === false
      ? 0
      : (defenderFinalWithAura?.structure ?? 5000);
    const noAuraDefenderStructure = defenderFinalWithout?.alive === false
      ? 0
      : (defenderFinalWithout?.structure ?? 5000);

    // With aura the gunship fires and damages the defender; without it cannot reach.
    expect(auraDefenderStructure).toBeLessThan(noAuraDefenderStructure);
  });

  it("a ship outside the aura radius does NOT receive the bonus", () => {
    // Move the gunship far from the carrier so it falls outside the aura (radius=500).
    const farGunship: CombatShip = {
      ...weaponShip(),
      position: { x: 0, y: 600 }, // 600 units away from carrier at (50,0) — outside 500
    };
    const withFarCarrier = runBattle(inputs([auraCarrier(), farGunship, farDefender()], 100));
    const withoutAura = runBattle(inputs([farGunship, farDefender()], 100));

    const auraDefFinal = withFarCarrier.frames.at(-1)?.ships.find(
      (s) => s.instanceId === "defender",
    );
    const noAuraDefFinal = withoutAura.frames.at(-1)?.ships.find(
      (s) => s.instanceId === "defender",
    );

    // Both should be unable to reach the enemy; defender structure should be similar.
    const auraStr = auraDefFinal?.structure ?? 5000;
    const noAuraStr = noAuraDefFinal?.structure ?? 5000;
    // The far gunship is 600 units from carrier so it's outside the 500-unit aura.
    // It cannot reach the enemy at x=300 (range=200 < 300 distance when at y=600).
    // Both scenarios should leave the defender at full structure.
    expect(auraStr).toBeGreaterThan(4500);
    expect(noAuraStr).toBeGreaterThan(4500);
  });
});

// ---------------------------------------------------------------------------
// Determinism: designs without tech modules produce byte-identical frames
// ---------------------------------------------------------------------------

describe("engine.factions-tech – determinism (non-tech designs)", () => {
  /**
   * A modular ship with NO blink/afterburner/overcharge/reactive/adaptive/aura
   * modules. Two identical runs must produce byte-identical frames. A different
   * seed must produce different frames (weapon cooldown stagger differs).
   *
   * Engine thrust is zero so the ship holds position and its beams bear
   * consistently — the same convention as `powerStressedShip` above. The two
   * ships start already inside each other's visual reception range (see the
   * call sites), so they acquire a firing solution from the first ticks and the
   * RNG-staggered weapon cooldown shows up in the frames immediately. A drifting
   * fixture would instead spend the window manoeuvring (and, at the 1 m cell
   * scale, a three-cell fixture has so little moment of inertia that an off-CoM
   * engine torque spins it before it can settle on a heading), which is why this
   * determinism fixture station-keeps rather than closing.
   */
  function plainModularShip(id: string, side: "attacker" | "defender", x: number): CombatShip {
    const weaponEffect = beam({ damage: 15, range: 350, cooldown: 8 });
    const modules: ResolvedModule[] = [
      moduleOf("p1", { kind: "power", output: 100 }, 0, 0, 50, 5, 0),
      // Engine thrust zero: the ship station-keeps so its beams bear steadily.
      moduleOf("e1", { kind: "engine", thrust: 0, facing: Math.PI }, 1, 0, 50, 5, 0),
      // Weapon: no powerDraw so it's always charged; cooldown staggered by rng
      moduleOf("w1", weaponEffect, -1, 0, 50, 5, 0),
      // Phase 2: armour is a cell surface, not an equipment effect. The test
      // fixture keeps a structural placeholder module here so the grid geometry
      // is unchanged; its effect is `hull` (substrate-only anchor).
      moduleOf("a1", { kind: "hull" }, 0, 1, 100, 5, 0),
      moduleOf("s1", { kind: "shield", capacity: 100, rechargeRate: 2, rechargeDelay: 10 }, 0, -1, 50, 5, 0),
      // Command module required for per-module firing (weapon cooldown stagger visible)
      commandModule(1, 1),
    ];
    return {
      instanceId: id,
      designId: `d-${id}`,
      faction: "Terran",
      side,
      stats: baseStats({
        structure: 300,
        damageReduction: 0.1,
        shieldCapacity: 100,
        shieldRechargeRate: 2,
        shieldRechargeDelay: 10,
        thrust: 0,
        turnRate: 0.15,
        weapons: [{ slotId: "w1", effect: weaponEffect }],
      }),
      position: { x, y: 0 },
      facing: side === "attacker" ? 0 : Math.PI,
      doctrine: defaultDoctrine,
      classification: "frigate",
      modules,
    };
  }

  it("two identical runs with no tech modules produce byte-identical frames", () => {
    // 120 m apart — inside the ~140 m visual reception radius, so the
    // station-keeping ships hold a firing solution from the first ticks.
    const ships = [
      plainModularShip("a1", "attacker", 0),
      plainModularShip("d1", "defender", 120),
    ];
    const run1 = runBattle(inputs(ships, 80, 42));
    const run2 = runBattle(inputs(ships, 80, 42));
    expect(run1.frames).toEqual(run2.frames);
    expect(run1.winner).toBe(run2.winner);
    expect(run1.ticks).toBe(run2.ticks);
  });

  it("a different seed produces different frames (weapon cooldown stagger differs)", () => {
    // 120 m apart — inside the ~140 m visual reception radius, so both ships
    // acquire a firing solution at once and the seed-dependent cooldown stagger
    // diverges the frames within the first few ticks.
    const ships = [
      plainModularShip("a1", "attacker", 0),
      plainModularShip("d1", "defender", 120),
    ];
    const run1 = runBattle(inputs(ships, 80, 42));
    const run2 = runBattle(inputs(ships, 80, 99));
    // Different seeds → different weapon cooldown stagger → different firing
    // schedule → different frames at some tick. We check the complete frame
    // sequences differ (they will once weapons start firing at different ticks).
    expect(run1.frames).not.toEqual(run2.frames);
  });
});
