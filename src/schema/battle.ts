import { z } from "zod";
import { EntityId, IsoTimestamp } from "./primitives";
import { WeaponType } from "./module";
import { SurfaceKind } from "./grid";
import { EngineCheckpoint } from "./checkpoint";

/** A side in a battle. `draw` is only a battle outcome, never a ship's side. */
export const BattleSide = z.enum(["attacker", "defender", "draw"]);
export type BattleSide = z.infer<typeof BattleSide>;


/** Crew member state at a single tick of a recorded battle. */
export const CrewSnapshot = z.object({
  id: EntityId,
  /** Ship-local position (relative to the ship's position). */
  x: z.number(),
  y: z.number(),
  /** Current crew state: idle (no task), walking (moving), manning (at a module),
   *  hauling (carrying ammo/power), injured (incapacitated). */
  state: z.enum(["idle", "walking", "manning", "hauling", "injured"]),
  hp: z.number(),
  /** What the crew is carrying (if state is hauling). Optional for idle/walking/manning. */
  carrying: z.enum(["power", "ammo"]).optional(),
});
export type CrewSnapshot = z.infer<typeof CrewSnapshot>;

/**
 * A kind of spatial anomaly that can be active during a battle (GSB's "spatial
 * anomalies"). Anomalies are not mutually exclusive — a battle carries a SET of
 * these ({@link BattleConfig.anomalies}); the empty set means open space.
 */
export const BattleAnomalyKind = z.enum(["asteroidField", "nebula", "blackHole"]);
export type BattleAnomalyKind = z.infer<typeof BattleAnomalyKind>;

/**
 * Canonicalise an anomaly selection to a sorted, de-duplicated array. Anomalies
 * are a set — their order is irrelevant to gameplay — so this fixed canonical
 * form is what lets two equivalent selections share one cache key and produce
 * byte-identical frames. The cache key canonicalises arrays in their given
 * order, so the array MUST already be canonical by the time it reaches it; this
 * transform guarantees that for every parsed value (URL, storage).
 */
export function normaliseAnomalies(
  anomalies: readonly BattleAnomalyKind[],
): BattleAnomalyKind[] {
  return [...new Set(anomalies)].sort();
}

/** The inputs to a battle. The seed makes the outcome deterministic. */
export const BattleConfig = z.object({
  attackerFleetId: EntityId,
  defenderFleetId: EntityId,
  /**
   * The set of spatial anomalies active in this battle (combinable; an empty
   * array is open space). Normalised on parse to a canonical sorted, de-duplicated
   * array so the simulation determinants are order-independent.
   */
  anomalies: z.array(BattleAnomalyKind).transform(normaliseAnomalies),
  seed: z.number().int(),
});
export type BattleConfig = z.infer<typeof BattleConfig>;

/** The module kinds a cell can hold. Shared by the static cell descriptor and
 *  any consumer that switches on cell kind. */
export const CellKind = z.enum([
  "weapon",
  "shield",
  "armour",
  "engine",
  "power",
  "crew",
  "pointDefense",
  "repair",
  "hull",
  "magazine",
  "sensor",
  "comms",
  "rcs",
  "reactionWheel",
  "blink",
  "afterburner",
  "overcharge",
  "cloak",
  "signature",
  "ecm",
  "eccm",
  "decoy",
  "commandAura",
  "hangar",
  "mineLayer",
  "boarding",
]);
export type CellKind = z.infer<typeof CellKind>;

