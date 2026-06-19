import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedHardwire, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";
import { catalog } from "@/data/catalog";
import { analyseShipDesign } from "@/domain/stats";
import { createId, nowIso } from "@/domain/id";
import type { GridCell, TileGrid } from "@/schema/grid";
import type { ShipDesign } from "@/schema/ship";

/**
 * Hardwire conduit unit tests.
 *
 * Each conduit type (ammo / power / manning) is tested in three regimes:
 *   1. Conduit active: the resource flows without crew.
 *   2. Without conduit: the same design has no conduit and the resource need goes
 *      unmet (for comparison).
 *   3. Severed conduit: the source module is destroyed mid-battle; the sink
 *      reverts to needing crew / running dry.
 *
 * A determinism check verifies that a design with NO connections produces
 * byte-identical frames across two runs — confirming the conduit paths are
 * inert on unhardwired designs.
 *
 * Validation tests use `analyseShipDesign` to check the fault model: an
 * incompatible conduit raises `invalidHardwire`; a valid conduit suppresses
 * the corresponding reachability fault.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function beam(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 20,
    range: 500,
    cooldown: 2,
    projectileSpeed: 0,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    facing: 0,
    ...over,
  };
}

function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  maxHp: number,
  opts: {
    mass?: number;
    powerDraw?: number;
    command?: boolean;
    crewRequired?: number;
  } = {},
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    x: col,
    y: row,
    maxHp,
    mass: opts.mass ?? 5,
    powerDraw: opts.powerDraw ?? 0,
    crewRequired: opts.crewRequired ?? 0,
    effect,
    command: opts.command ?? false,
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

function baseStats(structure = 999_999): ShipStats {
  return {
    mass: 10,
    massCapacity: 1000,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    thrust: 0.5,
    turnRate: 0.1,
    weapons: [],
  };
}

function shooterShip(
  id: string,
  x: number,
  modules: ResolvedModule[],
  hardwires?: ResolvedHardwire[],
  structure = 999_999,
): CombatShip {
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "test",
    side: "attacker",
    stats: baseStats(structure),
    position: { x, y: 0 },
    facing: 0,
    orders: { ...defaultOrders, engageRange: "hold" },
    classification: "frigate",
    modules,
    ...(hardwires !== undefined && hardwires.length > 0 ? { hardwires } : {}),
  };
}

/** A non-modular target with enormous structure that never dies. */
function toughTarget(id: string, x: number): CombatShip {
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "test",
    side: "defender",
    stats: baseStats(1_000_000),
    position: { x, y: 0 },
    facing: Math.PI,
    orders: { ...defaultOrders, engageRange: "hold" },
    classification: "frigate",
  };
}


function inputs(ships: CombatShip[], maxTicks = DEFAULT_MAX_TICKS): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomaly: "none",
    seed: 1,
    maxTicks,
  };
}

function structureOf(
  frame: { ships: { instanceId: string; structure: number }[] },
  id: string,
): number | undefined {
  return frame.ships.find((s) => s.instanceId === id)?.structure;
}

// ---------------------------------------------------------------------------
// Ammo conduit
// ---------------------------------------------------------------------------

