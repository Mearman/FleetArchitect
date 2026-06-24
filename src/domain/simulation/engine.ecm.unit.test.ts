import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { sumCellHp } from "@/domain/simulation/test-cell-helpers";
import { defaultOrders } from "@/schema/fleet";
import type { CellEdges } from "@/schema/grid";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

/**
 * ECM (jamming) and ECCM (counter) in the projectile/weapon path.
 *
 * ECM lives on the TARGET and degrades incoming guided fire two ways: it scales
 * down the tracking a missile spawns with (a softer lock) and, each tick, gives
 * a homing round a chance to lose its lock and go ballistic. ECCM lives on the
 * FIRING ship and restores a fraction of both: the net tracking reduction is
 * max(0, trackingReduction - trackingRestore) and the lock-break chance is
 * scaled by (1 - trackingRestore).
 *
 * Everything is opt-in: with no operational ECM on the target a missile keeps
 * its full tracking and no lock-break rng is drawn, so an ECM-free battle is
 * byte-identical (also guarded by the factions-tech determinism fixtures).
 *
 * The mechanic is observed through homing against a moving prey on a fixed
 * perpendicular crossing course (it faces +y and cannot turn, with a rear-
 * mounted engine thrusting along its heading), so a missile must keep homing to
 * stay on it. Under frictionless Newtonian movement the translation controller
 * only fires the prey's engine when it is closing on an enemy on the bearing the
 * engine can actually serve, so the prey is given a distant lure enemy directly
 * along its +y heading: the controller then advances the prey straight up the y
 * axis at its engine's thrust speed, reproducing the fixed crossing course the
 * old damped "thrust along facing" model gave for free. The lure sits far enough
 * away that the prey never reaches it (so the course stays straight for the whole
 * battle) and is `hold`-ordered and unarmed, so it never influences the duel.
 *
 * Lock-break has a clean, geometry-independent signal: a round that loses its
 * lock goes ballistic and flies past the crossing prey, so a guaranteed
 * lock-break deals strictly less damage than an un-jammed volley, and ECCM that
 * cancels the break-chance restores it. Spawn-time tracking reduction is tested
 * structurally instead of by damage direction (whether a softer lock helps or
 * hurts depends on the exact crossing geometry): with the SAME module layout in
 * every run (only the effect numbers vary), a net-zero ECM/ECCM pair produces
 * byte-identical frames to an un-jammed lock, while an un-countered reduction
 * changes them — proving the reduction is both applied and exactly cancellable.
 */

