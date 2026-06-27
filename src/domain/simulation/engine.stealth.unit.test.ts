import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { sumCellHp } from "@/domain/simulation/test-cell-helpers";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { Doctrine } from "@/schema/ai";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/** Empty doctrine — equivalent to the legacy defaults (stance undefined falls
 *  back to balanced, crew to combat, targeting to nearest). Every ship in this
 *  file holds position and fights with default behaviour. */
const defaultDoctrine: Doctrine = { base: {}, rules: [] };


const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

/**
 * Stealth detectability: cloak, signature reduction, and the sensor counters.
 *
 * The acquisition gate is opt-in — a ship with neither cloak nor signature is
 * always detectable, so non-stealth battles are byte-identical (guarded by the
 * factions-tech determinism fixtures). These tests exercise the opt-in side:
 * a cloaked or signature-reduced ship escapes targeting, and the sensor
 * counters (pierce-cloak, extended detection range) claw it back.
 *
 * Stealth is observed through damage: a hunter with a long-range hitscan beam
 * fires at any target it can acquire, so a stealthed prey that takes no damage
 * was never acquired, and one that takes damage was. Helpers mirror the
 * factions-tech test file so this file is self-contained.
 */

function beam(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 20,
    range: 5000,
    cooldown: 4,
    projectileSpeed: 0,
    projectileMass: 0.5,
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
  maxHp = 50,
  mass = 5,
  powerDraw = 0,
): ResolvedModule {
  const engineFacing = effect.kind === "engine" ? (effect.facing ?? 0) : 0;
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    x: col * 24,
    y: row * 24,
    maxSurfaceHp: 0,
    maxSubstrateHp: maxHp,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    surface: "deck",
    edges: OPEN_EDGES,
    mass,
    powerDraw,
    crewRequired: 0,
    effect,
    command: false,
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: engineFacing,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

function commandModule(col: number, row: number): ResolvedModule {
  return { ...moduleOf("cmd", { kind: "hull" }, col, row, 50, 5, 0), command: true };
}

/** Lay modules out in a single contiguous row so the grid is 4-connected and
 *  break-apart never splits the ship (a disconnected grid would destroy modules
 *  on tick 1, masquerading as battle damage). Columns run left from the command
 *  module so the whole ship is one chain. */
function rowLayout(weapons: ResolvedModule[], extras: ResolvedModule[]): ResolvedModule[] {
  const ordered: ResolvedModule[] = [
    { ...commandModule(0, 0) },
    { ...moduleOf("p1", { kind: "power", output: 1000 }, 1, 0, 50, 5, 0) },
    // An all-round sensor so the ship gains fog-of-war awareness of the enemy
    // (required by the evolved detection model): without it the hunter never
    // acquires the prey and stealth is untestable. A plain (non-pierce-cloak)
    // array sees uncloaked/signature prey, but a cloak still hides its target.
    {
      ...moduleOf(
        "snr",
        { kind: "sensor", sensorType: "omni", arc: Math.PI, bearing: 0, detectionRange: 2000, nebulaImmune: false },
        2,
        0,
        50,
        5,
        0,
      ),
    },
    ...weapons,
    ...extras,
  ];
  // Reassign columns so every cell is adjacent to the previous one (row 0).
  return ordered.map((m, i) => ({ ...m, col: i, row: 0, x: i * 24, y: 0 }));
}

function baseStats(over: Partial<ShipStats> = {}): ShipStats {
  return {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 500,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    thrust: 0,
    turnRate: 0,
    weapons: [],
    ...over,
    compartments: 0,
  airtightCompartments: 0,
};
}

/** A stationary modular ship at (x, y) facing the enemy, optionally armed and
 *  carrying the given extra modules (cloak/signature/sensor). thrust=0 so the
 *  two ships hold position and the geometry is fixed for the whole battle. */
function ship(opts: {
  id: string;
  side: "attacker" | "defender";
  x: number;
  facing: number;
  weapons?: WeaponEffect[];
  extra?: ResolvedModule[];
}): CombatShip {
  const weapons = opts.weapons ?? [];
  const weaponModules: ResolvedModule[] = weapons.map((w, i) =>
    moduleOf(`w${i}`, w, 0, 0, 50, 5, 0),
  );
  const modules = rowLayout(weaponModules, opts.extra ?? []);
  return {
    instanceId: opts.id,
    designId: `d-${opts.id}`,
    faction: "Terran",
    side: opts.side,
    stats: baseStats({
      structure: 500,
      weapons: weapons.map((w, i) => ({ slotId: `w${i}`, effect: w })),
    }),
    position: { x: opts.x, y: 0 },
    facing: opts.facing,
    doctrine: defaultDoctrine,
    classification: "frigate",
    modules,
  };
}

function inputs(ships: CombatShip[], maxTicks = 30, seed = 7): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomalies: [],
    seed,
    maxTicks,
  };
}