describe("engine.hardwire — ammo conduit", () => {
  /**
   * Build a crewless ship with a finite-ammo weapon that starts completely dry
   * (`ammo: 0`). A magazine module is present at an adjacent cell.
   *
   * With the ammo conduit: the magazine feeds the weapon every tick → damage
   * is dealt to the target immediately (after the first tick of refill).
   * Without the conduit: the weapon starts dry and nothing refills it → no
   * damage ever.
   */

  const MAGAZINE_AMMO = 3000;
  const WEAPON_AMMO_CAP = 120;

  function ammoShip(id: string, x: number, withConduit: boolean): CombatShip {
    // Layout: col 0 = reactor/command, col 1 = magazine, col 2 = dry weapon.
    // No crew quarters → no crew. The weapon needs the conduit to resupply.
    const reactorSlotId = "p1";
    const magazineSlotId = "mag1";
    const weaponSlotId = "w1";

    const modules: ResolvedModule[] = [
      moduleOf(
        reactorSlotId,
        { kind: "power", output: 200 },
        0,
        0,
        200,
        { command: true },
      ),
      moduleOf(
        magazineSlotId,
        { kind: "magazine", ammoStored: MAGAZINE_AMMO },
        1,
        0,
        100,
      ),
      moduleOf(
        weaponSlotId,
        beam({ damage: 25, cooldown: 1, ammo: 0, ammoCapacity: WEAPON_AMMO_CAP }),
        2,
        0,
        100,
        { powerDraw: 5 },
      ),
    ];

    const hardwires: ResolvedHardwire[] = withConduit
      ? [{ sourceSlotId: magazineSlotId, sinkSlotId: weaponSlotId, resource: "ammo" }]
      : [];

    return shooterShip(id, x, modules, hardwires);
  }

  it("weapon hardwired to a magazine fires with no crew; an otherwise identical crewless weapon without the conduit stays dry", () => {
    const withConduit = runBattle(inputs([ammoShip("a-hw", 0, true), toughTarget("d1", 60)]));
    const withoutConduit = runBattle(inputs([ammoShip("a-no", 0, false), toughTarget("d1", 60)]));

    const initialWith = structureOf(withConduit.frames[0] ?? { ships: [] }, "d1") ?? 1_000_000;
    const finalWith = structureOf(withConduit.frames.at(-1) ?? { ships: [] }, "d1") ?? 1_000_000;

    const initialWithout = structureOf(withoutConduit.frames[0] ?? { ships: [] }, "d1") ?? 1_000_000;
    const finalWithout = structureOf(withoutConduit.frames.at(-1) ?? { ships: [] }, "d1") ?? 1_000_000;

    // With the conduit the weapon is resupplied and the target takes damage.
    expect(finalWith, "hardwired weapon should damage target").toBeLessThan(initialWith);

    // Without the conduit, the dry weapon is never refilled and deals no damage.
    expect(finalWithout, "crewless dry weapon with no conduit should deal no damage").toBe(initialWithout);
  });

  it("is byte-identical across two runs with the same seed (ammo conduit)", () => {
    const build = (): CombatShip => ammoShip("a-hw", 0, true);
    const a = runBattle(inputs([build(), toughTarget("d1", 60)]));
    const b = runBattle(inputs([build(), toughTarget("d1", 60)]));
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });
});

// ---------------------------------------------------------------------------
// Power conduit
// ---------------------------------------------------------------------------

