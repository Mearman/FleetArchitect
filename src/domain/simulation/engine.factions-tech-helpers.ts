/**
 * Shared helpers for the split factions-tech engine tests.
 *
 * Extracted verbatim from the original engine.factions-tech.unit.test.ts so
 * every describe block keeps its assertions, fixtures, and setup identical.
 */

import { ACCEL_PER_TICK_FROM_SI } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { CellEdges } from "@/schema/grid";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipClassification } from "@/schema/armor";
import { defaultOrders } from "@/schema/fleet";
import type { Orders } from "@/schema/fleet";
import type { ShipStats } from "@/domain/stats";
import { CELL_SIZE } from "@/domain/grid";
import type { runBattle } from "@/domain/simulation/engine";

/** Cell pitch (world units) these fixtures lay their grid cells out on. Kept
 *  at twice the engine cell size so a fixture's cells sit two contact-distances
 *  apart — the spacing the original fixtures used (`24` at the former 12 m cell)
 *  — now expressed against `CELL_SIZE` so it tracks the metre scale instead of
 *  baking in a stale literal. */
const FIXTURE_CELL_PITCH = CELL_SIZE * 2;

/** All-open deck edges for test fixtures. */
const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

export function beam(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 10,
    range: 400,
    cooldown: 5,
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

export function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  maxHp = 50,
  mass = 5,
  powerDraw = 0,
  maxSurfaceHp = 0,
): ResolvedModule {
  // For engine modules, carry the effect's `facing` onto the ResolvedModule so
  // `toSimModule` copies it to `SimModule.facing`, which `cellThrustForceAndTorque`
  // reads to compute the force direction. Default 0 (exhaust forward = thrust
  // backward) unless the effect overrides it. Rear engines use `facing: Math.PI`.
  const engineFacing = effect.kind === "engine" ? (effect.facing ?? 0) : 0;
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    x: col * FIXTURE_CELL_PITCH,
    y: row * FIXTURE_CELL_PITCH,
    // Only crew quarters are airtight, walkable decks; structural, engine, and
    // weapon cells are bare framing. Marking every fixture cell a deck (as this
    // helper once did) made each test ship one fully-pressurised volume that
    // vented its entire atmosphere — and recoiled — through any battle-damage
    // breach, which real designs (where `deck` is reserved for crew floors) never
    // do. Crew-walkability tests build `crew` cells, which stay decks.
    surface: effect.kind === "crew" ? "deck" : "bare",
    edges: OPEN_EDGES,
    maxSurfaceHp,
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

/**
 * A command module (bridge) — required by the per-module firing path. Without
 * this, `hasAliveCommand` returns false and the modular ship cannot fire at all.
 */
export function commandModule(col: number, row: number): ResolvedModule {
  return {
    ...moduleOf("cmd", { kind: "hull" }, col, row, 50, 5, 0),
    command: true,
  };
}

/**
 * Moment of inertia of a set of resolved modules about their mass-weighted
 * centroid, mirroring `recomputeAggregates`'s derivation: Σ m·|r − r_com|².
 * Used to size a reaction wheel so a test fixture's angular agility matches
 * a requested `turnRate` regardless of the grid's layout.
 */
function momentOfInertiaOf(modules: readonly ResolvedModule[]): number {
  let massSum = 0;
  let mx = 0;
  let my = 0;
  for (const m of modules) {
    massSum += m.mass;
    mx += m.mass * m.x;
    my += m.mass * m.y;
  }
  if (massSum <= 0) return 1;
  const cx = mx / massSum;
  const cy = my / massSum;
  let moi = 0;
  for (const m of modules) {
    const dx = m.x - cx;
    const dy = m.y - cy;
    moi += m.mass * (dx * dx + dy * dy);
  }
  return Math.max(moi, 1);
}


export function baseStats(over: Partial<ShipStats> = {}): ShipStats {
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
    thrust: 0.8,
    turnRate: 0.15,
    weapons: [],
    compartments: 0,
    airtightCompartments: 0,
    ...over,
  };
}

export function inputs(
  ships: CombatShip[],
  maxTicks = 200,
  seed = 1,
): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomaly: "none",
    seed,
    maxTicks,
  };
}

/** Find a ship's state in a frame at a given tick. */
export function shipAt(
  result: ReturnType<typeof runBattle>,
  tick: number,
  id: string,
) {
  const frame = result.frames.find((f) => f.tick === tick);
  if (frame === undefined) throw new Error(`no frame at tick ${tick}`);
  const ship = frame.ships.find((s) => s.instanceId === id);
  if (ship === undefined) throw new Error(`ship ${id} missing from tick ${tick}`);
  return ship;
}

