import type { ShipStats } from "@/domain/stats";
import type { Orders } from "@/schema/fleet";
import type { ShipClassification } from "@/schema/hull";
import type { ModuleEffect } from "@/schema/module";
import type { BattleAnomaly, BattleSide } from "@/schema/battle";
import type { Vec2 } from "@/schema/primitives";

/**
 * A ship fully resolved for combat: identity + aggregate stats + deployment +
 * orders. This is the runtime unit the simulation pushes around; it carries no
 * rendering concerns.
 */
export interface CombatShip {
  instanceId: string;
  designId: string;
  side: "attacker" | "defender";
  stats: ShipStats;
  position: Vec2;
  facing: number;
  orders: Orders;
  classification: ShipClassification;
  /**
   * Per-module instances with their initial hit points and the module effect,
   * built from the ShipDesign by the resolver. When present, the engine
   * runs the per-module damage / fire / regen model: each module can be
   * destroyed independently, contributing to per-tick aggregate recompute.
   * When absent, the engine uses the aggregated model for backward compat.
   */
  modules?: ResolvedModule[];
}

/** Per-module initial state, built from a ShipDesign by the resolver. */
export interface ResolvedModule {
  /** Stable per-cell identifier, derived from the grid coordinates
   *  (`cell-<col>-<row>`). Used by the engine and snapshots to track a cell
   *  across ticks; not a hull slot any more. */
  slotId: string;
  moduleId: string;
  kind: ModuleEffect["kind"];
  /** Integer grid coordinates of the cell this module occupies. Carried
   *  through to break-apart so 4-connected adjacency is exact, with no
   *  rounding of the ship-local world position. */
  col: number;
  row: number;
  /** Ship-local centre position of the cell (from `cellToLocal`) for hit
   *  selection, muzzle offsets, and rendering. */
  x: number;
  y: number;
  /** Starting (and maximum) hit points. */
  maxHp: number;
  /** Mass contributed to the ship's total mass. */
  mass: number;
  /** Power drawn from the reactor each tick to run this module. */
  powerDraw: number;
  /**
   * Crew that must occupy this module's cell for it to function. Copied off the
   * module definition (`ModuleDefinition.crewRequired`); 0 means the module
   * needs no crew and is always considered manned. Drives the runtime manning
   * gate in the engine.
   */
  crewRequired: number;
  /** The module's effect (weapon/shield/armour/engine/power/crew/repair). */
  effect: ModuleEffect;
  /** Whether this module is a bridge / command module. */
  command: boolean;
  /**
   * Per-tick HP healed to one damaged module on the same ship. Non-zero only
   * for repair modules; every other kind reads it as 0. Copied off the
   * module definition by the resolver so the per-tick loop doesn't have to
   * re-derive it from the effect.
   */
  repairRate: number;
  /**
   * For directional shields: the arc (radians) within which the shield
   * intercepts incoming fire. Defaults to 2π (full sphere, omnidirectional).
   * Only meaningful for shield modules; harmless on other kinds.
   */
  shieldArc: number;
  /** For directional shields: the direction the arc points (radians). */
  shieldFacing: number;
  /**
* For directional thrusters: the direction the engine thrusts, in
   * radians, ship-local. Default 0 (forward, +x). Each alive engine
   * contributes its force vector at its lever arm; the net force drives
   * linear acceleration and the net torque about the ship's centre drives
   * angular acceleration.
   */
  facing: number;
  /**
   * For weapon modules: the direction (radians, ship-local) the weapon fires
   * relative to the host ship's heading. Defaults to 0 (fires along +x in
   * ship-local space, i.e. forward). A side-mounted weapon has facing π/2
   * (left) or -π/2 (right); a rear-mounted weapon has facing π. The engine
   * adds this offset to the ship's world heading when spawning a projectile
   * or computing a hitscan shot direction. Only meaningful for weapon
   * modules; harmless on other kinds (default 0).
   */
  weaponFacing: number;
  /**
   * Turret traverse half-arc (radians, ship-local) about `weaponFacing`, and
   * slew speed (radians per tick). A `turretTurnRate` of 0 is a fixed mount:
   * the barrel never leaves `weaponFacing`. Copied off the weapon effect by
   * the resolver so the engine doesn't re-derive them from the effect each
   * tick. Both default to 0 on non-turret weapons and on non-weapon modules.
   */
  turretArc: number;
  turretTurnRate: number;
  /**
   * Comms channel for a comms module: the per-instance `channel` override from
   * the grid cell when present, else the comms effect's own `channel`. Two
   * comms units link only on a matching channel. Carried here so the engine's
   * awareness phase never has to reach back into the grid. On non-comms modules
   * this is 0 and is never read.
   */
  channel: number;
  /**
   * Mount bearing (radians, ship-local) a comms module's antenna points along:
   * the per-instance `commsBearing` override from the grid cell when present,
   * else the comms effect's `bearing`. Combined with the ship's facing to give
   * the world-space arc the unit covers (a steerable dish overrides this with a
   * live auto-aimed angle each tick). On non-comms modules this is 0 and unused.
   */
  commsBearing: number;
  /**
   * Per-instance range setting for a `variable`-type comms module (world units),
   * from the grid cell. Undefined when the cell did not set one (or the module
   * is not a variable comms unit); the engine then derives the effective range
   * from the effect's own bounds. Only meaningful for variable comms modules.
   */
  commsRange?: number;
  /**
   * Mount bearing (radians, ship-local) a sensor module's cone points along:
   * the per-instance `sensorBearing` override from the grid cell when present,
   * else the sensor effect's `bearing`. Combined with the ship's facing to give
   * the world-space cone the sensor sweeps. On non-sensor modules this is 0 and
   * unused.
   */
  sensorBearing: number;
  /**
   * Per-instance range setting for a `variable`-type sensor module (world units),
   * from the grid cell. Undefined when the cell did not set one (or the module
   * is not a variable sensor unit); the engine then derives the effective range
   * from the effect's own bounds. Only meaningful for variable sensor modules.
   */
  sensorRangeSetting?: number;
}