/**
 * One cell's DYNAMIC state at a single tick, carried as a set of NAMED TYPED
 * ARRAYS index-matched to the static {@link ShipCellLayout} (both s.modules
 * order): for a ship with N modules, `cellHp[i]` / `cellAlive[i]` etc. describe
 * the i-th cell. The cell's static layout (kind, ship-local offset, max HP,
 * surface kind) lives once-per-battle in {@link ShipCellLayout}, keyed by the
 * same index. The renderer reconstructs each cell's world position from the
 * ship pose and the static offset, so it is not serialised every frame.
 *
 * The heavy per-cell fields are FLATTENED to typed arrays and transferred
 * zero-copy across the worker boundary (postMessage `transfer` list), eliminating
 * the structured-clone cost that was the source of Chrome's `[Violation]
 * 'message' handler` warnings on the heaviest frames. Float64Array holds the
 * same IEEE-754 doubles the engine uses — no Float32 rounding, no determinism
 * risk. The engine itself is unchanged; only the snapshot's serialisation
 * changed from JS objects to flat typed arrays.
 *
 * Field presence:
 *  - `cellHp` (Float64Array) and `cellAlive` (Uint8Array, 0/1) are ALWAYS
 *    present (every cell has hp and an alive flag).
 *  - The remaining arrays are OPTIONAL: present only when at least one cell on
 *    the ship carries that field. Sentinel values fill the cells without it:
 *    NaN for `cellTurretAngle`/`cellCharge`; -1 for `cellAmmo`; 0 (meaning
 *    "no door on this edge") for the door arrays.
 *  - The door state is flattened to four Uint8Array per direction
 *    (cellDoorN/E/S/W), present only when the ship has at least one door.
 *    Each value is 0 = no door, 1 = open, 2 = closed.
 */
export interface CellStateArrays {
  /** Current substrate/structure HP of each cell. Always present. */
  cellHp: Float64Array<ArrayBuffer>;
  /** Alive flag per cell (0/1). Always present. */
  cellAlive: Uint8Array<ArrayBuffer>;
  /** Current surface-layer HP per cell. Always present (0 for bare cells). */
  cellSurfaceHp: Float64Array<ArrayBuffer>;
  /** Live turret barrel angle (radians, ship-local) per cell. Present when the
   *  ship has at least one turreted weapon; NaN for non-turret cells. */
  cellTurretAngle?: Float64Array<ArrayBuffer>;
  /** Manning flag per cell (0/1). Present when the ship has crewed modules. */
  cellManned?: Uint8Array<ArrayBuffer>;
  /** Ammo remaining per cell. Present when the ship has ammo weapons; -1 for
   *  cells without. */
  cellAmmo?: Int32Array<ArrayBuffer>;
  /** Charge level per cell. Present when the ship has chargeable modules; NaN
   *  for cells without. */
  cellCharge?: Float64Array<ArrayBuffer>;
  /** Per-edge door state, north edge (0=none, 1=open, 2=closed). Present when
   *  the ship has at least one door. */
  cellDoorN?: Uint8Array<ArrayBuffer>;
  /** Per-edge door state, east edge. Present when the ship has doors. */
  cellDoorE?: Uint8Array<ArrayBuffer>;
  /** Per-edge door state, south edge. Present when the ship has doors. */
  cellDoorS?: Uint8Array<ArrayBuffer>;
  /** Per-edge door state, west edge. Present when the ship has doors. */
  cellDoorW?: Uint8Array<ArrayBuffer>;
}

/** Zod schema for the per-cell typed-array state. Uses z.instanceof to validate
 *  the typed-array classes at the thread boundary. */
const float64ArraySchema = z.instanceof(Float64Array);
const uint8ArraySchema = z.instanceof(Uint8Array);
const int32ArraySchema = z.instanceof(Int32Array);

export const CellStateArraysSchema = z.object({
  cellHp: float64ArraySchema,
  cellAlive: uint8ArraySchema,
  cellSurfaceHp: float64ArraySchema,
  cellTurretAngle: float64ArraySchema.optional(),
  cellManned: uint8ArraySchema.optional(),
  cellAmmo: int32ArraySchema.optional(),
  cellCharge: float64ArraySchema.optional(),
  cellDoorN: uint8ArraySchema.optional(),
  cellDoorE: uint8ArraySchema.optional(),
  cellDoorS: uint8ArraySchema.optional(),
  cellDoorW: uint8ArraySchema.optional(),
});