/**
 * Whether a ship took any combat damage by the final frame. Beam hits land on
 * modules (structure only drops on overflow), so the reliable signal that a ship
 * was acquired and fired upon is that at least one of its modules lost HP or was
 * destroyed. An un-targeted ship ends the battle with every module at full HP.
 */
function tookDamage(result: ReturnType<typeof runBattle>, id: string): boolean {
  const first = result.frames[0];
  const last = result.frames[result.frames.length - 1];
  if (first === undefined || last === undefined) throw new Error("no frames");
  const start = first.ships.find((sh) => sh.instanceId === id);
  const end = last.ships.find((sh) => sh.instanceId === id);
  if (start === undefined || end === undefined) throw new Error(`ship ${id} missing`);
  if (!end.alive) return true;
  const startHp = sumCellHp(start.cells);
  const endHp = sumCellHp(end.cells);
  return endHp < startHp || end.structure < start.structure;
}

/** Total module HP + structure damage a ship suffered over the full battle.
 *  A destroyed ship contributes its entire starting pool. */
function totalDamage(result: ReturnType<typeof runBattle>, id: string): number {
  const first = result.frames[0];
  const last = result.frames[result.frames.length - 1];
  if (first === undefined || last === undefined) throw new Error("no frames");
  const start = first.ships.find((sh) => sh.instanceId === id);
  const end = last.ships.find((sh) => sh.instanceId === id);
  if (start === undefined || end === undefined) throw new Error(`ship ${id} missing`);
  const startHp = sumCellHp(start.cells) + start.structure;
  if (!end.alive) return startHp;
  const endHp = sumCellHp(end.cells) + end.structure;
  return startHp - endHp;
}