/**
 * Build a minimal modular CombatShip from legacy-style scalar opts.
 *
 * The engine's per-module path is the only supported one for real ships
 * (the legacy aggregated path is gone). Tests that used to build a
 * non-modular CombatShip — handing `stats.thrust` / `stats.turnRate` /
 * `stats.shieldCapacity` and expecting the engine to apply them directly —
 * must instead provide modules whose effects aggregate to the same values.
 * This helper wires up a compact grid that does so:
 *
 *  - a command (bridge) cell at the origin — required for `hasAliveCommand`,
 *  - a rear-facing engine cell carrying `opts.thrust` (exhaust aft ⇒ forward),
 *  - a reaction-wheel cell sized so angular agility scales with `opts.turnRate`,
 *  - an omni sensor cell so the ship acquires targets at any test range,
 *  - one cell per weapon in `opts.weapons`,
 *  - a shield cell when `opts.shield > 0`.
 *
 * `stats.thrust` mirrors the engine's thrust so `recomputeAggregates`'s
 * `hullBaseThrust` floor is zero and the live thrust equals `opts.thrust`;
 * the shield stats likewise mirror the shield module so the shield pool
 * starts full at `opts.shield`. Modules are crewless and draw-free, so they
 * are always manned and charged and never go idle.
 */