/** One ship's state at a single tick of a recorded battle. */
export const ShipSnapshot = z.object({
  instanceId: EntityId,
  side: z.enum(["attacker", "defender"]),
  x: z.number(),
  y: z.number(),
  /** Linear velocity in world units per tick. Optional for backward
   *  compatibility with replays saved before the Newtonian movement model. */
  vx: z.number().optional(),
  vy: z.number().optional(),
  /** Heading in radians (the direction the ship is pointing, not necessarily
   *  its direction of travel). Optional for the same backward-compat reason. */
  facing: z.number().optional(),
  structure: z.number(),
  shield: z.number(),
  alive: z.boolean(),
  /**
   * Per-cell DYNAMIC state as NAMED TYPED ARRAYS, present when the ship runs
   * the per-module damage model. INDEX-MATCHED to the once-per-battle
   * {@link ShipCellLayout} (carried on {@link ShipDescriptor}, in the same
   * s.modules order): cellHp[i] corresponds to ShipCellLayout.cells[i], so the
   * renderer joins them by index rather than by slotId. The static layout holds
   * the cell's kind, ship-local offset, max HP and surface, so the renderer
   * derives each cell's world position from the ship pose plus its static
   * offset rather than re-serialising it every frame. The typed arrays are
   * transferred zero-copy across the worker boundary (postMessage `transfer`
   * list), eliminating the structured-clone cost. Optional for backward
   * compatibility with older replays.
   */
  cells: CellStateArraysSchema.optional(),
  /** Crew members aboard this ship. Optional for backward compatibility with
   *  older replays that predate crew. */
  crew: z.array(CrewSnapshot).optional(),
  /**
   * True when this ship was spawned as a break-away chunk from a parent
   * ship on the frame it first appeared. The flag clears the next frame
   * so the UI can highlight the split moment without needing a separate
   * event log. Optional for backward compatibility with older replays.
   */
  brokeOff: z.boolean().optional(),
  /**
   * Ship-local centre of mass (relative to the ship's position). When the
   * ship runs the per-module model the CoM is derived from the mass
   * distribution of its modules; rotation pivots about this point and
   * forces are lever-armed against it. Optional for backward compatibility
   * with older replays; absent (or 0,0) on legacy non-modular ships.
   */
  comX: z.number().optional(),
  comY: z.number().optional(),
  /**
   * The instance id of the ship this ship is currently targeting, or undefined
   * when it has no live target. Emitted by the engine from the runtime
   * targeting decision each tick; carried through interpolation as discrete
   * nearest-frame state. Used by the battle overlay renderer to draw targeting
   * indicators. Optional for backward compatibility with older replays.
   */
  targetId: EntityId.optional(),
  /**
   * Per-ship resource state (Phase 12 wiring). Emitted when the ship runs the
   * resource step (modular ships only). Arrays are module-sparse: index `i`
   * corresponds to the module at dense position `i` (modules sorted by
   * (row, col)). Absent on legacy aggregated ships and phantoms; absent when the
   * resource step has not been wired in. Optional for backward compatibility.
   */
  resource: z
    .object({
      /** Thermal field: temperature (K) for each module cell, as a typed array
       *  transferred zero-copy across the worker boundary. */
      thermal: float64ArraySchema,
      /** Propellant field: fuel mass (kg) for each module cell. */
      propellant: float64ArraySchema,
      /** Atmosphere field: gas mass (kg) for each module cell. */
      atmosphere: float64ArraySchema,
      /** Ship-wide power capacitor state. */
      powerBuffer: z.object({
        energy: z.number().min(0),
        capacityJoules: z.number().min(0),
      }),
    })
    .optional(),
});
export type ShipSnapshot = z.infer<typeof ShipSnapshot>;

/** A chamfered hull outline: an array of polygon loops, each a list of Vec2
 *  vertices in ship-local metres. Render-only; present on modular ships with
 *  armour cells. Carried once per ship on {@link ShipDescriptor}. */
export const ShipOutline = z.array(z.array(z.object({ x: z.number(), y: z.number() })));
export type ShipOutline = z.infer<typeof ShipOutline>;

/**
 * The STATIC layout of one cell: everything that is fixed for the life of a
 * ship instance and so does not belong in every per-tick snapshot. Keyed by
 * `slotId` to the dynamic {@link CellState} the frames carry. `ox`/`oy` are the
 * cell's ship-local centre offset; the renderer rotates them by the ship's
 * facing and adds the ship position to recover the cell's world position.
 */
