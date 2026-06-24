/**
 * Capture and restore an {@link EngineCheckpoint} — the pure bridge between the
 * live {@link EngineState} (plus the RNG and the global projectile counter) and
 * the serialisable checkpoint the storage layer persists.
 *
 * Capture selects the AUTHORITATIVE serialisable fields off the live state and
 * `structuredClone`s them, so the checkpoint owns an independent copy that
 * cannot be mutated by the battle continuing, and so `±Infinity` / `-0` survive
 * (which `JSON` would lose). Every DERIVED cache is dropped — the crew path
 * cache (which holds the non-serialisable `UNREACHABLE` Symbol, so it could not
 * be cloned even if we wanted to), the per-tick awareness Map, the wiring-reach
 * Set, the alive-cell index, the transport graph, and the topology /
 * break-apart fingerprints. The re-derived momentum (`px`/`py`) is dropped too.
 *
 * Restore rebuilds the live entities with those derived caches left `undefined`
 * and the transient `awareness` Map empty; they re-warm byte-identically on the
 * first resumed tick (the deterministic fixed-tie-break A* recomputes the same
 * paths; the awareness phase rebuilds the Map before anything reads it). The
 * builders are typed to RETURN the runtime `SimShip` / `SimModule`, so the
 * compiler rejects a checkpoint missing any authoritative field — the guard that
 * keeps the schema and the runtime types from drifting.
 */

import type {
  CheckpointModule,
  CheckpointShip,
  EngineCheckpoint,
} from "@/schema/checkpoint";
import { CHECKPOINT_VERSION } from "@/schema/checkpoint";
import type { Rng } from "@/domain/simulation/rng";
import { getProjectileCounter } from "./projectile-id";
import { buildHeatCapacity } from "./resource-step";
import type { StalemateWatch } from "./stalemate";
import type { EngineState } from "./state";
import type {
  SimMine,
  SimModule,
  SimPod,
  SimProjectile,
  SimShip,
} from "./types";

/**
 * Snapshot the authoritative serialisable subset of a live ship. Caches and
 * re-derived bookkeeping are omitted: `pathCache`, `topologyFingerprint`,
 * `wiringReach`, `aliveCells`, `resourceGraph`, `breakApartLastAliveCount`,
 * `aliveCount`, the transient `awareness`, and the re-derived `px`/`py`.
 */
function snapshotShip(s: SimShip): CheckpointShip {
  const ship: CheckpointShip = {
    instanceId: s.instanceId,
    faction: s.faction,
    side: s.side,
    classification: s.classification,
    x: s.x,
    y: s.y,
    facing: s.facing,
    velX: s.velX,
    velY: s.velY,
    angVel: s.angVel,
    structure: s.structure,
    maxStructure: s.maxStructure,
    shield: s.shield,
    maxShield: s.maxShield,
    shieldRechargeRate: s.shieldRechargeRate,
    shieldRechargeDelay: s.shieldRechargeDelay,
    shieldRegenCountdown: s.shieldRegenCountdown,
    shieldAdaptiveRamp: s.shieldAdaptiveRamp,
    shieldUntouchedTicks: s.shieldUntouchedTicks,
    auraRangeBonus: s.auraRangeBonus,
    auraAccuracyBonus: s.auraAccuracyBonus,
    armourReduction: s.armourReduction,
    thrust: s.thrust,
    turnRate: s.turnRate,
    engineThrottle: s.engineThrottle,
    mass: s.mass,
    comX: s.comX,
    comY: s.comY,
    momentOfInertia: s.momentOfInertia,
    radius: s.radius,
    dilationFactor: s.dilationFactor,
    cost: s.cost,
    weapons: [...s.weapons],
    weaponCooldowns: [...s.weaponCooldowns],
    orders: s.orders,
    crewPriority: s.crewPriority,
    shipStance: s.shipStance,
    rules: s.rules,
    aiStance: s.aiStance,
    aiFocusFire: s.aiFocusFire,
    aiRetreat: s.aiRetreat,
    aiPrioritiseRepair: s.aiPrioritiseRepair,
    aiRally: s.aiRally,
    alive: s.alive,
    salvageMass: s.salvageMass,
    ghosts: s.ghosts,
    lastFiredTick: s.lastFiredTick,
  };
  if (s.outline !== undefined) ship.outline = s.outline;
  if (s.target !== undefined) ship.target = s.target;
  if (s.claimedBy !== undefined) ship.claimedBy = s.claimedBy;
  if (s.modules !== undefined) ship.modules = s.modules.map(snapshotModule);
  if (s.crew !== undefined) ship.crew = s.crew;
  if (s.hullBaseThrust !== undefined) ship.hullBaseThrust = s.hullBaseThrust;
  if (s.hardwires !== undefined) ship.hardwires = s.hardwires;
  if (s.brokeOff !== undefined) ship.brokeOff = s.brokeOff;
  if (s.phantom !== undefined) ship.phantom = s.phantom;
  if (s.resource !== undefined) {
    ship.resource = {
      // The runtime `moduleIndex` is a `ReadonlyMap`; copy it into a mutable
      // Map so it matches the checkpoint type (and structuredClone copies it
      // again, severing the alias). The mapping is fixed for the ship's life.
      moduleIndex: new Map(s.resource.moduleIndex),
      thermal: s.resource.thermal,
      propellant: s.resource.propellant,
      atmosphere: s.resource.atmosphere,
      powerBuffer: s.resource.powerBuffer,
    };
  }
  return ship;
}