export function modularShip(opts: {
  id: string;
  side: "attacker" | "defender";
  x: number;
  y: number;
  facing?: number;
  structure?: number;
  shield?: number;
  shieldRechargeRate?: number;
  shieldRechargeDelay?: number;
  damageReduction?: number;
  thrust?: number;
  turnRate?: number;
  weapons?: WeaponEffect[];
  classification?: ShipClassification;
  orders?: Partial<Orders>;
  /** Substrate HP of the hull/engine/sensor cells. Defaults to 50. Set to 0
   *  for a target dummy whose modules should be transparent to damage so
   *  every hit flows through to hull structure (mirroring the legacy
   *  aggregated damage sink). A 0-HP cell is alive for collision/radius but
   *  passes all damage through `damageCell` on the first hit. */
  moduleHp?: number;
}): CombatShip {
  const prefix = opts.id;
  const weapons = opts.weapons ?? [];
  const thrust = opts.thrust ?? 0;
  const turnRate = opts.turnRate ?? 0;
  const shieldCapacity = opts.shield ?? 0;
  const moduleHp = opts.moduleHp ?? 50;
  const modules: ResolvedModule[] = [
    // Command bridge — also gives the ship a non-zero footprint and mass.
    {
      ...moduleOf(`${prefix}-cmd`, { kind: "hull" }, 0, 0, moduleHp, 5, 0),
      command: true,
    },
  ];
  // Engines. A competent combat ship mounts drive in BOTH directions: a rear
  // engine (exhaust aft, facing PI) for prograde thrust along +x, and a fore
  // braking engine (exhaust forward, facing 0) for retrograde thrust along -x.
  // Symmetric thrust means the ship decelerates as fast as it accelerates and
  // brakes directly along its heading — no flip-and-burn, no lateral-thrust
  // injection from sweeping the nozzle mid-turn, precise stop-in-time
  // range-keeping with no oscillation. A rear-only ship (the `rammer` fixture,
  // or one that has lost its fore drive to damage) must flip PI to brake and is
  // correspondingly less precise; that path is covered by the rammer and the
  // aft-only branches of the movement controller.
  if (thrust > 0) {
    modules.push(
      moduleOf(
        `${prefix}-eng`,
        { kind: "engine", thrust, facing: Math.PI },
        -1,
        0,
        moduleHp,
        5,
        0,
      ),
      moduleOf(
        `${prefix}-brk`,
        { kind: "engine", thrust, facing: 0 },
        1,
        0,
        moduleHp,
        5,
        0,
      ),
      // Lateral (RCS translation) thrusters: two balanced pairs at ±x, each
      // pair facing the same lateral direction so their firing torques cancel
      // (pure lateral force, no spin). RCS mass is low (1 each) — translation
      // thrusters are small compared to the main drive. The +y pair (facing −π/2, exhaust −y ⇒
      // force +y) and the −y pair (facing π/2 ⇒ force −y) give bidirectional
      // lateral thrust, letting the ship cancel perpendicular drift without
      // turning away from its target — so facing (to aim weapons) and
      // translation (to station-keep) are decoupled.
      moduleOf(`${prefix}-lp1`, { kind: "engine", thrust, facing: -Math.PI / 2 }, 2, 0, moduleHp, 1, 0),
      moduleOf(`${prefix}-lp2`, { kind: "engine", thrust, facing: -Math.PI / 2 }, -2, 0, moduleHp, 1, 0),
      moduleOf(`${prefix}-lm1`, { kind: "engine", thrust, facing: Math.PI / 2 }, 2, 0, moduleHp, 1, 0),
      moduleOf(`${prefix}-lm2`, { kind: "engine", thrust, facing: Math.PI / 2 }, -2, 0, moduleHp, 1, 0),
    );
  }
  // Reaction wheel: pure commandable torque, available whether or not the
  // ship is thrusting. Sized so the ship's per-tick angular acceleration matches
  // the requested `turnRate` directly. The integrator rescales an SI torque into
  // the per-tick clock (alpha_tick = (torque / MoI) * ACCEL_PER_TICK_FROM_SI), so
  // to hit a target alpha of `turnRate` rad/tick² the SI torque is
  // `turnRate * MoI / ACCEL_PER_TICK_FROM_SI` — which also lands the wheel on the
  // catalogue's real SI N·m scale. `turnRate` is a physical angular acceleration
  // (rad/tick^2), not a legacy feel scalar. Computing MoI from the real cell
  // distribution keeps the agility comparable however the grid is laid out.
  if (turnRate > 0) {
    // Preview the reaction wheel's own cell so MoI accounts for it.
    const preview = moduleOf(
      `${prefix}-rw`,
      { kind: "reactionWheel", torque: 0 },
      0,
      -1,
      moduleHp,
      5,
      0,
    );
    const moi = momentOfInertiaOf([...modules, preview]);
    // Target per-tick alpha = turnRate (rad/tick^2); the integrator applies
    // ACCEL_PER_TICK_FROM_SI, so the SI torque is turnRate * MoI / that factor.
    const torque = (moi * turnRate) / ACCEL_PER_TICK_FROM_SI;
    modules.push(
      moduleOf(
        `${prefix}-rw`,
        { kind: "reactionWheel", torque },
        0,
        -1,
        moduleHp,
        5,
        0,
      ),
    );
  }
  // Omni sensor so the ship acquires enemies at any separation the tests
  // use (the innate visual circle alone is too short for the wide fixtures).
  modules.push(
    moduleOf(
      `${prefix}-sen`,
      {
        kind: "sensor",
        sensorType: "omni",
        arc: Math.PI,
        bearing: 0,
        detectionRange: 4000,
        nebulaImmune: false,
      },
      0,
      1,
      moduleHp,
      5,
      0,
    ),
  );
  // Weapon modules — the per-module fire path rebuilds `ship.weapons` from
  // these, so the stats-level weapon list no longer drives firing.
  for (let i = 0; i < weapons.length; i += 1) {
    const w = weapons[i];
    if (w === undefined) continue;
    modules.push(moduleOf(`${prefix}-w${i}`, w, -2 - i, 0, moduleHp, 5, 0));
  }
  // Shield module — its `capacity` becomes the ship's shield pool. The
  // stats-level shieldCapacity mirrors it so the initial shield value
  // (set in toSimShip before recompute) already matches the pool ceiling.
  if (shieldCapacity > 0) {
    modules.push(
      moduleOf(
        `${prefix}-shd`,
        {
          kind: "shield",
          capacity: shieldCapacity,
          rechargeRate: opts.shieldRechargeRate ?? 0,
          rechargeDelay: opts.shieldRechargeDelay ?? 60,
        },
        -1,
        -1,
        50,
        5,
        0,
      ),
    );
  }
  const stats: ShipStats = baseStats({
    mass: 10,
    structure: opts.structure ?? 100,
    damageReduction: opts.damageReduction ?? 0,
    thrust,
    turnRate,
    shieldCapacity,
    shieldRechargeRate: opts.shieldRechargeRate ?? 0,
    shieldRechargeDelay: opts.shieldRechargeDelay ?? 60,
    weapons: weapons.map((w) => ({ slotId: `${prefix}-w`, effect: w })),
  });
  return {
    instanceId: opts.id,
    designId: `design-${opts.id}`,
    faction: "test",
    side: opts.side,
    stats,
    position: { x: opts.x, y: opts.y },
    facing: opts.facing ?? 0,
    orders: { ...defaultOrders, ...opts.orders },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    classification: opts.classification ?? "frigate",
    modules,
  };
}

