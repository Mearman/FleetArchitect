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

/** A single frame of recorded battle state, for replay rendering. */
export const BattleFrame = z.object({
  tick: z.number().int().min(0),
  ships: z.array(ShipSnapshot),
  projectiles: z.array(ProjectileSnapshot),
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