describe("engine.stealth – cloak", () => {
  it("an unarmed cloaked ship is never acquired and takes no damage", () => {
    // Hunter (armed, no sensor) vs an unarmed cloaked prey 300 units away. The
    // prey never fires, so its cloak never drops; the hunter cannot acquire it.
    const ships = [
      ship({ id: "hunter", side: "attacker", x: 0, facing: 0, weapons: [beam()] }),
      ship({
        id: "prey",
        side: "defender",
        x: 300,
        facing: Math.PI,
        extra: [moduleOf("clk", { kind: "cloak", decloakTicks: 5 }, 2, 0, 50, 5, 0)],
      }),
    ];
    const result = runBattle(inputs(ships));
    expect(tookDamage(result, "prey")).toBe(false);
  });

  it("an identical un-cloaked ship in the same position is hit", () => {
    // Control: same geometry, no cloak module — the prey is acquired and damaged.
    const ships = [
      ship({ id: "hunter", side: "attacker", x: 0, facing: 0, weapons: [beam()] }),
      ship({ id: "prey", side: "defender", x: 300, facing: Math.PI }),
    ];
    const result = runBattle(inputs(ships));
    expect(tookDamage(result, "prey")).toBe(true);
  });

  it("a cloaked ship that fires drops its cloak and is hit back", () => {
    // The cloaked ship is armed, so it fires and exposes itself for decloakTicks.
    // During that window the hunter acquires and damages it.
    const ships = [
      ship({ id: "hunter", side: "attacker", x: 0, facing: 0, weapons: [beam()] }),
      ship({
        id: "prey",
        side: "defender",
        x: 300,
        facing: Math.PI,
        weapons: [beam()],
        extra: [moduleOf("clk", { kind: "cloak", decloakTicks: 5 }, 2, 0, 50, 5, 0)],
      }),
    ];
    const result = runBattle(inputs(ships));
    expect(tookDamage(result, "prey")).toBe(true);
  });

  it("a pierce-cloak sensor in range acquires a fully cloaked, silent ship", () => {
    // The hunter carries a pierce-cloak sensor whose reach (baseAcquireRange +
    // detectionRange) covers the 300-unit gap, so the unarmed cloaked prey is
    // seen and hit despite never firing.
    const ships = [
      ship({
        id: "hunter",
        side: "attacker",
        x: 0,
        facing: 0,
        weapons: [beam()],
        extra: [
          moduleOf(
            "snr",
            { kind: "sensor", sensorType: "omni", arc: Math.PI, bearing: 0, detectionRange: 100, nebulaImmune: false, pierceCloak: true },
            2,
            0,
            50,
            5,
            0,
          ),
        ],
      }),
      ship({
        id: "prey",
        side: "defender",
        x: 300,
        facing: Math.PI,
        extra: [moduleOf("clk", { kind: "cloak", decloakTicks: 5 }, 2, 0, 50, 5, 0)],
      }),
    ];
    const result = runBattle(inputs(ships));
    expect(tookDamage(result, "prey")).toBe(true);
  });

  it("a plain (non-pierce) sensor does NOT see through cloak", () => {
    // Same setup but the sensor lacks pierceCloak — it extends ordinary range
    // only, so the silent cloaked prey stays hidden and unharmed.
    const ships = [
      ship({
        id: "hunter",
        side: "attacker",
        x: 0,
        facing: 0,
        weapons: [beam()],
        extra: [
          moduleOf(
            "snr",
            { kind: "sensor", sensorType: "omni", arc: Math.PI, bearing: 0, detectionRange: 100, nebulaImmune: false },
            2,
            0,
            50,
            5,
            0,
          ),
        ],
      }),
      ship({
        id: "prey",
        side: "defender",
        x: 300,
        facing: Math.PI,
        extra: [moduleOf("clk", { kind: "cloak", decloakTicks: 5 }, 2, 0, 50, 5, 0)],
      }),
    ];
    const result = runBattle(inputs(ships));
    expect(tookDamage(result, "prey")).toBe(false);
  });

  it("a cloaked ship re-cloaks after decloakTicks and stops taking damage", () => {
    // The prey fires once (weapon cooldown 80 so it cannot fire again in 100
    // ticks) and has decloakTicks = 6: it is exposed for 6 ticks after firing,
    // then becomes invisible again. Compare to a run where decloakTicks = 200
    // (stays visible the entire battle): the short-exposure run must take far
    // less damage because the hunter loses the target after the window closes.
    const hunter = ship({
      id: "hunter",
      side: "attacker",
      x: 0,
      facing: 0,
      weapons: [beam({ cooldown: 2 })],
    });

    const makePreyWith = (decloakTicks: number) =>
      ship({
        id: "prey",
        side: "defender",
        x: 300,
        facing: Math.PI,
        weapons: [beam({ cooldown: 80 })],
        extra: [moduleOf("clk", { kind: "cloak", decloakTicks }, 2, 0, 50, 5, 0)],
      });

    const shortWindow = runBattle(inputs([hunter, makePreyWith(6)], 100));
    const longWindow = runBattle(inputs([hunter, makePreyWith(200)], 100));

    // Long-exposure prey is visible throughout the battle and accumulates far
    // more damage than the prey that re-cloaks after its brief exposure window.
    expect(totalDamage(shortWindow, "prey")).toBeLessThan(totalDamage(longWindow, "prey"));

    // The short-window prey must take at least some damage (it did fire and
    // expose itself), confirming it was acquired during the open window.
    expect(tookDamage(shortWindow, "prey")).toBe(true);
  });
});