/** Snapshot a module's authoritative state — every field is plain data. */
function snapshotModule(m: SimModule): CheckpointModule {
  const mod: CheckpointModule = {
    slotId: m.slotId,
    moduleId: m.moduleId,
    kind: m.kind,
    col: m.col,
    row: m.row,
    x: m.x,
    y: m.y,
    surface: m.surface,
    edges: m.edges,
    surfaceHp: m.surfaceHp,
    maxSurfaceHp: m.maxSurfaceHp,
    surfaceReduction: m.surfaceReduction,
    reactiveReduction: m.reactiveReduction,
    reactiveWindow: m.reactiveWindow,
    hp: m.hp,
    maxHp: m.maxHp,
    mass: m.mass,
    powerDraw: m.powerDraw,
    effect: m.effect,
    cooldown: m.cooldown,
    ammo: m.ammo,
    ammoStored: m.ammoStored,
    charge: m.charge,
    alive: m.alive,
    powered: m.powered,
    powerCut: m.powerCut,
    fuelStarved: m.fuelStarved,
    manned: m.manned,
    crewRequired: m.crewRequired,
    command: m.command,
    repairRate: m.repairRate,
    shieldArc: m.shieldArc,
    shieldFacing: m.shieldFacing,
    facing: m.facing,
    weaponFacing: m.weaponFacing,
    turretArc: m.turretArc,
    turretTurnRate: m.turretTurnRate,
    turretAngle: m.turretAngle,
    channel: m.channel,
    commsBearing: m.commsBearing,
    dishAngle: m.dishAngle,
    sensorBearing: m.sensorBearing,
    techCooldown: m.techCooldown,
    techActive: m.techActive,
    reactiveCharge: m.reactiveCharge,
    mineCooldown: m.mineCooldown,
    boardingCooldown: m.boardingCooldown,
    exploded: m.exploded,
  };
  if (m.transportIndex !== undefined) mod.transportIndex = m.transportIndex;
  if (m.hardwireSinks !== undefined) mod.hardwireSinks = m.hardwireSinks;
  if (m.hardwireSources !== undefined) mod.hardwireSources = m.hardwireSources;
  if (m.dishRangeSetting !== undefined) mod.dishRangeSetting = m.dishRangeSetting;
  if (m.sensorRangeSetting !== undefined) mod.sensorRangeSetting = m.sensorRangeSetting;
  return mod;
}

/**
 * Capture an end-of-tick checkpoint. `structuredClone` deep-copies the selected
 * authoritative state (preserving `±Infinity`/`-0`) so the checkpoint is
 * independent of the continuing battle. Reads the RNG position and the global
 * projectile counter so resume re-seeds both exactly.
 */
export function captureCheckpoint(
  state: EngineState,
  rng: Rng,
  tick: number,
  stalemate: StalemateWatch | undefined,
): EngineCheckpoint {
  const ships = state.ships.map(snapshotShip);
  const checkpoint: EngineCheckpoint = {
    version: CHECKPOINT_VERSION,
    tick,
    rngState: rng.getState(),
    counters: {
      projectile: getProjectileCounter(),
      chunk: state.chunkSeq,
      mine: state.mineSeq,
      pod: state.podSeq,
      phantom: state.phantomSeq,
      pulse: state.pulseSeq,
      emission: state.emissionSeq,
      debris: state.debrisSeq,
    },
    ticks: state.ticks,
    deployment: state.deployment,
    ships,
    projectiles: state.projectiles,
    mines: state.mines,
    pods: state.pods,
    pulses: state.pulses,
    emissions: state.emissions,
    debris: state.debris,
    beams: state.beams,
  };
  if (stalemate !== undefined) checkpoint.stalemate = stalemate;
  // Deep-clone the whole assembled structure once: it severs every alias to the
  // live arrays/objects above and preserves the non-finite floats and -0 that
  // JSON would discard. The structure is Symbol-free by construction.
  return structuredClone(checkpoint);
}

