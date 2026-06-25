/**
 * Engine checkpoint — the authoritative, serialisable snapshot of a battle's
 * mutable state at a tick boundary, the single source of truth for resume.
 *
 * A battle is a pure function of its inputs and a deterministic RNG, so a
 * mid-battle checkpoint need only record the AUTHORITATIVE live state: the RNG
 * position, the per-battle id counters, the in-flight entities, and every
 * ship's combat state. Every DERIVED cache is deliberately absent — the crew
 * path cache (which holds the non-serialisable `UNREACHABLE` Symbol), the
 * per-tick awareness Map, the wiring-reach Set, the alive-cell index, the
 * transport graph, and the topology fingerprint and the break-apart
 * alive-count markers (`breakApartLastAliveCount` / `aliveCount`). They
 * re-warm byte-identically on first touch (the fixed-tie-break A* recomputes
 * the same paths; the fingerprints recompute the same hashes; the alive count
 * is recomputed by `recomputeAggregates` and the break-apart marker re-warms
 * to `undefined`, so the first resumed pass analyses exactly as a fresh
 * start would), so capturing them would
 * be redundant and, in the Symbol's case, impossible. The transient `awareness`
 * Map and the re-derived momentum (`px`/`py`) are likewise rebuilt at the top of
 * the resumed tick before anything reads them, so they are not captured.
 *
 * Capture and restore round-trip through `structuredClone`, never JSON: a
 * checkpoint legitimately carries `±Infinity` (`lastFiredTick` begins at
 * `-Infinity`; the stalemate watch's all-time lows begin at `+Infinity`) and
 * `-0`, all of which JSON discards. The Zod schemas below model those numeric
 * fields as `z.number()` (which admits the non-finite IEEE-754 values) and are
 * applied only at the storage boundary — capture/restore inside the engine work
 * on cloned plain data directly.
 *
 * The runtime `SimShip` / `SimModule` types in `engine/types.ts` stay the single
 * authoritative definition of the live state; the `restoreShip` / `restoreModule`
 * builders below are explicitly typed to RETURN those types, so the compiler
 * rejects any checkpoint that fails to carry a required authoritative field —
 * that is what keeps the schema and the runtime type from drifting.
 */

import { z } from "zod";

import { ShipClassification } from "./armor";
import { ShipStance, CrewPriority, ModuleKind, Rule } from "./ai";
import { Orders } from "./fleet";
import { CellEdges, HardwireResource, SurfaceKind } from "./grid";
import { ModuleEffect, WeaponEffect, WeaponType } from "./module";

/** Which side a combatant belongs to (no "draw" — that is a battle outcome). */
const CombatantSide = z.enum(["attacker", "defender"]);

/**
 * A number that may legitimately be `±Infinity`. Zod 4's `z.number()` rejects
 * non-finite values, but a checkpoint genuinely carries them: a ship that has
 * never fired has `lastFiredTick = -Infinity`, and the stalemate watch's
 * all-time lows begin at `+Infinity`. Capturing those exactly (via
 * `structuredClone`, not JSON) is the whole reason the checkpoint store uses
 * structured clone, so the schema must admit them rather than reject them at
 * the storage boundary. `z.custom` validates the JS type without a cast.
 */
const ExtendedNumber = z.custom<number>((v) => typeof v === "number");

/** A resolved hardwire conduit carried onto a ship (`ResolvedHardwire`). */
const ResolvedHardwire = z.object({
  sourceSlotId: z.string(),
  sinkSlotId: z.string(),
  resource: HardwireResource,
});

/** A grid cell `(col, row)` step in a crew path. */
const CellStep = z.object({
  col: z.number(),
  row: z.number(),
});

/**
 * Per-ship resource state (`ResourceState`). `moduleIndex` is a `ReadonlyMap`
 * over `"col,row"` keys; `structuredClone` preserves the Map exactly and
 * `z.map` validates it without flattening to an object.
 */
const ResourceState = z.object({
  moduleIndex: z.map(z.string(), z.number()),
  thermal: z.array(z.number()),
  propellant: z.array(z.number()),
  atmosphere: z.array(z.number()),
  // Structurally the domain `EnergyBuffer` (`engine/power.ts`); inlined here to
  // keep the schema layer a pure leaf. The domain `restoreShip` builder, whose
  // return type carries the runtime `EnergyBuffer`, is the compile-time guard
  // that the two stay in step.
  powerBuffer: z.object({
    energy: z.number(),
    capacityJoules: z.number(),
  }),
});