describe("engine.stealth – signature", () => {
  it("a signature module shrinks acquisition range so a distant prey is hidden", () => {
    // Re-baselined for km combat: the engine's `SIM.baseAcquireRange` rose from
    // 2000 m to 60000 m, so the signature-acquisition fixtures scale up with it.
    // The hunter carries a 30000 m sensor so the prey at 30000 m IS in awareness
    // (its innate 5000 m eye could not see that far) — this isolates the signature
    // gate, not mere sight. The prey's 0.3 signature shrinks the effective acquire
    // range to (base 60000 + sensor 30000) * 0.3 = 27000 m, short of 30000 m, so
    // the prey is aware-of but never locked onto. The beam reaches 40000 m (past
    // the prey), so escaping fire is purely the signature, not range. Ships are
    // stationary (thrust 0).
    const ships = [
      ship({
        id: "hunter",
        side: "attacker",
        x: 0,
        facing: 0,
        weapons: [beam({ range: 40000 })],
        extra: [
          moduleOf(
            "snr",
            { kind: "sensor", sensorType: "omni", arc: Math.PI, bearing: 0, detectionRange: 30000, nebulaImmune: false },
            2,
            0,
            50,
            5,
            0,
          ),
        ],
      }),
      ship({
        id: "prey",
        side: "defender",
        x: 30000,
        facing: Math.PI,
        extra: [
          moduleOf("sig", { kind: "signature", acquisitionMultiplier: 0.3 }, 2, 0, 50, 5, 0),
        ],
      }),
    ];
    const result = runBattle(inputs(ships));
    expect(tookDamage(result, "prey")).toBe(false);
  });

  it("the same prey is acquired once inside the reduced range", () => {
    // Move the same signature-reduced prey to 4000 m — inside the reduced acquire
    // range (base 60000 * 0.5 = 30000 m) and inside the hunter's 5000 m beam — and
    // it is acquired and damaged.
    const ships = [
      ship({ id: "hunter", side: "attacker", x: 0, facing: 0, weapons: [beam()] }),
      ship({
        id: "prey",
        side: "defender",
        x: 4000,
        facing: Math.PI,
        extra: [
          moduleOf("sig", { kind: "signature", acquisitionMultiplier: 0.5 }, 2, 0, 50, 5, 0),
        ],
      }),
    ];
    const result = runBattle(inputs(ships));
    expect(tookDamage(result, "prey")).toBe(true);
  });

  it("a sensor uplift extends acquisition range to defeat a signature", () => {
    // Hunter with a 40000 m detection-range sensor: the cone first brings the
    // distant prey into awareness (the innate 5000 m eye cannot), and the same
    // sensor's additive acquire bonus lifts the effective acquire range to
    // (base 60000 + sensor 40000) * 0.5-signature = 50000 m, comfortably past the
    // prey at 31000 m — so it is locked and hit. WITHOUT the sensor the prey is
    // both unseen (beyond 5000 m) and below the 60000 * 0.5 = 30000 m acquire, so
    // the uplift is exactly what defeats the signature. Beam reaches 35000 m.
    const ships = [
      ship({
        id: "hunter",
        side: "attacker",
        x: 0,
        facing: 0,
        weapons: [beam({ range: 35000 })],
        extra: [
          moduleOf(
            "snr",
            { kind: "sensor", sensorType: "omni", arc: Math.PI, bearing: 0, detectionRange: 40000, nebulaImmune: false },
            2,
            0,
            50,
            5,
            0,
          ),
        ],
      }),
      ship({
        id: "prey",
        side: "defender",
        x: 31000,
        facing: Math.PI,
        extra: [
          moduleOf("sig", { kind: "signature", acquisitionMultiplier: 0.5 }, 2, 0, 50, 5, 0),
        ],
      }),
    ];
    const result = runBattle(inputs(ships));
    expect(tookDamage(result, "prey")).toBe(true);
  });
});

describe("engine.stealth – determinism", () => {
  it("two identical runs with stealth modules produce byte-identical frames", () => {
    const ships = [
      ship({
        id: "hunter",
        side: "attacker",
        x: 0,
        facing: 0,
        weapons: [beam()],
        extra: [
          moduleOf(
            "snr",
            { kind: "sensor", sensorType: "omni", arc: Math.PI, bearing: 0, detectionRange: 100, nebulaImmune: false, pierceCloak: true },
            2,
            0,
            50,
            5,
            0,
          ),
        ],
      }),
      ship({
        id: "prey",
        side: "defender",
        x: 300,
        facing: Math.PI,
        weapons: [beam()],
        extra: [
          moduleOf("clk", { kind: "cloak", decloakTicks: 5 }, 2, 0, 50, 5, 0),
          moduleOf("sig", { kind: "signature", acquisitionMultiplier: 0.5 }, 3, 0, 50, 5, 0),
        ],
      }),
    ];
    const run1 = runBattle(inputs(ships, 40, 13));
    const run2 = runBattle(inputs(ships, 40, 13));
    expect(run1.frames).toEqual(run2.frames);
    expect(run1.winner).toBe(run2.winner);
  });
});