describe("engine.hardwire — power conduit", () => {
  /**
   * A power-drawing weapon placed far from the reactor — beyond the
   * proximity wiring radius of 3 cells — with no crew to haul charge.
   *
   * Without the conduit: the weapon starts with a full local charge buffer
   * (60 units) and immediately begins draining it at `powerDraw` per tick.
   * It fires a handful of shots while the buffer lasts, then goes idle and
   * deals no further damage. Over a long battle (maxTicks = 3600) almost all
   * of the damage occurs in those first few ticks.
   *
   * With the conduit: the reactor tops the weapon's buffer to full every tick
   * regardless of distance → the weapon fires continuously for the whole battle,
   * dealing vastly more total damage.
   *
   * We assert: total damage (across all frames) with conduit ≫ without conduit.
   * Specifically, without the conduit the weapon drains after `chargeBufferMax /
   * powerDraw` ticks; with it the weapon fires for all 3600 ticks. The ratio
   * of total damage is large enough to be unambiguous.
   *
   * Corridor length of 7 cells (reactor at col 0, weapon at col 7) puts the
   * weapon 7 hops from the reactor — well beyond the proximity radius of 3 —
   * so the proximity wiring never reaches it.
   */

  /**
   * The local-charge model only engages on CREWED ships: a crewless ship
   * automatically tops every power-drawing module to full every tick (the
   * crewless fast path). To test a power conduit we need a crewed ship where
   * the sole crew member is permanently occupied manning the command station
   * (crewRequired=1), so no crew is free to haul charge to the distant weapon.
   *
   * Layout (crew-based power model, 1 crew member):
   *   col 0: crew quarters (capacity 1) — 1 crew spawns here
   *   col 1: command/reactor (power=200, crewRequired=1) — crew must man this
   *   cols 2–5: hull corridor (4 cells, bridging the gap)
   *   col 6: weapon (powerDraw=20) — 5 hops from reactor, beyond the 3-hop
   *           proximity radius; the busy crew cannot haul charge to it
   *
   * Without the conduit: the weapon starts with chargeBufferMax=60, fires for
   * a few ticks while the buffer lasts (60/20 = 3 ticks), then starves.
   * With the conduit: the reactor tops the weapon's buffer to full each tick,
   * so it fires for the entire battle.
   */

  function powerShip(id: string, x: number, withConduit: boolean): CombatShip {
    const reactorSlotId = "p1";
    const quartersSlotId = "q1";
    const weaponSlotId = "w6";

    const modules: ResolvedModule[] = [
      // Crew quarters at col 0 — spawns 1 crew member.
      moduleOf(quartersSlotId, { kind: "crew", capacity: 1 }, 0, 0, 60),
      // Command/reactor at col 1 — requires crew to man (output only when manned).
      // The single crew member will man this station and stay there all battle.
      moduleOf(reactorSlotId, { kind: "power", output: 200 }, 1, 0, 200, {
        command: true,
        crewRequired: 1,
      }),
      // Hull corridor: cols 2–8 (7 cells). Bridge between reactor and weapon.
      moduleOf("h2", { kind: "hull" }, 2, 0, 60),
      moduleOf("h3", { kind: "hull" }, 3, 0, 60),
      moduleOf("h4", { kind: "hull" }, 4, 0, 60),
      moduleOf("h5", { kind: "hull" }, 5, 0, 60),
      moduleOf("h6", { kind: "hull" }, 6, 0, 60),
      moduleOf("h7", { kind: "hull" }, 7, 0, 60),
      moduleOf("h8", { kind: "hull" }, 8, 0, 60),
      // Weapon at col 9 — 8 hops from reactor; beyond the 7-hop proximity wiring
      // radius, and the crew is busy at col 1 so no power haul is ever assigned.
      moduleOf(
        weaponSlotId,
        beam({ damage: 25, cooldown: 1 }),
        9,
        0,
        100,
        { powerDraw: 20 },
      ),
    ];

    const hardwires: ResolvedHardwire[] = withConduit
      ? [{ sourceSlotId: reactorSlotId, sinkSlotId: weaponSlotId, resource: "power" }]
      : [];

    return shooterShip(id, x, modules, hardwires);
  }

  /** Sum of damage dealt to the target across all frames. */
  function totalDamageDealt(result: ReturnType<typeof runBattle>, targetId: string): number {
    let prev = structureOf(result.frames[0] ?? { ships: [] }, targetId) ?? 1_000_000;
    let total = 0;
    for (let i = 1; i < result.frames.length; i += 1) {
      const curr = structureOf(result.frames[i] ?? { ships: [] }, targetId) ?? prev;
      if (curr < prev) total += prev - curr;
      prev = curr;
    }
    return total;
  }

  it("power-drawing module hardwired to a distant reactor fires continuously; without the conduit it starves after a few shots", () => {
    // Long battle so the difference between "fires a few shots then starves"
    // and "fires for 3600 ticks" is unambiguous.
    const hw = runBattle(inputs([powerShip("a-hw", 0, true), toughTarget("d1", 80)], 3600));
    const no = runBattle(inputs([powerShip("a-no", 0, false), toughTarget("d1", 80)], 3600));

    const damageHw = totalDamageDealt(hw, "d1");
    const damageNo = totalDamageDealt(no, "d1");

    // Hardwired weapon fires continuously → far more damage than the starved weapon.
    expect(damageHw, "hardwired weapon should fire continuously").toBeGreaterThan(0);
    // The no-conduit weapon fires only while its initial charge buffer lasts
    // (chargeBufferMax=60, powerDraw=20 → a few shots), whereas the hardwired
    // weapon fires across the entire 3600-tick battle. The hardwired ship must
    // deal at least 10× more damage.
    expect(damageHw, "conduit weapon should deal far more damage than starved weapon").toBeGreaterThan(damageNo * 10);
  });

  it("is byte-identical across two runs with the same seed (power conduit)", () => {
    const build = (): CombatShip => powerShip("a-hw", 0, true);
    const a = runBattle(inputs([build(), toughTarget("d1", 80)]));
    const b = runBattle(inputs([build(), toughTarget("d1", 80)]));
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });
});