/** A fading enemy memory persisted across ticks (`GhostContact`). */
const GhostContact = z.object({
  enemyId: z.string(),
  x: z.number(),
  y: z.number(),
  facing: z.number(),
  threat: z.number(),
  ticksLeft: z.number(),
});

/** A crew member's authoritative state (`SimCrew`). */
const CheckpointCrew = z.object({
  id: z.string(),
  col: z.number(),
  row: z.number(),
  ox: z.number(),
  oy: z.number(),
  hp: z.number(),
  job: z.enum(["idle", "manning", "haulAmmo", "haulPower"]),
  path: z.array(CellStep),
  pathIndex: z.number(),
  targetSlotId: z.string().optional(),
  haulSinkSlotId: z.string().optional(),
  carrying: z.enum(["ammo", "power"]).optional(),
  carryAmount: z.number().optional(),
  moveAccumulator: z.number(),
});

/**
 * Authoritative per-module state (`SimModule`). Every field is plain
 * serialisable data — modules carry no derived cache — so the module schema
 * mirrors the runtime type one-to-one.
 */
const CheckpointModule = z.object({
  slotId: z.string(),
  moduleId: z.string(),
  kind: ModuleKind,
  col: z.number(),
  row: z.number(),
  x: z.number(),
  y: z.number(),
  surface: SurfaceKind,
  edges: CellEdges,
  surfaceHp: z.number(),
  maxSurfaceHp: z.number(),
  surfaceReduction: z.number(),
  reactiveReduction: z.number(),
  reactiveWindow: z.number(),
  hp: z.number(),
  maxHp: z.number(),
  mass: z.number(),
  powerDraw: z.number(),
  effect: ModuleEffect,
  cooldown: z.number(),
  ammo: z.number(),
  ammoStored: z.number(),
  charge: z.number(),
  alive: z.boolean(),
  powered: z.boolean(),
  powerCut: z.boolean(),
  fuelStarved: z.boolean(),
  manned: z.boolean(),
  crewRequired: z.number(),
  command: z.boolean(),
  repairRate: z.number(),
  shieldArc: z.number(),
  shieldFacing: z.number(),
  facing: z.number(),
  weaponFacing: z.number(),
  turretArc: z.number(),
  turretTurnRate: z.number(),
  hardwireSinks: z.array(ResolvedHardwire).optional(),
  hardwireSources: z.array(ResolvedHardwire).optional(),
  turretAngle: z.number(),
  channel: z.number(),
  commsBearing: z.number(),
  dishAngle: z.number(),
  dishRangeSetting: z.number().optional(),
  sensorBearing: z.number(),
  sensorRangeSetting: z.number().optional(),
  techCooldown: z.number(),
  techActive: z.number(),
  reactiveCharge: z.number(),
  mineCooldown: z.number(),
  boardingCooldown: z.number(),
  exploded: z.boolean(),
  // Dense transport index (set once by makeResourceState; see SimModule).
  // Authoritative — serialised so a checkpoint resume restores the optimised
  // resource-step lookup. Optional for legacy checkpoints written before the
  // field existed; the resource step falls back to the moduleIndex map when
  // the field is absent (the oracle path), and makeResourceState re-derives
  // it identically on a fresh build.
  transportIndex: z.number().optional(),
});

/** A phantom (drone / decoy) sub-record on a SimShip. */
const PhantomState = z.object({
  kind: z.enum(["drone", "decoy"]),
  ownerId: z.string(),
  ticksLeft: z.number(),
  damage: z.number(),
  range: z.number(),
  speed: z.number(),
});

/**
 * Authoritative per-ship state (`SimShip`) minus every derived cache. The
 * non-serialisable cache fields — `pathCache`, `topologyFingerprint`,
 * `wiringReach`, `aliveCells`, `resourceGraph`, `breakApartLastAliveCount`,
 * `aliveCount` — and the transient `awareness` Map and re-derived `px`/`py`
 * are NOT present: they re-warm byte-identically on the first resumed tick.
 * `lastFiredTick` is a plain `z.number()` because it begins at `-Infinity`.
 */