export const ShipCellLayout = z.object({
  slotId: EntityId,
  kind: CellKind,
  /** Ship-local centre offset (design coordinates). */
  ox: z.number(),
  oy: z.number(),
  /** Surface kind of this cell (bare/deck/armor). Optional for backward
   *  compatibility with replays recorded before the grid model. */
  surface: SurfaceKind.optional(),
  /** Maximum HP of the surface layer. Optional for backward compatibility. */
  maxSurfaceHp: z.number().optional(),
  /** Maximum substrate/structure HP of the cell. */
  maxHp: z.number(),
  /** True when this cell mounts a turreted weapon, so the renderer expects a
   *  live `turretAngle` in the cell's dynamic state. Omitted on fixed mounts and
   *  non-weapon cells. */
  hasTurret: z.boolean().optional(),
});
export type ShipCellLayout = z.infer<typeof ShipCellLayout>;

/**
 * Per-ship STATIC descriptor, emitted ONCE per ship instance for the whole
 * battle rather than serialised into every frame. Holds the cell layout (the
 * static grid) and the chamfered outline; the renderer reconstructs each cell's
 * world position from the ship pose carried in the per-tick {@link ShipSnapshot}
 * plus the static `ox`/`oy` offset here. Break-away chunks are fresh instances
 * with their own descriptor, captured the first frame they appear.
 */
export const ShipDescriptor = z.object({
  instanceId: EntityId,
  side: z.enum(["attacker", "defender"]),
  /** The static per-cell layout, present for modular ships. Absent on legacy
   *  aggregated ships with no cell data. */
  cells: z.array(ShipCellLayout).optional(),
  /** The chamfered hull outline, present for modular ships with armour cells. */
  outline: ShipOutline.optional(),
});
export type ShipDescriptor = z.infer<typeof ShipDescriptor>;

/** A visible projectile at a tick, for rendering weapon fire during replay. */
export const ProjectileSnapshot = z.object({
  id: EntityId,
  x: z.number(),
  y: z.number(),
  kind: WeaponType,
});
export type ProjectileSnapshot = z.infer<typeof ProjectileSnapshot>;

/**
 * Awareness snapshot appended to a BattleFrame when the sensor/comms system
 * is active. Optional so battles recorded before Phase C still parse without
 * error.
 *
 * All ids in the sub-objects are EntityId strings (ship instance ids or slot
 * ids) to keep the data self-contained and renderable without back-references
 * to the design.
 */
export const AwarenessSnapshot = z.object({
  /**
   * Solid disc occluders blocking line-of-sight this tick: the event-horizon
   * of a black hole, or the asteroid disc set for an asteroid field. Recomputed
   * deterministically from the anomaly and seed; carried here so the renderer
   * needs no separate occluder call.
   */
  occluders: z.array(z.object({ x: z.number(), y: z.number(), r: z.number() })),
  /**
   * Comms relay clusters: groups of friendly ships that share awareness via
   * active comms links. Each cluster has a stable id, a side, the member ship
   * instance ids, and the set of coverage shapes that bound the cluster's
   * collective sensor reach (for rendering).
   *
   * Each coverage element is centred at (x, y) with reach `r`. When `bearing`
   * and `arc` are BOTH present the shape is a SECTOR (cone): a wedge of half-arc
   * `arc` radians about world bearing `bearing`. When both are absent the shape
   * is a full circle of radius `r` (an omni sensor or the innate visual circle).
   */
  clusters: z.array(
    z.object({
      id: EntityId,
      side: z.enum(["attacker", "defender"]),
      memberIds: z.array(EntityId),
      coverage: z.array(
        z.object({
          x: z.number(),
          y: z.number(),
          r: z.number(),
          /** World bearing (radians) the cone is centred on; absent = full circle. */
          bearing: z.number().optional(),
          /** Half-arc (radians) of the cone; absent = full circle. */
          arc: z.number().optional(),
        }),
      ),
    }),
  ),
  /**
   * Per-observer confirmed contacts: each entry records that the ship
   * `observerId` on `side` has a current sensor fix on enemy ship `enemyId`
   * at world position (x, y). One entry per (observer, enemy) pair — a ship
   * can observe multiple enemies and be observed by multiple allies.
   */
  contacts: z.array(
    z.object({
      side: z.enum(["attacker", "defender"]),
      observerId: EntityId,
      enemyId: EntityId,
      x: z.number(),
      y: z.number(),
    }),
  ),
  /**
   * Stale ghost contacts: a ship `observerId` last saw enemy `enemyId` at (x, y)
   * and `ticksLeft` ticks remain before that memory expires. The renderer can
   * draw these as faded/fading markers.
   */
  ghosts: z.array(
    z.object({
      side: z.enum(["attacker", "defender"]),
      observerId: EntityId,
      enemyId: EntityId,
      x: z.number(),
      y: z.number(),
      ticksLeft: z.number().int().min(0),
    }),
  ),
  /**
   * Active comms links between pairs of friendly modules this tick. `aSlot` and
   * `bSlot` are the slot ids of the two comms modules forming the link.
   */
  links: z.array(
    z.object({
      side: z.enum(["attacker", "defender"]),
      aId: EntityId,
      aSlot: EntityId,
      bId: EntityId,
      bSlot: EntityId,
      type: z.enum(["omni", "directional", "dish", "laser", "variable"]),
    }),
  ),
  /**
   * Live dish/directional angles for steerable comms modules: the world-space
   * bearing (radians) the module's antenna is currently pointing. Enables the
   * renderer to draw the antenna arc in the correct direction.
   */
  dishAngles: z.array(
    z.object({
      shipId: EntityId,
      slotId: EntityId,
      angle: z.number(),
    }),
  ),
});
export type AwarenessSnapshot = z.infer<typeof AwarenessSnapshot>;