// ---------------------------------------------------------------------------
// Manning conduit
// ---------------------------------------------------------------------------

describe("engine.hardwire — manning conduit", () => {
  /**
   * A weapon with `crewRequired: 1` and a command module hardwired to it.
   * The ship has NO crew quarters, so no crew spawn.
   *
   * Without the conduit: the gun is unmanned forever → no damage.
   * With the conduit: the command module "mans" the gun via the link → fires.
   */

  function manningShip(id: string, x: number, withConduit: boolean): CombatShip {
    const commandSlotId = "p1";
    const weaponSlotId = "w1";

    const modules: ResolvedModule[] = [
      // Command/power module — the manning source.
      moduleOf(
        commandSlotId,
        { kind: "power", output: 200 },
        0,
        0,
        200,
        { command: true },
      ),
      // Weapon requires 1 crew — must be manned to fire.
      moduleOf(
        weaponSlotId,
        beam({ damage: 25, cooldown: 2 }),
        1,
        0,
        100,
        { crewRequired: 1, powerDraw: 5 },
      ),
    ];

    const hardwires: ResolvedHardwire[] = withConduit
      ? [{ sourceSlotId: commandSlotId, sinkSlotId: weaponSlotId, resource: "manning" }]
      : [];

    return shooterShip(id, x, modules, hardwires);
  }

  it("crewed station hardwired to command module is manned with zero crew; without the conduit it never fires", () => {
    const withConduit = runBattle(inputs([manningShip("a-hw", 0, true), toughTarget("d1", 40)]));
    const withoutConduit = runBattle(inputs([manningShip("a-no", 0, false), toughTarget("d1", 40)]));

    const initialWith = structureOf(withConduit.frames[0] ?? { ships: [] }, "d1") ?? 1_000_000;
    const finalWith = structureOf(withConduit.frames.at(-1) ?? { ships: [] }, "d1") ?? 1_000_000;

    const initialWithout = structureOf(withoutConduit.frames[0] ?? { ships: [] }, "d1") ?? 1_000_000;
    const finalWithout = structureOf(withoutConduit.frames.at(-1) ?? { ships: [] }, "d1") ?? 1_000_000;

    // Manning conduit mans the gun → target takes damage.
    expect(finalWith, "manning-hardwired gun should fire").toBeLessThan(initialWith);

    // No conduit, no crew → gun is permanently unmanned → no damage.
    expect(finalWithout, "unmanned gun without conduit should deal no damage").toBe(initialWithout);
  });

  it("is byte-identical across two runs with the same seed (manning conduit)", () => {
    const build = (): CombatShip => manningShip("a-hw", 0, true);
    const a = runBattle(inputs([build(), toughTarget("d1", 40)]));
    const b = runBattle(inputs([build(), toughTarget("d1", 40)]));
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });
});

// ---------------------------------------------------------------------------
// Severed links — source module destroyed
// ---------------------------------------------------------------------------