/**
 * A crew member aboard a ship: a physical entity that walks the walkable
 * interior (alive cells) to man stations and haul resources. Position is an
 * integer cell `(col, row)` — the single source of truth for everything the
 * engine decides — plus a fractional within-cell offset `(ox, oy)` carried
 * only so the renderer can interpolate smooth motion between cell steps.
 *
 * All crew decisions are made in a fixed iteration order (crew sorted by id,
 * modules scanned in `(col, row)` order) so the simulation stays a pure
 * deterministic function of its inputs: no RNG, no Map/Set insertion order,
 * no wall-clock.
 */
export interface SimCrew {
  /** Stable id, unique within the run: `<instanceId>-crew-<n>`. Drives the
   *  fixed iteration order for deterministic job assignment. */
  id: string;
  /** Integer cell the crew member currently occupies. The source of truth for
   *  manning and hauling; render position derives from this plus `(ox, oy)`. */
  col: number;
  row: number;
  /** Fractional offset within the cell (0..1 on each axis) for render smoothing
   *  only; never read by any gameplay decision. */
  ox: number;
  oy: number;
  hp: number;
  /** What the crew member is doing this tick. `idle` has no assignment;
   *  `manning` is occupying its target station cell; `haulAmmo` / `haulPower`
   *  are carrying (or fetching) a resource along `path`. */
  job: "idle" | "manning" | "haulAmmo" | "haulPower";
  /** Remaining steps to walk, one cell consumed per tick. Empty when at rest
   *  or already on the target cell. Read from `pathIndex` onward — the array is
   *  never mutated after assignment, so it can be shared from the path cache
   *  without copying. `pathIndex` advances one step per tick in `advanceCrew`
   *  and resets to 0 whenever a new path is assigned. */
  path: { col: number; row: number }[];
  /** Index into `path` of the next cell to step onto. `advanceCrew` increments
   *  this instead of slicing the array, avoiding a per-tick allocation for every
   *  walking crew member. The remaining steps are `path.length - pathIndex`. */
  pathIndex: number;
  /** The cell this crew member is currently walking to, addressed by the
   *  occupant module's `slotId`. For a haul job this names the current leg's
   *  destination: the source while fetching, the sink while delivering.
   *  Undefined when idle. */
  targetSlotId?: string;
  /** For a haul job, the slot id of the final delivery sink (the dry weapon for
   *  an ammo run, the starved module for a power run). Held separately from
   *  `targetSlotId` so the two-leg journey — fetch at the source, deliver to the
   *  sink — needs no hidden state. Undefined when not hauling. */
  haulSinkSlotId?: string;
  /** A resource physically in hand: set when the crew member has picked up at a
   *  source and is en route to a sink; cleared on deposit. */
  carrying?: "ammo" | "power";
  /** The quantity picked up at the source, deposited verbatim at the sink, so a
   *  run neither creates nor loses rounds/charge. Set with `carrying`, cleared
   *  on deposit. */
  carryAmount?: number;
}

/** Everything the simulator needs to run a deterministic battle. */
export interface BattleInputs {
  ships: CombatShip[];
  attackerFleetId: string;
  defenderFleetId: string;
  anomaly: BattleAnomaly;
  seed: number;
  maxTicks: number;
}

/**
 * Canonical fixed sim tick rate. The engine produces exactly one BattleFrame
 * per tick; the UI maps playback-seconds to ticks through this constant.
 */
export const TICKS_PER_SECOND = 30;

/** Safety cap so a stalemated battle terminates. ~2 min at TICKS_PER_SECOND. */
export const DEFAULT_MAX_TICKS = 3600;

/**
 * Frame batch size for streaming. Four seconds of playback per batch — large
 * enough that each batch provides a comfortable playback buffer (so the
 * playhead never catches the streamed leading edge between batches), while
 * keeping batches infrequent enough that the per-batch React re-render
 * (updating frame count, bounds, status) doesn't contend with the worker's
 * postMessage delivery. Smaller values (e.g. one second) cause the main
 * thread to render on every batch, blocking subsequent batch delivery and
 * producing the start-then-buffer stutter on crewed battles.
 */
export const FRAMES_PER_BATCH = TICKS_PER_SECOND * 4;

/** Terminal value produced by the streaming generator: battle outcome and duration. */
export interface BattleSummary {
  winner: BattleSide;
  ticks: number;
}
