import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { BattleAnomalyKind } from "@/schema/battle";
import type { CellEdges } from "@/schema/grid";
import type { Doctrine } from "@/schema/ai";
import type {
  CommsEffect,
  ModuleEffect,
  SensorEffect,
  WeaponEffect,
} from "@/schema/module";
import type { ShipStats } from "@/domain/stats";
import type { runBattle } from "@/domain/simulation/engine";

/**
 * Shared fixture builders and snapshot query helpers for the awareness-phase
 * tests. The awareness phase is a pure function of ship state + occluders +
 * anomaly that draws ZERO times from the battle rng, so two runs with the same
 * seed must produce byte-identical `frames[*].awareness`.
 *
 * Ships are built stationary (zero thrust/turn) so geometry is fully under the
 * fixtures' control and the awareness assertions are about position, not drift.
 */

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

export function statsFor(structure: number, cost = 100): ShipStats {
  return {
    mass: 10,
    cost,
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
    deflectorCapacity: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    // Zero thrust and turn rate keep every fixture ship stationary so the
    // geometry the awareness assertions rely on never drifts.
    thrust: 0,
    turnRate: 0,
    weapons: [],
    compartments: 0,
    airtightCompartments: 0,
  };
}

const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

export function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  opts: {
    powerDraw?: number;
    crewRequired?: number;
    command?: boolean;
    channel?: number;
    commsBearing?: number;
    commsRange?: number;
    sensorBearing?: number;
    sensorRangeSetting?: number;
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
    surface: "deck",
    edges: OPEN_EDGES,
    maxSurfaceHp: 0,
    maxSubstrateHp: 50,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    mass: 5,
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
    // For a comms module these carry the link config; for everything else they
    // are 0 and unused. The engine reads `channel`/`commsBearing` off the
    // resolved module directly, so the test sets them per-instance here.
    channel: effect.kind === "comms" ? opts.channel ?? 0 : 0,
    commsBearing: effect.kind === "comms" ? opts.commsBearing ?? effect.bearing : 0,
    ...(opts.commsRange !== undefined ? { commsRange: opts.commsRange } : {}),
    // A sensor module's mount bearing: the per-instance override when given,
    // else the effect's own bearing. 0 and unused on every other kind.
    sensorBearing: effect.kind === "sensor" ? opts.sensorBearing ?? effect.bearing : 0,
    ...(opts.sensorRangeSetting !== undefined
      ? { sensorRangeSetting: opts.sensorRangeSetting }
      : {}),
  };
}

/** An omni sensor of the given range (a full circle), unless overridden. Most
 *  fixtures want all-round detection so the geometry under test is range, not
 *  arc; the directional/variable tests pass explicit overrides. */
export function sensor(
  detectionRange: number,
  over: Partial<SensorEffect> = {},
): SensorEffect {
  return {
    kind: "sensor",
    sensorType: "omni",
    // Omni: half-arc PI = full circle. Directional/dish narrow this.
    arc: Math.PI,
    bearing: 0,
    nebulaImmune: false,
    detectionRange,
    ...over,
  };
}

export function comms(over: Partial<CommsEffect> & { commsType: CommsEffect["commsType"] }): CommsEffect {
  return {
    kind: "comms",
    range: 500,
    // Omni: half-arc PI = full circle. Directional/dish/laser narrow this.
    arc: Math.PI,
    bearing: 0,
    channel: 0,
    bandwidth: 16,
    ...over,
  };
}

export function beam(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 30,
    range: 600,
    cooldown: 2,
    projectileSpeed: 0,
    projectileMass: 0.5,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    facing: 0,
    powered: false,
    guided: false,
    thrust: 0,
    burnTicks: 0,
    ...over,
  };
}

/**
 * Default doctrine for awareness fixtures. The legacy `defaultOrders` these
 * fixtures replaced set `engageRange: "hold"` (overriding the schema's "medium")
 * so stationary geometry is fully under the fixtures' control; the equivalent
 * doctrine base station-keeps within the legacy default band (0.3) of its
 * target. An empty base would also fall through to the engine's balanced
 * defaults, but stating `hold` here keeps the stationarity intent explicit.
 */
const HOLD_DOCTRINE: Doctrine = {
  base: {
    spatial: {
      reference: { kind: "target" },
      range: { kind: "hold", band: 0.3 },
      bearing: { kind: "free" },
    },
  },
  rules: [],
};

export function ship(
  id: string,
  side: "attacker" | "defender",
  x: number,
  y: number,
  modules: ResolvedModule[],
  opts: {
    cost?: number;
    facing?: number;
    /** Per-ship doctrine override; defaults to {@link HOLD_DOCTRINE}. */
    doctrine?: Doctrine;
    /** Optional initial velocity (world units/tick); defaults to a stationary
     *  start. Lets a fixture fly a bright source past an observer to exercise
     *  dazzle recovery over time. */
    velocity?: { x: number; y: number };
  } = {},
): CombatShip {
  return {
    instanceId: id,
    designId: `d-`,
    faction: "Terran",
    side,
    stats: statsFor(100_000, opts.cost ?? 100),
    position: { x, y },
    facing: opts.facing ?? (side === "attacker" ? 0 : Math.PI),
    ...(opts.velocity !== undefined ? { velocity: opts.velocity } : {}),
    doctrine: opts.doctrine ?? HOLD_DOCTRINE,
    classification: "frigate",
    modules,
  };
}

/** A bridge + reactor so a ship's weapons can coordinate and draw power. */
export function core(): ResolvedModule[] {
  return [
    moduleOf("cmd", { kind: "power", output: 200 }, 0, 0, { command: true }),
  ];
}

/** Most awareness assertions only inspect tick 0 (the opening fog snapshot),
 *  so the default run is short — these stationary fixtures never resolve on
 *  their own (no/weak weapons), and a full-length run would just spin the
 *  awareness phase needlessly. Tests that need to watch behaviour over time
 *  (ghost fade, accumulating damage) pass an explicit longer cap. */
export const SHORT_TICKS = 3;

export function inputs(
  ships: CombatShip[],
  anomalies: BattleAnomalyKind[] = [],
  maxTicks: number = SHORT_TICKS,
): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomalies,
    seed: 7,
    maxTicks,
  };
}

// ---------------------------------------------------------------------------
// Snapshot query helpers
// ---------------------------------------------------------------------------

export function awarenessAt(result: ReturnType<typeof runBattle>, tick: number) {
  const frame = result.frames[tick];
  if (frame === undefined) throw new Error(`no frame ${tick}`);
  const a = frame.awareness;
  if (a === undefined) throw new Error(`frame ${tick} has no awareness`);
  return a;
}

export function contactsOf(
  result: ReturnType<typeof runBattle>,
  tick: number,
  observerId: string,
): string[] {
  return awarenessAt(result, tick)
    .contacts.filter((c) => c.observerId === observerId)
    .map((c) => c.enemyId)
    .sort();
}

export function ghostsOf(
  result: ReturnType<typeof runBattle>,
  tick: number,
  observerId: string,
): { enemyId: string; ticksLeft: number }[] {
  return awarenessAt(result, tick)
    .ghosts.filter((g) => g.observerId === observerId)
    .map((g) => ({ enemyId: g.enemyId, ticksLeft: g.ticksLeft }));
}

export function linksOf(result: ReturnType<typeof runBattle>, tick: number) {
  return awarenessAt(result, tick).links;
}

export function structureOf(
  result: ReturnType<typeof runBattle>,
  tick: number,
  id: string,
): number {
  const frame = result.frames[tick];
  return frame?.ships.find((s) => s.instanceId === id)?.structure ?? 0;
}