/**
 * Rebuild a live module from its checkpoint. Every field is authoritative, so
 * this is a near-identity copy; arrays are copied so the restored module does
 * not alias the checkpoint.
 */
function restoreModule(m: CheckpointModule): SimModule {
  const mod: SimModule = {
    slotId: m.slotId,
    moduleId: m.moduleId,
    kind: m.kind,
    col: m.col,
    row: m.row,
    x: m.x,
    y: m.y,
    surface: m.surface,
    edges: m.edges,
    surfaceHp: m.surfaceHp,
    maxSurfaceHp: m.maxSurfaceHp,
    surfaceReduction: m.surfaceReduction,
    reactiveReduction: m.reactiveReduction,
    reactiveWindow: m.reactiveWindow,
    hp: m.hp,
    maxHp: m.maxHp,
    mass: m.mass,
    powerDraw: m.powerDraw,
    effect: m.effect,
    cooldown: m.cooldown,
    ammo: m.ammo,
    ammoStored: m.ammoStored,
    charge: m.charge,
    alive: m.alive,
    powered: m.powered,
    powerCut: m.powerCut,
    fuelStarved: m.fuelStarved,
    manned: m.manned,
    crewRequired: m.crewRequired,
    command: m.command,
    repairRate: m.repairRate,
    shieldArc: m.shieldArc,
    shieldFacing: m.shieldFacing,
    facing: m.facing,
    weaponFacing: m.weaponFacing,
    turretArc: m.turretArc,
    turretTurnRate: m.turretTurnRate,
    turretAngle: m.turretAngle,
    channel: m.channel,
    commsBearing: m.commsBearing,
    dishAngle: m.dishAngle,
    sensorBearing: m.sensorBearing,
    techCooldown: m.techCooldown,
    techActive: m.techActive,
    reactiveCharge: m.reactiveCharge,
    mineCooldown: m.mineCooldown,
    boardingCooldown: m.boardingCooldown,
    exploded: m.exploded,
  };
  if (m.transportIndex !== undefined) mod.transportIndex = m.transportIndex;
  if (m.hardwireSinks !== undefined) mod.hardwireSinks = m.hardwireSinks;
  if (m.hardwireSources !== undefined) mod.hardwireSources = m.hardwireSources;
  if (m.dishRangeSetting !== undefined) mod.dishRangeSetting = m.dishRangeSetting;
  if (m.sensorRangeSetting !== undefined) mod.sensorRangeSetting = m.sensorRangeSetting;
  return mod;
}

/**
 * Rebuild a live ship from its checkpoint. Re-derived momentum (`px`/`py`) is
 * recomputed from the restored velocity and mass — the same value `toSimShip`
 * seeds and the integrator overwrites next tick. Every derived cache
 * (`pathCache`, `topologyFingerprint`, `wiringReach`, `aliveCells`,
 * `resourceGraph`, `breakApartLastAliveCount`, `aliveCount`) is left
 * `undefined` and the transient `awareness` Map empty; they re-warm
 * byte-identically on first touch. The return type is the runtime `SimShip`,
 * so omitting any authoritative field is a compile error.
 */