/** An autonomous drone launched from a hangar, at a tick. A small independent
 *  combatant: it has its own position, heading and HP and is rendered like a
 *  miniature ship in its owner's faction colours. */
export const DroneSnapshot = z.object({
  instanceId: EntityId,
  ownerId: EntityId,
  side: z.enum(["attacker", "defender"]),
  x: z.number(),
  y: z.number(),
  facing: z.number().optional(),
  hp: z.number(),
  maxHp: z.number(),
  alive: z.boolean(),
});
export type DroneSnapshot = z.infer<typeof DroneSnapshot>;

/** A deployed proximity mine at a tick. `armed` is false during its arming
 *  delay (it cannot detonate yet); the renderer can show a disarmed mine dimly. */
export const MineSnapshot = z.object({
  instanceId: EntityId,
  side: z.enum(["attacker", "defender"]),
  x: z.number(),
  y: z.number(),
  armed: z.boolean(),
});
export type MineSnapshot = z.infer<typeof MineSnapshot>;

/** A false contact emitted by a decoy launcher at a tick. Enemies may target
 *  and fire at it until it is destroyed or its `ticksLeft` expires. */
export const DecoySnapshot = z.object({
  instanceId: EntityId,
  ownerId: EntityId,
  side: z.enum(["attacker", "defender"]),
  x: z.number(),
  y: z.number(),
  hp: z.number(),
  ticksLeft: z.number().int().min(0),
});
export type DecoySnapshot = z.infer<typeof DecoySnapshot>;

/** A boarding pod in flight at a tick, travelling from its launcher toward the
 *  enemy ship `targetId`. On contact it disables modules on the target. */
export const BoardingPodSnapshot = z.object({
  instanceId: EntityId,
  side: z.enum(["attacker", "defender"]),
  x: z.number(),
  y: z.number(),
  targetId: EntityId,
  /**
   * The pod's cell grid for block-grid rendering: a minimal list of occupied
   * cells with their surface kind. Absent on pods recorded before this field
   * existed (fall back to a simple 3×3 block centred on the pod position).
   */
  cells: z.array(z.object({ q: z.number(), r: z.number(), surface: z.string() })).optional(),
});
export type BoardingPodSnapshot = z.infer<typeof BoardingPodSnapshot>;

/** An active-radar pulse in flight at a tick (Phase 8). An expanding sphere of
 *  EM at world origin (x, y) with current `radius`; the renderer draws it as an
 *  expanding ring. An outbound ping has `reflectedFrom` absent; a reflection
 *  (a return scattered off the enemy ship `reflectedFrom`) carries that id so the
 *  renderer can tint returns differently. `bearing`/`arc` describe the
 *  illuminated cone (arc >= PI is a full sphere). `strength` is the EM power at
 *  the pulse front, used by the renderer to alpha-blend the ring — full strength
 *  opaque, decayed strength faded. Optional for backward compatibility with
 *  replays recorded before this field was emitted. */