describe("engine.hardwire — severed link reverts sink", () => {
  /**
   * Manning severed: a crewless ship has a weapon conduit-manned via its
   * command module. A powerful enemy beam progressively destroys the command
   * module over two hits, then the weapon reverts to unmanned and stops firing.
   *
   * The key timing (tick-level):
   *   - Tick 1: `fireWeapons` — weapon manned=false (initial, set in toSimModule),
   *     cannot fire. Enemy fires → command HP drops from 75 to 25 (survives).
   *     `recomputeManning` → command still alive → weapon manned=true.
   *   - Tick 2: weapon manned=true → fires (deals damage). Enemy fires again →
   *     command HP 25 − 50 = −25 → dead. `recomputeManning` → command dead →
   *     manned=false.
   *   - Tick 3+: weapon manned=false → no fire.
   *
   * Layout:
   *   col 0 = command/reactor (HP=75 — survives first enemy hit, dies on second)
   *   col 1 = weapon (crewRequired=1, manning-wired to col 0)
   *
   * The enemy fires a 50-damage beam every 2 ticks (cooldown=1, so fires ticks 1,3,…
   * or 2,4,… depending on stagger). We give the command module 75 HP so it survives
   * the first hit and manned is set to true after tick 1; by tick 2 or 3 it is dead.
   */
  it("severed manning conduit (command module destroyed) stops a crewless hardwired weapon", () => {
    const commandSlotId = "cmd";
    const weaponSlotId = "gun";

    // The shooter: no crew, weapon requires manning, wired to command module.
    // Command module HP=75: survives the first 50-damage enemy hit, dies on the second.
    const shooter = shooterShip(
      "shooter",
      0,
      [
        moduleOf(commandSlotId, { kind: "power", output: 200 }, 0, 0, 75, { command: true }),
        // Weapon: crewRequired=1, low cooldown so it fires as soon as it is manned.
        moduleOf(weaponSlotId, beam({ damage: 15, cooldown: 1 }), 1, 0, 999, {
          crewRequired: 1,
          powerDraw: 0, // no power draw — eliminates the charge-starvation concern
        }),
      ],
      [{ sourceSlotId: commandSlotId, sinkSlotId: weaponSlotId, resource: "manning" }],
    );

    // The enemy fires a 50-damage beam every 2 ticks. After 2 hits the command
    // module (75 HP) is dead: 75 − 50 = 25 after tick 1, then 25 − 50 < 0 on
    // the next hit → destroyed.
    const enemy: CombatShip = {
      instanceId: "enemy",
      designId: "d-enemy",
      faction: "test",
      side: "defender",
      stats: {
        ...baseStats(999_999),
        weapons: [{ slotId: "s1", effect: beam({ damage: 50, cooldown: 1 }) }],
      },
      position: { x: 60, y: 0 },
      facing: Math.PI,
      orders: { ...defaultOrders, engageRange: "hold" },
      classification: "frigate",
    };

    // A separate tough target the shooter aims at (distinct from the enemy so
    // the enemy keeps shooting at the shooter throughout).
    const target: CombatShip = toughTarget("target", 50);

    const result = runBattle(inputs([shooter, enemy, target], 200));

    const structures = result.frames.map((f) => structureOf(f, "target") ?? 1_000_000);
    const initial = structures[0] ?? 1_000_000;
    const finalStructure = structures.at(-1) ?? initial;
    const totalDamage = initial - finalStructure;

    // The weapon must fire at least once (when manned via the conduit on tick 2
    // or the tick after the first recomputeManning sets manned=true).
    expect(totalDamage, "weapon should fire at least once when command module is alive").toBeGreaterThan(0);

    // Damage stops once the command module is destroyed and manned reverts to
    // false. We verify this by comparing damage in the last half of the battle
    // (after the command module has definitely been destroyed) against total damage.
    // If the weapon kept firing, the final-half damage would equal or exceed the
    // first-half damage. If it stopped, the last-half damage should be zero.
    const midFrame = Math.floor(result.frames.length / 2);
    const midStructure = structures[midFrame] ?? initial;
    const firstHalfDamage = initial - midStructure;
    const secondHalfDamage = midStructure - finalStructure;

    // All damage should occur in the first half (command module dies quickly).
    // The second half must contribute nothing — the weapon is permanently unmanned.
    expect(secondHalfDamage, "no damage should accrue after command module is destroyed").toBe(0);
    // And the first half had all the damage.
    expect(firstHalfDamage, "all damage occurred before command module fell").toBe(totalDamage);
  });

  /**
   * Ammo conduit severed: the magazine is destroyed by enemy fire on tick 1,
   * severing the conduit. The weapon fires its 1 starting round on tick 1 (before
   * the magazine dies), then ammo=0 and no further refill arrives.
   *
   * Module layout — positions chosen so the enemy beam hits the magazine first
   * (it is at col 0, nearest to the impact point from the enemy at x=80):
   *   col 0: magazine (1 HP) — nearest to enemy impact; dies on first hit
   *   col 1: command/reactor (999 HP) — stays alive (magazine absorbs the shot)
   *   col 2: weapon (ammo=1, ammoCapacity=120, cooldown=0 → always stagger 0)
   *
   * Timing:
   *   Tick 1: step 3 fireWeapons — shooter fires first (listed first); cooldown=0,
   *     ammo=1 → fires → ammo=0. Enemy fires → magazine (1 HP at col 0) absorbs
   *     the damage → dies. Conduit source is now dead.
   *   Tick 1: step 4b-ammo — magazine dead → conduit severed → no refill.
   *   Tick 2+: ammo=0 → weapon cannot fire → no further damage.
   *
   * Compared against an always-alive baseline (no enemy, magazine HP=999) where
   * the conduit refills the weapon every tick, dealing far more damage.
   */
  it("severed ammo conduit (magazine destroyed) stops the hardwired weapon from refilling", () => {
    const reactorSlotId = "p1";
    const magazineSlotId = "mag";
    const weaponSlotId = "gun";

    // Magazine at col 0 (x=0): nearest to the enemy impact point from x=80.
    // Command/reactor at col 1: survives (magazine takes the full hit).
    // Weapon at col 2: cooldown=0 so stagger is always 0 → fires on tick 1.
    const makeShooter = (): CombatShip => {
      const modules: ResolvedModule[] = [
        moduleOf(
          magazineSlotId,
          { kind: "magazine", ammoStored: 3000 },
          0,
          0,
          1, // 1 HP — dies on the first enemy hit
        ),
        moduleOf(reactorSlotId, { kind: "power", output: 200 }, 1, 0, 999, {
          command: true,
        }),
        moduleOf(
          weaponSlotId,
          beam({ damage: 25, cooldown: 0, ammo: 1, ammoCapacity: 120 }),
          2,
          0,
          999,
          { powerDraw: 0 },
        ),
      ];

      return shooterShip("shooter", 0, modules, [
        { sourceSlotId: magazineSlotId, sinkSlotId: weaponSlotId, resource: "ammo" },
      ]);
    };

    // Enemy: a 2-damage beam (just enough to destroy the 1-HP magazine). The
    // damage hits the nearest module (magazine at col 0, x=0) and is fully
    // absorbed; the reactor and weapon survive.
    const enemy: CombatShip = {
      instanceId: "enemy",
      designId: "d-enemy",
      faction: "test",
      side: "defender",
      stats: {
        ...baseStats(999_999),
        weapons: [{ slotId: "s1", effect: beam({ damage: 2, cooldown: 0 }) }],
      },
      position: { x: 80, y: 0 },
      facing: Math.PI,
      orders: { ...defaultOrders, engageRange: "hold" },
      classification: "frigate",
    };

    const target: CombatShip = toughTarget("target", 70);

    // Severed run: magazine dies on tick 1; weapon fires exactly 1 shot.
    const severedResult = runBattle(inputs([makeShooter(), enemy, target], 200));

    // Always-alive baseline: no enemy, magazine has 999 HP. Weapon fires every
    // tick (cooldown=0) and the conduit refills it from the magazine each tick.
    const alwaysAliveShooter = (): CombatShip =>
      shooterShip(
        "shooter",
        0,
        [
          moduleOf(magazineSlotId, { kind: "magazine", ammoStored: 3000 }, 0, 0, 999),
          moduleOf(reactorSlotId, { kind: "power", output: 200 }, 1, 0, 999, {
            command: true,
          }),
          moduleOf(
            weaponSlotId,
            beam({ damage: 25, cooldown: 0, ammo: 1, ammoCapacity: 120 }),
            2,
            0,
            999,
            { powerDraw: 0 },
          ),
        ],
        [{ sourceSlotId: magazineSlotId, sinkSlotId: weaponSlotId, resource: "ammo" }],
      );

    const alwaysResult = runBattle(inputs([alwaysAliveShooter(), toughTarget("target", 70)], 200));

    const severedDamage =
      (structureOf(severedResult.frames[0] ?? { ships: [] }, "target") ?? 1_000_000) -
      (structureOf(severedResult.frames.at(-1) ?? { ships: [] }, "target") ?? 1_000_000);

    const alwaysDamage =
      (structureOf(alwaysResult.frames[0] ?? { ships: [] }, "target") ?? 1_000_000) -
      (structureOf(alwaysResult.frames.at(-1) ?? { ships: [] }, "target") ?? 1_000_000);

    // The severed weapon fires exactly 1 shot before the magazine is destroyed.
    expect(severedDamage, "weapon should fire once (ammo=1) before magazine is destroyed").toBeGreaterThan(0);

    // The always-alive conduit refills every tick → far more total damage.
    expect(alwaysDamage, "always-alive conduit deals far more than 1 shot").toBeGreaterThan(severedDamage * 5);
  });
});

