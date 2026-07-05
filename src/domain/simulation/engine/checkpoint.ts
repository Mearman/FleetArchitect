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
import {
  particleStoreFromParticles,
  particlesFromStore,
} from "./exhaust-particles";
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
    deflector: s.deflector,
    maxDeflector: s.maxDeflector,
    deflectorRechargeRate: s.deflectorRechargeRate,
    deflectorRechargeDelay: s.deflectorRechargeDelay,
    deflectorRegenCountdown: s.deflectorRegenCountdown,
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
    doctrine: s.doctrine,
    // Formation identity (formation overhaul). Captured so a resumed
    // doctrine-active battle keeps its formation grouping — the doctrine pass
    // aggregates over the chain and resolves role references off these.
    // Conditionally spread (mirroring `toSimShip`) so a ship without formation
    // context writes nothing and round-trips byte-identically.
    ...(s.formationId !== undefined
      ? {
          formationId: s.formationId,
          formationChain: s.formationChain,
          role: s.role,
        }
      : {}),
    aiStance: s.aiStance,
    aiFocusFire: s.aiFocusFire,
    aiRetreat: s.aiRetreat,
    aiPrioritiseRepair: s.aiPrioritiseRepair,
    aiRally: s.aiRally,
    alive: s.alive,
    salvageMass: s.salvageMass,
    ghosts: s.ghosts,
    lastFiredTick: s.lastFiredTick,
    sensorSaturation: s.sensorSaturation,
  };
  if (s.outline !== undefined) ship.outline = s.outline;
  if (s.renderOutline !== undefined) ship.renderOutline = s.renderOutline;
  if (s.target !== undefined) ship.target = s.target;
  if (s.claimedBy !== undefined) ship.claimedBy = s.claimedBy;
  if (s.modules !== undefined) ship.modules = s.modules.map(snapshotModule);
  if (s.crew !== undefined) ship.crew = s.crew;
  if (s.hullBaseThrust !== undefined) ship.hullBaseThrust = s.hullBaseThrust;
  if (s.hardwires !== undefined) ship.hardwires = s.hardwires;
  if (s.brokeOff !== undefined) ship.brokeOff = s.brokeOff;
  if (s.phantom !== undefined) ship.phantom = s.phantom;
  // Effect-scaling metadata for multi-cell anchors: carried verbatim (the
  // engine is catalog-free, so the unscaled base cannot be re-derived).
  if (s.scalingMeta !== undefined) ship.scalingMeta = s.scalingMeta;
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
    reactiveHp: m.reactiveHp,
    maxReactiveHp: m.maxReactiveHp,
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
    ticksSinceLastDeath: state.ticksSinceLastDeath,
    deployment: state.deployment,
    ships,
    projectiles: state.projectiles,
    mines: state.mines,
    pods: state.pods,
    pulses: state.pulses,
    emissions: state.emissions,
    debris: state.debris,
    beams: state.beams,
    // The live store is materialised to plain records at the capture boundary
    // (the checkpoint schema stores `{x,y,vx,vy,intensity,age}` objects). The
    // final structuredClone severs the alias to the records; the store's
    // Float64Array slots hold the exact IEEE-754 doubles the engine uses, so
    // boxing to `number` here preserves them — the resumed plume continues
    // byte-identically from the live set.
    particles: particlesFromStore(state.particles),
    // Medium field: capture the resolved config scalars (the grid connectivity
    // re-derives from width/height on resume) and a COPY of the live state
    // arrays plus the per-cell `birthTicks` array, so the checkpoint is
    // independent of the continuing battle's in-place medium mutation. The
    // birthTick array is captured because it is accumulated state the
    // sustained-radiation light-lag gate reads — without it resume would treat
    // every radiating cell as freshly ignited and lose distant receivers their
    // steady-burn contacts for one light-time.
    medium: {
      widthM: state.medium.field.config.widthM,
      heightM: state.medium.field.config.heightM,
      pitchM: state.medium.field.config.pitchM,
      rhoDiffusionM2PerS: state.medium.field.config.rhoDiffusionM2PerS,
      rhoMaxVelocityMPerS: state.medium.field.config.rhoMaxVelocityMPerS,
      epsDiffusionM2PerS: state.medium.field.config.epsDiffusionM2PerS,
      epsDecayTimescaleS: state.medium.field.config.epsDecayTimescaleS,
      boundaryVentVelocityMPerS: state.medium.field.config.boundaryVentVelocityMPerS,
      boundaryEpsLossPerS: state.medium.field.config.boundaryEpsLossPerS,
      // The final structuredClone severs the alias to the live arrays; the
      // spreads satisfy the schema's mutable `number[]` (the live state arrays
      // are `Float64Array`, materialised to boxed `number[]` only here, at the
      // checkpoint boundary — preserving the exact IEEE-754 doubles).
      rho: [...state.medium.state.rho],
      eps: [...state.medium.state.eps],
      epsVis: [...state.medium.state.epsVis],
      mx: [...state.medium.state.mx],
      my: [...state.medium.state.my],
      birthTick: [...state.medium.birthTicks],
    },
  };
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
    reactiveHp: m.reactiveHp,
    maxReactiveHp: m.maxReactiveHp,
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
    deflector: s.deflector,
    maxDeflector: s.maxDeflector,
    deflectorRechargeRate: s.deflectorRechargeRate,
    deflectorRechargeDelay: s.deflectorRechargeDelay,
    deflectorRegenCountdown: s.deflectorRegenCountdown,
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
    doctrine: s.doctrine,
    // Formation identity (formation overhaul). Restored so a resumed
    // doctrine-active battle keeps its formation grouping — the doctrine pass
    // reads these exactly as the pre-pause tick did. Conditionally spread so a
    // pre-formation checkpoint (or a ship without formation context) restores
    // `undefined`, matching the fresh-ship byte-identical contract.
    ...(s.formationId !== undefined
      ? {
          formationId: s.formationId,
          formationChain: s.formationChain,
          role: s.role,
        }
      : {}),
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
    // `aiWasFiredUpon` is likewise transient (set by applyDamage, reset by the
    // weapons step), so it is not captured; restore seeds `false`.
    aiWasFiredUpon: false,
    target: s.target,
    alive: s.alive,
    salvageMass: s.salvageMass,
    ghosts: s.ghosts,
    awareness: new Map(),
    lastFiredTick: s.lastFiredTick,
    sensorSaturation: s.sensorSaturation,
  };
  if (s.outline !== undefined) ship.outline = s.outline;
  if (s.renderOutline !== undefined) ship.renderOutline = s.renderOutline;
  if (s.claimedBy !== undefined) ship.claimedBy = s.claimedBy;
  if (s.modules !== undefined) ship.modules = s.modules.map(restoreModule);
  if (s.crew !== undefined) ship.crew = s.crew;
  if (s.hullBaseThrust !== undefined) ship.hullBaseThrust = s.hullBaseThrust;
  if (s.hardwires !== undefined) ship.hardwires = s.hardwires;
  if (s.brokeOff !== undefined) ship.brokeOff = s.brokeOff;
  if (s.phantom !== undefined) ship.phantom = s.phantom;
  // Effect-scaling metadata for multi-cell anchors: carried verbatim (the
  // engine is catalog-free, so the unscaled base cannot be re-derived).
  if (s.scalingMeta !== undefined) ship.scalingMeta = s.scalingMeta;
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
  particles: EngineState["particles"];
  deployment: EngineState["deployment"];
  /** The captured medium field config + state arrays, or undefined on a
   *  pre-medium checkpoint. The caller rebuilds the {@link MediumField} grid
   *  connectivity from the config scalars. */
  medium: EngineCheckpoint["medium"];
  chunkSeq: number;
  mineSeq: number;
  podSeq: number;
  phantomSeq: number;
  pulseSeq: number;
  emissionSeq: number;
  debrisSeq: number;
  ticks: number;
  ticksSinceLastDeath: number;
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
    // Rebuild the live store from the checkpoint's plain records (absent on a
    // pre-particle checkpoint → empty store). `particleStoreFromParticles` copies
    // up to MAX_LIVE_PARTICLES in order, matching the per-tick cap the running
    // battle applied before capture, so the restored live set is identical.
    particles: particleStoreFromParticles(clone.particles ?? []),
    medium: clone.medium,
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
    ticksSinceLastDeath: clone.ticksSinceLastDeath,
    rngState: clone.rngState,
    projectileCounter: clone.counters.projectile,
    tick: clone.tick,
  };
}
