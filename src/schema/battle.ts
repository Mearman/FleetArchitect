import { z } from "zod";
import { EntityId, IsoTimestamp } from "./primitives";
import { WeaponType } from "./module";
import { DoorState, SurfaceKind } from "./grid";

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

/** Environmental modifier for a battle (GSB's "spatial anomalies"). */
export const BattleAnomaly = z.enum([
  "none",
  "asteroidField",
  "nebula",
  "blackHole",
]);
export type BattleAnomaly = z.infer<typeof BattleAnomaly>;

/** The inputs to a battle. The seed makes the outcome deterministic. */
export const BattleConfig = z.object({
  attackerFleetId: EntityId,
  defenderFleetId: EntityId,
  anomaly: BattleAnomaly,
  seed: z.number().int(),
});
export type BattleConfig = z.infer<typeof BattleConfig>;

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
  /** Per-module state, present when the ship runs the per-module damage
   *  model. Optional for backward compatibility with older replays. */
  modules: z
    .array(
      z.object({
        slotId: EntityId,
        kind: z.enum([
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
        ]),
        /** Position in ship-local (design) coordinates, for rendering. */
        x: z.number(),
        y: z.number(),
        /** Surface kind of this cell (bare/deck/armor). Optional for backward
         *  compatibility with replays recorded before the grid model. */
        surface: SurfaceKind.optional(),
        /** Current HP of the surface layer (armour or deck). Zero for bare cells.
         *  Optional for backward compatibility. */
        surfaceHp: z.number().optional(),
        /** Maximum HP of the surface layer. Optional for backward compatibility. */
        maxSurfaceHp: z.number().optional(),
        hp: z.number(),
        maxHp: z.number(),
        alive: z.boolean(),
        /** Live door states for a module that has at least one door edge, keyed by
         *  direction. Absent on modules with no doors so older replays stay
         *  byte-identical. Optional for backward compatibility. */
        doorStates: z
          .object({
            n: DoorState.optional(),
            e: DoorState.optional(),
            s: DoorState.optional(),
            w: DoorState.optional(),
          })
          .optional(),
        /**
         * For weapon modules with a turret: the live barrel angle in
         * radians, ship-local — the direction the turret has slewed to this
         * tick. The renderer draws the barrel along `ship.facing + turretAngle`
         * so a turret visibly tracks its target. Absent on fixed mounts and
         * non-weapon modules (their barrel always points along the module's
         * mount facing). Optional for backward compatibility with older
         * replays.
         */
        turretAngle: z.number().optional(),
        /** Whether this module is manned by crew. Optional for backward compatibility. */
        manned: z.boolean().optional(),
        /** Ammo remaining in a weapon module. Optional, complements WeaponEffect.ammo. */
        ammo: z.number().int().min(0).optional(),
        /** Charge level or progress for applicable modules. Optional for backward compatibility. */
        charge: z.number().optional(),
      }),
    )
    .optional(),
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
  /** Chamfered hull outline polygon loops (Vec2 vertices in ship-local metres).
   *  Render-only; present on modular ships with armor cells. */
  outline: z.array(z.array(z.object({ x: z.number(), y: z.number() }))).optional(),
  /**
   * Per-ship resource state (Phase 12 wiring). Emitted when the ship runs the
   * resource step (modular ships only). Arrays are module-sparse: index `i`
   * corresponds to the module at dense position `i` (modules sorted by
   * (row, col)). Absent on legacy aggregated ships and phantoms; absent when the
   * resource step has not been wired in. Optional for backward compatibility.
   */
  resource: z
    .object({
      /** Thermal field: temperature (K) for each module cell. */
      thermal: z.array(z.number()),
      /** Propellant field: fuel mass (kg) for each module cell. */
      propellant: z.array(z.number()),
      /** Atmosphere field: gas mass (kg) for each module cell. */
      atmosphere: z.array(z.number()),
      /** Ship-wide power capacitor state. */
      powerBuffer: z.object({
        energy: z.number().min(0),
        capacityJoules: z.number().min(0),
      }),
    })
    .optional(),
});
export type ShipSnapshot = z.infer<typeof ShipSnapshot>;

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
});
export type BoardingPodSnapshot = z.infer<typeof BoardingPodSnapshot>;

/** An active-radar pulse in flight at a tick (Phase 8). An expanding sphere of
 *  EM at world origin (x, y) with current `radius`; the renderer draws it as an
 *  expanding ring. An outbound ping has `reflectedFrom` absent; a reflection
 *  (a return scattered off the enemy ship `reflectedFrom`) carries that id so the
 *  renderer can tint returns differently. `bearing`/`arc` describe the
 *  illuminated cone (arc >= PI is a full sphere). */
export const PulseSnapshot = z.object({
  id: z.number().int(),
  emitterId: EntityId,
  reflectedFrom: EntityId.optional(),
  x: z.number(),
  y: z.number(),
  radius: z.number().min(0),
  bearing: z.number(),
  arc: z.number(),
});
export type PulseSnapshot = z.infer<typeof PulseSnapshot>;

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
});
export type BattleResult = z.infer<typeof BattleResult>;

/** Worker→main streaming protocol for progressive battle playback. Discriminated
 * on 'kind': 'frames' delivers a batch of computed frames with the highest tick
 * index seen so far; 'result' delivers the final battle outcome. Validated at
 * the thread boundary just like BattleResult, ensuring type safety across the
 * worker channel. */
export const BattleStreamMessage = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("frames"),
    frames: z.array(BattleFrame),
    computedTicks: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal("result"),
    result: BattleResult,
  }),
]);
export type BattleStreamMessage = z.infer<typeof BattleStreamMessage>;