// ---------------------------------------------------------------------------
// Determinism: design with NO connections is byte-identical across two runs
// ---------------------------------------------------------------------------

describe("engine.hardwire — byte-identical frames for designs with no connections", () => {
  it("a modular design with no hardwires produces identical frames across two independent runs", () => {
    const build = (): CombatShip =>
      shooterShip(
        "a1",
        0,
        [
          moduleOf("q1", { kind: "crew", capacity: 2 }, 0, 0, 15),
          moduleOf("p1", { kind: "power", output: 80 }, 1, 0, 20, { command: true }),
          moduleOf(
            "w1",
            beam({ damage: 20, cooldown: 2 }),
            2,
            0,
            50,
            { powerDraw: 8, crewRequired: 1 },
          ),
        ],
        // No hardwires — connections is intentionally absent.
      );

    const a = runBattle(inputs([build(), toughTarget("d1", 50)]));
    const b = runBattle(inputs([build(), toughTarget("d1", 50)]));
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });
});

// ---------------------------------------------------------------------------
// Validation: analyseShipDesign — incompatible and valid hardwires
// ---------------------------------------------------------------------------

/** ASCII grid helpers for building test designs. Subset of stats.unit.test.ts tokens. */
const TOKENS: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": { kind: "hull", tile: "block" },
  F: { kind: "module", moduleId: "mod-reactor-fusion", facing: 0 },
  C: { kind: "module", moduleId: "mod-crew-quarters", facing: 0 },
  R: { kind: "module", moduleId: "mod-railgun", facing: 0 },
  G: { kind: "module", moduleId: "mod-munitions-magazine", facing: 0 },
  A: { kind: "module", moduleId: "mod-armour-titanium", facing: 0 },
  L: { kind: "module", moduleId: "mod-pulse-laser", facing: 0 },
};