export const PulseSnapshot = z.object({
  id: z.number().int(),
  emitterId: EntityId,
  reflectedFrom: EntityId.optional(),
  x: z.number(),
  y: z.number(),
  radius: z.number().min(0),
  bearing: z.number(),
  arc: z.number(),
  /** EM strength at the pulse front. Optional for backward compatibility. */
  strength: z.number().optional(),
});
export type PulseSnapshot = z.infer<typeof PulseSnapshot>;

/** A continuous EM emission event at a tick (Phase 9). Every ship is always
 *  emitting — it reflects ambient light and radiates its own heat — so each
 *  alive ship contributes a baseline emission at its position (`sourceId`), plus
 *  one per operational active-mode sensor. `strength` is the emitted power at the
 *  source (it attenuates with the inverse square of distance at the receiver);
 *  `t0` is the tick it was emitted. The renderer can draw these as expanding EM
 *  rings, distinct from active-radar pulses. */
export const EmissionSnapshot = z.object({
  sourceId: EntityId,
  x: z.number(),
  y: z.number(),
  strength: z.number().min(0),
  t0: z.number().int().min(0),
});
export type EmissionSnapshot = z.infer<typeof EmissionSnapshot>;

/** A piece of wreckage drifting at a tick (Phase 12). Spawned when a ship is
 *  destroyed, it keeps the parent's centre-of-mass velocity (Newton's first law)
 *  and drifts frictionlessly thereafter. `mass` is in kg and `radius` is the
 *  derived bounding radius (metres); the renderer can draw it as a tumbling
 *  fragment scaled by its radius. `salvageable` marks fragments that carry
 *  recoverable material (reserved for future salvage mechanics; false by default
 *  until the engine sets the flag). Optional for backward compatibility with
 *  replays recorded before this field existed. */
export const DebrisSnapshot = z.object({
  id: EntityId,
  x: z.number(),
  y: z.number(),
  vx: z.number(),
  vy: z.number(),
  mass: z.number().min(0),
  radius: z.number().min(0),
  /** Whether this fragment carries recoverable material. Optional for backward
   *  compatibility; absent entries are treated as non-salvageable. */
  salvageable: z.boolean().optional(),
});
export type DebrisSnapshot = z.infer<typeof DebrisSnapshot>;

/** A single frame of recorded battle state, for replay rendering. */
export const BattleFrame = z.object({
  tick: z.number().int().min(0),
  ships: z.array(ShipSnapshot),
  projectiles: z.array(ProjectileSnapshot),
  /**
   * Optional awareness data for this tick. Absent on battles recorded before
   * the sensor/comms system (Phase C) was active, so older replays parse cleanly.
   */
  awareness: AwarenessSnapshot.optional(),
  /** New-entity arrays. Each is omitted when empty so frames without that
   *  mechanic stay byte-identical to replays recorded before it existed. */
  drones: z.array(DroneSnapshot).optional(),
  mines: z.array(MineSnapshot).optional(),
  decoys: z.array(DecoySnapshot).optional(),
  pods: z.array(BoardingPodSnapshot).optional(),
  pulses: z.array(PulseSnapshot).optional(),
  /** Continuous EM emissions this tick (Phase 9 reception model). Omitted when
   *  empty so frames recorded before EM reception stay byte-identical. */
  emissions: z.array(EmissionSnapshot).optional(),
  /** Wreckage drifting this tick (Phase 12). Omitted while no ship has yet been
   *  destroyed so frames recorded before debris existed stay byte-identical. */
  debris: z.array(DebrisSnapshot).optional(),
  /**
   * Per-ship atmosphere / breach summary this tick. Emitted for any ship whose
   * resource state is available and whose atmosphere field is non-trivial (i.e.
   * the ship runs the resource step). Omitted when empty so frames for battles
   * without life-support stay byte-identical to baseline. The breach overlay
   * reads this to draw decompress hazes and venting indicators.
   *
   * `breachedCells` counts cells below the survivable gas-mass threshold;
   * `atmosphereLevel` is the mean gas mass across all module cells, normalised
   * to [0, 1] where 1 is full cabin pressure. Optional for backward compatibility.
   */
  atmosphere: z.array(
    z.object({
      shipId: EntityId,
      breachedCells: z.number().int().min(0),
      atmosphereLevel: z.number().min(0).max(1),
    }),
  ).optional(),
});
export type BattleFrame = z.infer<typeof BattleFrame>;