const CheckpointShip = z.object({
  instanceId: z.string(),
  faction: z.string(),
  side: CombatantSide,
  classification: ShipClassification,
  x: z.number(),
  y: z.number(),
  facing: z.number(),
  velX: z.number(),
  velY: z.number(),
  angVel: z.number(),
  structure: z.number(),
  maxStructure: z.number(),
  shield: z.number(),
  maxShield: z.number(),
  shieldRechargeRate: z.number(),
  shieldRechargeDelay: z.number(),
  shieldRegenCountdown: z.number(),
  shieldAdaptiveRamp: z.number(),
  shieldUntouchedTicks: z.number(),
  auraRangeBonus: z.number(),
  auraAccuracyBonus: z.number(),
  armourReduction: z.number(),
  thrust: z.number(),
  turnRate: z.number(),
  engineThrottle: z.number(),
  mass: z.number(),
  comX: z.number(),
  comY: z.number(),
  momentOfInertia: z.number(),
  radius: z.number(),
  outline: z.array(z.array(z.object({ x: z.number(), y: z.number() }))).optional(),
  dilationFactor: z.number(),
  cost: z.number(),
  weapons: z.array(WeaponEffect),
  weaponCooldowns: z.array(z.number()),
  orders: Orders,
  crewPriority: CrewPriority,
  shipStance: ShipStance,
  rules: z.array(Rule),
  aiStance: ShipStance.nullable(),
  aiFocusFire: z.boolean(),
  aiRetreat: z.boolean(),
  aiPrioritiseRepair: z.boolean(),
  aiRally: z.boolean(),
  target: z.string().optional(),
  alive: z.boolean(),
  salvageMass: z.number(),
  claimedBy: z.string().optional(),
  modules: z.array(CheckpointModule).optional(),
  crew: z.array(CheckpointCrew).optional(),
  hullBaseThrust: z.number().optional(),
  hardwires: z.array(ResolvedHardwire).optional(),
  brokeOff: z.boolean().optional(),
  ghosts: z.array(GhostContact),
  lastFiredTick: ExtendedNumber,
  phantom: PhantomState.optional(),
  resource: ResourceState.optional(),
});

/** An in-flight projectile (`SimProjectile`). */
const CheckpointProjectile = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  vx: z.number(),
  vy: z.number(),
  kind: WeaponType,
  mass: z.number(),
  muzzleLocalX: z.number(),
  muzzleLocalY: z.number(),
  damage: z.number(),
  tracking: z.number(),
  shieldPiercing: z.number(),
  armourPiercing: z.number(),
  range: z.number(),
  travelled: z.number(),
  ttl: z.number(),
  ownerId: z.string(),
  ownerSide: CombatantSide,
  targetId: z.string(),
});

/** A deployed proximity mine (`SimMine`). */
const CheckpointMine = z.object({
  id: z.string(),
  side: CombatantSide,
  x: z.number(),
  y: z.number(),
  ownerInstanceId: z.string(),
  ownerSlotId: z.string(),
  armingLeft: z.number(),
  damage: z.number(),
  radius: z.number(),
});

/** A boarding pod in flight (`SimPod`). */
const CheckpointPod = z.object({
  id: z.string(),
  side: CombatantSide,
  x: z.number(),
  y: z.number(),
  targetInstanceId: z.string(),
  troops: z.number(),
});

/** An active-radar pulse (`SimPulse`). */
const CheckpointPulse = z.object({
  id: z.number(),
  emitterId: z.string(),
  reflectedFrom: z.string().optional(),
  originX: z.number(),
  originY: z.number(),
  radius: z.number(),
  bearing: z.number(),
  arc: z.number(),
  sweepRate: z.number(),
  sweepAngle: z.number(),
  strength: z.number(),
  birthTick: z.number(),
  maxRange: z.number(),
});

/** A continuous EM emission event (`Emission`). */
const CheckpointEmission = z.object({
  sourceId: z.string(),
  x: z.number(),
  y: z.number(),
  strength: z.number(),
  t0: z.number(),
});

/** A piece of drifting wreckage (`Debris`). */
const CheckpointDebris = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  velX: z.number(),
  velY: z.number(),
  mass: z.number(),
  radius: z.number(),
  salvageable: z.boolean(),
});

/** A visible energy-weapon beam emission (`SimBeam`). Pure render state — the
 *  beam already applied its damage at the moment of emission; the carried
 *  object just lets the renderer draw the line for a few more ticks. */
const CheckpointBeam = z.object({
  sourceId: z.string(),
  sourceX: z.number(),
  sourceY: z.number(),
  targetX: z.number(),
  targetY: z.number(),
  kind: WeaponType,
  emissionTicks: z.number(),
});

/** Each side's deployment centroid (`DeploymentReference`). Captured rather than
 *  re-derived: by tick N the initial centroids are gone, so recomputing from
 *  moved ships would silently diverge blind-fleet steering. */
const DeploymentReference = z.object({
  attacker: z.object({ x: z.number(), y: z.number() }).optional(),
  defender: z.object({ x: z.number(), y: z.number() }).optional(),
});