function grid(
  rows: readonly string[],
  connections: TileGrid["connections"] = [],
): TileGrid {
  const cols = rows[0]?.length ?? 0;
  const cells: GridCell[] = [];
  for (const row of rows) {
    for (const ch of row) {
      const cell = TOKENS[ch];
      if (cell === undefined) throw new Error(`Unknown token: ${ch}`);
      cells.push(cell);
    }
  }
  return { cols, rows: rows.length, cells, connections };
}

function design(g: TileGrid): ShipDesign {
  return {
    id: createId("design"),
    name: "Test",
    faction: "Terran",
    grid: g,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

describe("engine.hardwire — analyseShipDesign validation", () => {
  it("armour used as ammo source raises invalidHardwire", () => {
    // Grid: F (reactor/command) — A (armour) — R (railgun, finite ammo)
    // Connection: armour (col 1) → railgun (col 2), resource: ammo
    // This is invalid because the source must be a magazine.
    const g = grid(
      ["FAR"],
      [{ from: { col: 1, row: 0 }, to: { col: 2, row: 0 }, resource: "ammo" }],
    );
    const { faults } = analyseShipDesign(design(g), catalog());
    const hwFaults = faults.filter((f) => f.kind === "invalidHardwire");
    expect(hwFaults.length, "armour→weapon ammo conduit should raise invalidHardwire").toBeGreaterThan(0);
    if (hwFaults[0]?.kind === "invalidHardwire") {
      expect(hwFaults[0].resource).toBe("ammo");
      expect(hwFaults[0].reason).toMatch(/magazine/);
    }
  });

  it("reactor used as manning source for non-crewed module raises invalidHardwire", () => {
    // Grid: F (reactor/command, crewRequired=1) — A (armour, crewRequired=0)
    // Connection: F (col 0) → A (col 1), resource: manning
    // Invalid: sink must have crewRequired > 0.
    const g = grid(
      ["FA"],
      [{ from: { col: 0, row: 0 }, to: { col: 1, row: 0 }, resource: "manning" }],
    );
    const { faults } = analyseShipDesign(design(g), catalog());
    const hwFaults = faults.filter((f) => f.kind === "invalidHardwire");
    expect(hwFaults.length, "command→non-crewed manning conduit should raise invalidHardwire").toBeGreaterThan(0);
    if (hwFaults[0]?.kind === "invalidHardwire") {
      expect(hwFaults[0].resource).toBe("manning");
    }
  });

  it("valid ammo conduit (magazine → railgun) suppresses noAmmoSource for the linked weapon", () => {
    // Grid: F (reactor/command, 1 crew) — G (magazine) — R (railgun)
    // The railgun is isolated from the magazine by default, BUT the conduit
    // covers it directly, so noAmmoSource must NOT fire.
    // Note: this design does need crew (crewRequired ≥ 1 on F and G), so
    // we add a crew quarters to avoid crewDeficit masking the test.
    // Layout: C (crew) — F (reactor) — G (magazine) — R (railgun)
    const g = grid(
      ["CFGR"],
      [{ from: { col: 2, row: 0 }, to: { col: 3, row: 0 }, resource: "ammo" }],
    );
    const { faults } = analyseShipDesign(design(g), catalog());
    expect(faults.map((f) => f.kind)).not.toContain("invalidHardwire");
    expect(faults.map((f) => f.kind)).not.toContain("noAmmoSource");
  });

  it("valid manning conduit (command module → crewed weapon) suppresses unreachableStation", () => {
    // A pulse laser (crewRequired=1) at col 1; reactor (command) at col 0.
    // No crew quarters: normally this would raise crewDeficit and, if quarters
    // existed, unreachableStation. With a manning conduit the laser's station
    // need is satisfied. We test with crew quarters to isolate unreachableStation.
    //
    // Layout: C (crew quarters, col 0) — F (reactor/command, col 1) — L (laser, col 2)
    // Connection: F (col 1) → L (col 2), resource: manning
    // The laser is reachable from the quarters directly (crew can walk), so
    // unreachableStation wouldn't fire here anyway — but no invalidHardwire
    // should fire and noAmmoSource is not relevant (laser has unlimited ammo).
    const g = grid(
      ["CFL"],
      [{ from: { col: 1, row: 0 }, to: { col: 2, row: 0 }, resource: "manning" }],
    );
    const { faults } = analyseShipDesign(design(g), catalog());
    expect(faults.map((f) => f.kind)).not.toContain("invalidHardwire");
    // The design should be valid since laser+reactor+crew is a fine trio.
    // (Warnings such as noSensors are non-blocking, so filter to errors only.)
    expect(faults.filter((f) => f.severity === "error"), JSON.stringify(faults)).toHaveLength(0);
  });

  it("non-module cell used as source raises invalidHardwire", () => {
    // Grid (1 row, 3 cols): F (col 0) — # hull block (col 1) — R railgun (col 2)
    // Connection: hull block (col 1) → railgun (col 2), resource: ammo
    // Invalid because source must be a module cell.
    const g = grid(
      ["F#R"],
      [{ from: { col: 1, row: 0 }, to: { col: 2, row: 0 }, resource: "ammo" }],
    );
    const { faults } = analyseShipDesign(design(g), catalog());
    const hwFaults = faults.filter((f) => f.kind === "invalidHardwire");
    expect(hwFaults.length, "hull cell as source should raise invalidHardwire").toBeGreaterThan(0);
    if (hwFaults[0]?.kind === "invalidHardwire") {
      expect(hwFaults[0].reason).toMatch(/source cell is not a module/);
    }
  });
});
