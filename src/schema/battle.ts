import { z } from "zod";
import { EntityId, IsoTimestamp } from "./primitives";
import { WeaponType } from "./module";

/** A side in a battle. `draw` is only a battle outcome, never a ship's side. */
export const BattleSide = z.enum(["attacker", "defender", "draw"]);
export type BattleSide = z.infer<typeof BattleSide>;

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
