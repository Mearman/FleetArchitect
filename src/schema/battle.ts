import { z } from "zod";
import { EntityId, IsoTimestamp } from "./primitives";
import { WeaponType } from "./module";

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
        ]),
        /** Position in ship-local (design) coordinates, for rendering. */
        x: z.number(),
        y: z.number(),
        hp: z.number(),
        maxHp: z.number(),
        alive: z.boolean(),
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
});
export type ShipSnapshot = z.infer<typeof ShipSnapshot>;

/** A visible projectile at a tick, for rendering weapon fire during replay. */
export const ProjectileSnapshot = z.object({
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
});
export type BattleFrame = z.infer<typeof BattleFrame>;

/** A completed battle, with enough data to replay it. */
export const BattleResult = z.object({
  id: EntityId,
  config: BattleConfig,
  winner: BattleSide,
  ticks: z.number().int().min(0),
  playedAt: IsoTimestamp,
  frames: z.array(BattleFrame),
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