/**
 * Build a target-dummy CombatShip: a modular ship that is hittable but
 * routes incoming damage straight to hull structure (after any pooled
 * shield), mirroring the legacy aggregated damage sink that several engine
 * tests were written against.
 *
 * The layout places a high-HP command bridge one row off the ship's
 * primary axis so it is never on a projectile's penetration path (the
 * path only includes cells within half a cell of the line of fire). A
 * row of zero-HP hull cells sits ON the axis: each is alive for the
 * collision hash (so the ship is hittable) but `damageCell` kills it
 * instantly and passes the full amount through, so the shot reaches
 * `spillToStructure` undiminished. The bridge survives every hit, so
 * `hasAliveCommand` stays true and the break-apart pass (which kills a
 * ship whose every module is dead) never fires — the dummy stays alive
 * and on the board for the whole battle.
 *
 * `facing` defaults to π so the dummy faces the attacker (its forward
 * axis points toward decreasing x, where incoming fire comes from),
 * matching the orientation the legacy fixtures used.
 */
export function targetDummy(opts: {
  id: string;
  side: "attacker" | "defender";
  x: number;
  y: number;
  facing?: number;
  structure?: number;
  shield?: number;
  shieldRechargeRate?: number;
  shieldRechargeDelay?: number;
  damageReduction?: number;
  classification?: ShipClassification;
  orders?: Partial<Orders>;
  /** How many hull cells line the primary axis. More cells means more hits
   *  reach structure before the axis is shot clear and the dummy stops
   *  presenting an on-line target. Defaults to 5. */
  absorbingCells?: number;
  /** Surface (armour) layer HP of each on-axis absorbing cell. Defaults to 0
   *  (bare cells, no surface layer). Set above zero to model a cell whose
   *  armour depletes before its substrate or underlying structure takes damage. */
  absorbingSurfaceHp?: number;
  /** Substrate HP of each on-axis absorbing cell. Defaults to 0 (cells die on
   *  first contact and pass all damage onward). Set above zero so cells absorb
   *  multiple shots before dying, for fixture patterns that count landed hits
   *  rather than structure decrements. */
  absorbingSubstrateHp?: number;
}): CombatShip {
  const prefix = opts.id;
  const shieldCapacity = opts.shield ?? 0;
  const absorbingCount = opts.absorbingCells ?? 5;
  const absorbingSurfaceHp = opts.absorbingSurfaceHp ?? 0;
  const absorbingSubstrateHp = opts.absorbingSubstrateHp ?? 0;
  const modules: ResolvedModule[] = [
    // Bridge one row off the primary (x) axis: alive and high-HP so the
    // ship never dies from losing its on-axis cells. At row 1 its world-y
    // is one cell off the line of fire, so `penetrationPath` excludes it.
    {
      ...moduleOf(`${prefix}-cmd`, { kind: "hull" }, 0, 1, 99999, 5, 0),
      command: true,
    },
    // A high-HP keeper cell one row further off-axis, edge-adjacent to the
    // bridge. When the on-axis absorbing cells die the bridge stays
    // connected to the keeper, so the survivor is a single connected
    // component (no break-apart split) and `hasAliveCommand` keeps the
    // ship on the board.
    moduleOf(`${prefix}-keep`, { kind: "hull" }, 0, 2, 99999, 5, 0),
  ];
  // On-axis hull cells along the primary (row 0) axis. These are the
  // cells a projectile travelling along the ship's facing finds. Defaults
  // mirror the original dummy (0 surface, 0 substrate) so each cell is alive
  // for the collision hash but dies in one tick, passing all damage onward;
  // the surface/substrate options model an armoured or multi-hit cell.
  for (let i = 0; i < absorbingCount; i += 1) {
    modules.push(
      moduleOf(
        `${prefix}-ab${i}`,
        { kind: "hull" },
        i,
        0,
        absorbingSubstrateHp,
        5,
        0,
        absorbingSurfaceHp,
      ),
    );
  }
  if (shieldCapacity > 0) {
    modules.push(
      moduleOf(
        `${prefix}-shd`,
        {
          kind: "shield",
          capacity: shieldCapacity,
          rechargeRate: opts.shieldRechargeRate ?? 0,
          rechargeDelay: opts.shieldRechargeDelay ?? 60,
        },
        -1,
        1,
        99999,
        5,
        0,
      ),
    );
  }
  const stats: ShipStats = baseStats({
    mass: 10,
    structure: opts.structure ?? 100,
    damageReduction: opts.damageReduction ?? 0,
    thrust: 0,
    turnRate: 0,
    shieldCapacity,
    shieldRechargeRate: opts.shieldRechargeRate ?? 0,
    shieldRechargeDelay: opts.shieldRechargeDelay ?? 60,
    weapons: [],
  });
  return {
    instanceId: opts.id,
    designId: `design-${opts.id}`,
    faction: "test",
    side: opts.side,
    stats,
    position: { x: opts.x, y: opts.y },
    facing: opts.facing ?? Math.PI,
    orders: { ...defaultOrders, ...opts.orders },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    classification: opts.classification ?? "frigate",
    modules,
  };
}