function restoreShip(s: CheckpointShip): SimShip {
  const ship: SimShip = {
    instanceId: s.instanceId,
    faction: s.faction,
    side: s.side,
    classification: s.classification,
    x: s.x,
    y: s.y,
    facing: s.facing,
    velX: s.velX,
    velY: s.velY,
    px: s.velX * s.mass,
    py: s.velY * s.mass,
    angVel: s.angVel,
    structure: s.structure,
    maxStructure: s.maxStructure,
    shield: s.shield,
    maxShield: s.maxShield,
    shieldRechargeRate: s.shieldRechargeRate,
    shieldRechargeDelay: s.shieldRechargeDelay,
    shieldRegenCountdown: s.shieldRegenCountdown,
    shieldAdaptiveRamp: s.shieldAdaptiveRamp,
    shieldUntouchedTicks: s.shieldUntouchedTicks,
    auraRangeBonus: s.auraRangeBonus,
    auraAccuracyBonus: s.auraAccuracyBonus,
    armourReduction: s.armourReduction,
    thrust: s.thrust,
    turnRate: s.turnRate,
    engineThrottle: s.engineThrottle,
    mass: s.mass,
    comX: s.comX,
    comY: s.comY,
    momentOfInertia: s.momentOfInertia,
    radius: s.radius,
    dilationFactor: s.dilationFactor,
    cost: s.cost,
    weapons: s.weapons,
    weaponCooldowns: [...s.weaponCooldowns],
    orders: s.orders,
    crewPriority: s.crewPriority,
    shipStance: s.shipStance,
    rules: s.rules,
    aiStance: s.aiStance,
    aiFocusFire: s.aiFocusFire,
    aiRetreat: s.aiRetreat,
    aiPrioritiseRepair: s.aiPrioritiseRepair,
    aiRally: s.aiRally,
    // `aiHoldFire` is a transient per-tick AI decision recomputed by the AI
    // interpreter step before the firing step reads it, so it is not captured;
    // restore seeds its documented default (`false`), exactly as `toSimShip`
    // does via `defaultAiDecisions`.
    aiHoldFire: false,
    target: s.target,
    alive: s.alive,
    salvageMass: s.salvageMass,
    ghosts: s.ghosts,
    awareness: new Map(),
    lastFiredTick: s.lastFiredTick,
  };
  if (s.outline !== undefined) ship.outline = s.outline;
  if (s.claimedBy !== undefined) ship.claimedBy = s.claimedBy;
  if (s.modules !== undefined) ship.modules = s.modules.map(restoreModule);
  if (s.crew !== undefined) ship.crew = s.crew;
  if (s.hullBaseThrust !== undefined) ship.hullBaseThrust = s.hullBaseThrust;
  if (s.hardwires !== undefined) ship.hardwires = s.hardwires;
  if (s.brokeOff !== undefined) ship.brokeOff = s.brokeOff;
  if (s.phantom !== undefined) ship.phantom = s.phantom;
  if (s.resource !== undefined) {
    // heatCapacity is a pure function of the (restored) modules + moduleIndex +
    // faction, so it is re-derived here rather than serialised in the checkpoint.
    const modules = ship.modules ?? [];
    ship.resource = {
      moduleIndex: s.resource.moduleIndex,
      thermal: s.resource.thermal,
      propellant: s.resource.propellant,
      atmosphere: s.resource.atmosphere,
      powerBuffer: s.resource.powerBuffer,
      heatCapacity: buildHeatCapacity(modules, s.resource.moduleIndex, ship.faction),
    };
  }
  return ship;
}

/**
 * The parts of an {@link EngineState} a checkpoint reconstructs, plus the RNG
 * position and counters the resume entry restores before re-entering the loop.
 * The per-side ship lists, the id index, and the per-tick awareness are rebuilt
 * at the top of the resumed tick, so they are not part of this.
 */
export interface RestoredEngine {
  ships: SimShip[];
  projectiles: SimProjectile[];
  mines: SimMine[];
  pods: SimPod[];
  pulses: EngineState["pulses"];
  emissions: EngineState["emissions"];
  debris: EngineState["debris"];
  beams: EngineState["beams"];
  deployment: EngineState["deployment"];
  chunkSeq: number;
  mineSeq: number;
  podSeq: number;
  phantomSeq: number;
  pulseSeq: number;
  emissionSeq: number;
  debrisSeq: number;
  ticks: number;
  stalemate: StalemateWatch | undefined;
  rngState: number;
  projectileCounter: number;
  tick: number;
}

/**
 * Rebuild the live engine parts from a checkpoint. Deep-clones the checkpoint
 * first so the restored state does not alias the (possibly shared) checkpoint
 * object — capture and restore are then symmetric and a restored state can be
 * re-captured to an equal checkpoint. The caller (the resume entry, a later
 * phase) seeds the RNG with `rngState`, restores the projectile counter, and
 * re-derives the occluders and descriptors before entering the loop at
 * `tick + 1`.
 */
export function restoreCheckpoint(cp: EngineCheckpoint): RestoredEngine {
  const clone = structuredClone(cp);
  return {
    ships: clone.ships.map(restoreShip),
    projectiles: clone.projectiles,
    mines: clone.mines,
    pods: clone.pods,
    pulses: clone.pulses,
    emissions: clone.emissions,
    debris: clone.debris,
    beams: clone.beams,
    // Build the DeploymentReference with both keys present (value possibly
    // undefined for a side that deployed nothing): the schema models each side
    // as an optional KEY, the runtime as a required key with an optional VALUE.
    deployment: {
      attacker: clone.deployment.attacker,
      defender: clone.deployment.defender,
    },
    chunkSeq: clone.counters.chunk,
    mineSeq: clone.counters.mine,
    podSeq: clone.counters.pod,
    phantomSeq: clone.counters.phantom,
    pulseSeq: clone.counters.pulse,
    emissionSeq: clone.counters.emission,
    debrisSeq: clone.counters.debris,
    ticks: clone.ticks,
    stalemate: clone.stalemate,
    rngState: clone.rngState,
    projectileCounter: clone.counters.projectile,
    tick: clone.tick,
  };
}