/** The no-progress stalemate watch (`StalemateWatch`). Present only on an
 *  uncapped battle. Its all-time lows begin at `+Infinity`, so they are
 *  `z.number()`. */
const StalemateWatch = z.object({
  hpLow: ExtendedNumber,
  enemyDistLow: ExtendedNumber,
  mineDistLow: ExtendedNumber,
  idleTicks: z.number(),
});

/** The schema version. Bumped when the checkpoint shape changes so a stored
 *  checkpoint from an older shape is rejected at the storage boundary rather
 *  than silently mis-read. */
export const CHECKPOINT_VERSION = 2;

/**
 * A complete engine checkpoint: everything needed to resume `simulateBattle`
 * from `tick + 1` and produce frames byte-identical to a fresh run's tail.
 */
export const EngineCheckpoint = z.object({
  /** Checkpoint shape version. */
  version: z.literal(CHECKPOINT_VERSION),
  /** The tick this checkpoint was taken at the end of (resume enters `tick+1`). */
  tick: z.number(),
  /** The RNG generator's internal state (`Rng.getState()`); replaying it as
   *  `mulberry32(seed, rngState)` reproduces the remaining draw sequence. */
  rngState: z.number(),
  /** The deterministic per-battle id counters, restored before resume so the
   *  next spawned id matches a fresh run exactly. */
  counters: z.object({
    projectile: z.number(),
    chunk: z.number(),
    mine: z.number(),
    pod: z.number(),
    phantom: z.number(),
    pulse: z.number(),
    emission: z.number(),
    debris: z.number(),
  }),
  /** Count of post-initial frames yielded so far (excludes the tick-0 frame). */
  ticks: z.number(),
  /** Each side's deployment centroid, captured (not re-derivable). */
  deployment: DeploymentReference,
  /** The stalemate watch, present only on an uncapped battle. */
  stalemate: StalemateWatch.optional(),
  ships: z.array(CheckpointShip),
  projectiles: z.array(CheckpointProjectile),
  mines: z.array(CheckpointMine),
  pods: z.array(CheckpointPod),
  pulses: z.array(CheckpointPulse),
  emissions: z.array(CheckpointEmission),
  debris: z.array(CheckpointDebris),
  beams: z.array(CheckpointBeam),
  /**
   * Arena medium field at the checkpoint tick: the resolved {@link
   * MediumFieldConfig} scalars and the live density (ρ) and excitation (ε)
   * state arrays. The grid connectivity (`neighbours`, `boundaryFaceCount`) is a
   * pure function of `(widthM, heightM)`, so it is NOT captured —
   * `buildMediumField` rebuilds it byte-identically on resume. Optional: absent
   * on checkpoints recorded before the medium field was wired in.
   */
  medium: z
    .object({
      widthM: z.number().int().min(1),
      heightM: z.number().int().min(1),
      pitchM: z.number().min(0),
      rhoDiffusionM2PerS: z.number(),
      rhoMaxVelocityMPerS: z.number(),
      epsDiffusionM2PerS: z.number(),
      epsDecayTimescaleS: z.number(),
      boundaryVentVelocityMPerS: z.number(),
      boundaryEpsLossPerS: z.number(),
      rho: z.array(z.number()),
      eps: z.array(z.number()),
    })
    .optional(),
});
export type EngineCheckpoint = z.infer<typeof EngineCheckpoint>;

/**
 * The authoritative serialisable subset types, inferred from the schemas above.
 * The domain `captureCheckpoint` / `restoreCheckpoint` builders are typed
 * against these so the runtime `SimShip` / `SimModule` and the schema cannot
 * drift: restore RETURNS the runtime type from one of these, which fails to
 * compile if the runtime type gains a required authoritative field the schema
 * lacks.
 */
export type CheckpointShip = z.infer<typeof CheckpointShip>;
export type CheckpointModule = z.infer<typeof CheckpointModule>;
export type CheckpointCrew = z.infer<typeof CheckpointCrew>;
export type CheckpointProjectile = z.infer<typeof CheckpointProjectile>;
export type CheckpointMine = z.infer<typeof CheckpointMine>;
export type CheckpointPod = z.infer<typeof CheckpointPod>;
export type CheckpointPulse = z.infer<typeof CheckpointPulse>;
export type CheckpointEmission = z.infer<typeof CheckpointEmission>;
export type CheckpointDebris = z.infer<typeof CheckpointDebris>;
export type CheckpointBeam = z.infer<typeof CheckpointBeam>;