/** Per-ship identity carried once per battle (not per tick): the faction and
 *  side of each combatant, keyed by instance id, so the renderer can colour
 *  ships by faction without bloating every frame's ship snapshots. */
export const ShipRosterEntry = z.object({
  instanceId: EntityId,
  faction: z.string().min(1),
  side: z.enum(["attacker", "defender"]),
});
export type ShipRosterEntry = z.infer<typeof ShipRosterEntry>;

/** A completed battle, with enough data to replay it. */
export const BattleResult = z.object({
  id: EntityId,
  config: BattleConfig,
  winner: BattleSide,
  ticks: z.number().int().min(0),
  playedAt: IsoTimestamp,
  frames: z.array(BattleFrame),
  /**
   * Faction/side of each combatant, for faction-coloured rendering. Optional so
   * replays recorded before the factions update still parse; the renderer falls
   * back to side-only colour when absent.
   */
  roster: z.array(ShipRosterEntry).optional(),
  /**
   * Static per-ship descriptors (cell layout + outline), emitted ONCE for the
   * whole battle so the per-tick frames carry only dynamic cell state. The
   * renderer reconstructs each cell's world position from the ship pose plus the
   * static offset here. One entry per ship instance that ever appears, including
   * break-away chunks. Optional so replays recorded before the slim-snapshot
   * change still parse (those carry the layout inline in each frame).
   */
  descriptors: z.array(ShipDescriptor).optional(),
  /**
   * Per-ship salvage earned over the battle (salvage mechanics): the total
   * `salvageMass` (kg) of drifting debris a ship swept up, and the instanceIds of
   * the derelict enemy hulls it claimed. One entry per ship that salvaged
   * anything, in instanceId order; ships that recovered nothing are omitted.
   * Optional so replays recorded before salvage mechanics still parse and so a
   * battle with no salvage carries no entry — the post-battle summary reads this
   * to show salvage earned.
   */
  salvage: z
    .array(
      z.object({
        shipId: EntityId,
        salvageMass: z.number().min(0),
        claimedHulls: z.array(EntityId),
      }),
    )
    .optional(),
});
export type BattleResult = z.infer<typeof BattleResult>;

/**
 * A {@link BattleResult} minus its `frames`. The worker streams frames in
 * batches during the run (each `{ kind: 'frames' }` message) and posts a
 * summary as the final `{ kind: 'result' }` message; the main thread
 * reassembles the full `BattleResult` by appending the accumulated streamed
 * frames to the summary via {@link assembleResult}. Carrying the summary
 * instead of the full result on the terminal message avoids re-sending the
 * entire frame array — which was already streamed — so the end-of-battle
 * handler no longer blocks the main thread re-cloning and deep-parsing
 * hundreds of megabytes of frames.
 */
export type BattleResultSummary = Omit<BattleResult, "frames">;

/** Worker→main streaming protocol for progressive battle playback. Discriminated
 * on 'kind': 'frames' delivers a batch of computed frames with the highest tick
 * index seen so far; 'result' delivers the final battle outcome as a summary
 * (the full frames were already streamed in batches). Validated at the thread
 * boundary just like BattleResult, ensuring type safety across the worker
 * channel. */
export const BattleStreamMessage = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("frames"),
    frames: z.array(BattleFrame),
    computedTicks: z.number().int().min(0),
    /**
     * Static descriptors for ship instances that FIRST appeared in this batch
     * (including break-away chunks), so the renderer can reconstruct cell world
     * positions for the freshly streamed frames before the final result lands.
     * Empty when the batch introduced no new instances.
     */
    descriptors: z.array(ShipDescriptor),
    /**
     * The latest captured {@link EngineCheckpoint} at the time this batch was
     * posted, or `undefined` when the worker is not capturing (a fresh run with
     * no resume requested never captures). The checkpoint may be a few ticks
     * behind the batch's last frame: the worker emits one per cadence, so the
     * latest captured at posting time is the most recent tick the cadence hit.
     * The UI resume decorator persists it so an interrupted run resumes from
     * there instead of recomputing from tick 0.
     */
    checkpoint: EngineCheckpoint.optional(),
  }),
  z.object({
    kind: z.literal("result"),
    summary: BattleResult.omit({ frames: true }),
  }),
]);
export type BattleStreamMessage = z.infer<typeof BattleStreamMessage>;