function missile(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "missile",
    damage: 20,
    range: 6000,
    cooldown: 2,
    projectileSpeed: 30,
    projectileMass: 0.5,
    tracking: 0.5,
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
    surface: "deck",
    edges: OPEN_EDGES,
    maxSurfaceHp: 0,
    maxSubstrateHp: maxHp,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
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
 *  break-apart never splits the ship. */
function rowLayout(weapons: ResolvedModule[], extras: ResolvedModule[]): ResolvedModule[] {
  const ordered: ResolvedModule[] = [
    { ...commandModule(0, 0) },
    { ...moduleOf("p1", { kind: "power", output: 1000 }, 1, 0, 50, 5, 0) },
    // All-round sensor so the ship acquires the target (fog-of-war awareness);
    // without it missiles have no target to home on and ECM is untestable.
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

function ship(opts: {
  id: string;
  side: "attacker" | "defender";
  x: number;
  y?: number;
  facing: number;
  thrust?: number;
  turnRate?: number;
  weapons?: WeaponEffect[];
  extra?: ResolvedModule[];
  orders?: Partial<typeof defaultOrders>;
  velocity?: { x: number; y: number };
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
      thrust: opts.thrust ?? 0,
      turnRate: opts.turnRate ?? 0,
      weapons: weapons.map((w, i) => ({ slotId: `w${i}`, effect: w })),
    }),
    position: { x: opts.x, y: opts.y ?? 0 },
    velocity: opts.velocity,
    facing: opts.facing,
    orders: { ...defaultOrders, ...(opts.orders ?? {}) },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    classification: "frigate",
    modules,
  };
}

function inputs(ships: CombatShip[], maxTicks = 80, seed = 21): BattleInputs {
  // Every battle includes the distant lure so the prey advances on a fixed +y
  // crossing course (see `lure`). It is appended once here so all fixtures —
  // including the determinism guards — share the identical ship set.
  return {
    ships: [...ships, lure()],
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomalies: [],
    seed,
    maxTicks,
  };
}

/** Total structural + module damage the prey took over the whole battle. A
 *  destroyed prey counts its entire starting pool as damage taken. */
function damageTaken(result: ReturnType<typeof runBattle>): number {
  const first = result.frames[0];
  const last = result.frames[result.frames.length - 1];
  if (first === undefined || last === undefined) throw new Error("no frames");
  const start = first.ships.find((s) => s.instanceId === "prey");
  const end = last.ships.find((s) => s.instanceId === "prey");
  if (start === undefined || end === undefined) throw new Error("prey missing");
  const startHp = sumCellHp(start.cells) + start.structure;
  if (!end.alive) return startHp;
  const endHp = sumCellHp(end.cells) + end.structure;
  return startHp - endHp;
}

// Rear-mounted engine (exhaust aft, facing π): thrust drives the ship along its
const ecmModule = (
  over: Partial<{ trackingReduction: number; lockBreakChance: number }> = {},
): ResolvedModule =>
  moduleOf(
    "ecm",
    { kind: "ecm", trackingReduction: 0, lockBreakChance: 0, ...over },
    3,
    0,
    50,
    5,
    0,
  );

const eccmModule = (trackingRestore: number): ResolvedModule =>
  moduleOf("eccm", { kind: "eccm", trackingRestore }, 4, 0, 50, 5, 0);

/** A missile-armed stationary hunter at the origin firing along +x, optionally
 *  with an ECCM module. */
function hunter(extra: ResolvedModule[] = []): CombatShip {
  return ship({ id: "hunter", side: "attacker", x: 0, facing: 0, weapons: [missile()], extra });
}

/** A prey on a fixed perpendicular crossing course, optionally carrying ECM. */
function prey(extra: ResolvedModule[] = []): CombatShip {
  // The prey COASTS across the hunter's line of fire at a constant velocity
  // (initial velocity, no engine). The old damped model gave a constant-speed
  // crossing for free (thrust balanced by drag at terminal velocity);
  // frictionless movement would instead accelerate the prey, changing the
  // missile-engagement geometry. Coasting at a fixed velocity reproduces the
  // constant-speed crossing the ECM homing/lock-break tests are calibrated to,
  // and keeps the prey a closed system whose motion is independent of its ECM
  // loadout.
  return ship({
    id: "prey",
    side: "defender",
    x: 600,
    facing: Math.PI / 2,
    velocity: { x: 0, y: 6 },
    extra,
  });
}

/**
 * A distant, unarmed, hold-ordered lure on the attacker side, directly along the
 * prey's +y heading. It exists only so the translation controller has an enemy
 * to advance the prey toward, driving the prey straight up the y axis at its
 * engine's thrust speed (the fixed crossing course). Placed far enough that the
 * prey never closes on it within the battle, and unarmed + hold so it never
 * fires, moves, or otherwise perturbs the hunter/prey duel.
 */
function lure(): CombatShip {
  return ship({
    id: "lure",
    side: "attacker",
    x: 600,
    y: 100000,
    facing: 0,
    orders: { engageRange: "hold" },
  });
}

describe("engine.ecm – lock break", () => {
  it("a guaranteed lock-break strips homing so missiles fly past the crossing prey", () => {
    const plain = runBattle(inputs([hunter(), prey()]));
    const broken = runBattle(inputs([hunter(), prey([ecmModule({ lockBreakChance: 1 })])]));
    expect(damageTaken(broken)).toBeLessThan(damageTaken(plain));
  });

  it("ECCM that fully cancels the break-chance restores the missiles' lock", () => {
    const broken = runBattle(inputs([hunter(), prey([ecmModule({ lockBreakChance: 1 })])]));
    // trackingRestore 1 scales lockBreakChance by (1 - 1) = 0: locks never break,
    // so the homing volley connects again and the prey takes more damage.
    const countered = runBattle(
      inputs([hunter([eccmModule(1)]), prey([ecmModule({ lockBreakChance: 1 })])]),
    );
    expect(damageTaken(countered)).toBeGreaterThan(damageTaken(broken));
  });
});

describe("engine.ecm – spawn tracking reduction", () => {
  // Every run here carries the SAME module layout (engine + ecm on the prey,
  // eccm on the hunter), so any frame difference is purely the lock maths — no
  // mass/structure change confounds the comparison.
  const run = (trackingReduction: number, trackingRestore: number) =>
    runBattle(
      inputs([
        hunter([eccmModule(trackingRestore)]),
        prey([ecmModule({ trackingReduction })]),
      ]),
    ).frames;

  it("an ECM/ECCM pair that nets to zero reduction homes exactly like no reduction", () => {
    // net = max(0, 0.9 - 0.9) = 0, identical to no reduction at all (0 - 0.9).
    const cancelled = run(0.9, 0.9);
    const noReduction = run(0, 0.9);
    expect(cancelled).toEqual(noReduction);
  });

  it("an un-countered tracking reduction changes the homing outcome", () => {
    // net = max(0, 0.9 - 0) = 0.9 of the lock stripped, versus net 0.
    const reduced = run(0.9, 0);
    const noReduction = run(0, 0);
    expect(reduced).not.toEqual(noReduction);
  });
});

describe("engine.ecm – opt-in / determinism", () => {
  it("a battle with no ECM module is byte-identical across runs", () => {
    const run1 = runBattle(inputs([hunter(), prey()]));
    const run2 = runBattle(inputs([hunter(), prey()]));
    expect(run1.frames).toEqual(run2.frames);
  });

  it("a battle WITH ECM and ECCM is byte-identical across runs", () => {
    const make = () =>
      inputs([
        hunter([eccmModule(0.5)]),
        prey([ecmModule({ trackingReduction: 0.6, lockBreakChance: 0.4 })]),
      ]);
    const run1 = runBattle(make());
    const run2 = runBattle(make());
    expect(run1.frames).toEqual(run2.frames);
  });
});
