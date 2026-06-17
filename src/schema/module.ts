import { z } from "zod";
import { EntityId } from "./primitives";

/**
 * The kind of hull slot a module may occupy. A hull lays out slots of these
 * types; a module declares which slot type it fits into.
 */
export const ModuleSlotType = z.enum([
  "weapon",
  "general",
  "engine",
  "system",
]);
export type ModuleSlotType = z.infer<typeof ModuleSlotType>;

/** How a weapon delivers damage; drives projectile behaviour in the sim. */
export const WeaponType = z.enum([
  "beam",
  "cannon",
  "missile",
  "torpedo",
  "plasma",
]);
export type WeaponType = z.infer<typeof WeaponType>;

const zeroToOne = z.number().min(0).max(1);

/** Effect payload for an offensive module. `projectileSpeed: 0` means hitscan.
 *  `ammo` is the finite magazine; when omitted the weapon gets a large default
 *  (`DEFAULT_WEAPON_AMMO`) and effectively never runs dry. */
export const WeaponEffect = z.object({
  kind: z.literal("weapon"),
  weaponType: WeaponType,
  damage: z.number().min(0),
  range: z.number().min(0),
  cooldown: z.number().int().min(0),
  projectileSpeed: z.number().min(0),
  tracking: z.number().min(0),
  shieldPiercing: zeroToOne,
  armourPiercing: zeroToOne,
  spread: z.number().min(0),
  /** Finite magazine; consumes 1 per shot and cannot fire at 0. */
  ammo: z.number().int().min(0).optional(),
});

/** Default ammo for weapons that omit the field. Large enough that a weapon
 *  without an explicit magazine effectively never runs dry in a normal battle,
 *  while still capping pathological infinite-fire loops. */
export const DEFAULT_WEAPON_AMMO = 9999;
export type WeaponEffect = z.infer<typeof WeaponEffect>;

/** Effect payload for a shield generator. */
export const ShieldEffect = z.object({
  kind: z.literal("shield"),
  capacity: z.number().min(0),
  rechargeRate: z.number().min(0),
  rechargeDelay: z.number().int().min(0),
});
export type ShieldEffect = z.infer<typeof ShieldEffect>;

/** Effect payload for armour plating (structure + damage reduction). */
export const ArmourEffect = z.object({
  kind: z.literal("armour"),
  hitpoints: z.number().min(0),
  damageReduction: zeroToOne,
});
export type ArmourEffect = z.infer<typeof ArmourEffect>;

/** Effect payload for a propulsion module. */
export const EngineEffect = z.object({
  kind: z.literal("engine"),
  thrust: z.number().min(0),
  turnRate: z.number().min(0),
});
export type EngineEffect = z.infer<typeof EngineEffect>;

/** Effect payload for a power plant. */
export const PowerPlantEffect = z.object({
  kind: z.literal("power"),
  output: z.number().min(0),
});
export type PowerPlantEffect = z.infer<typeof PowerPlantEffect>;

/** Effect payload for crew quarters / life support. */
export const CrewEffect = z.object({
  kind: z.literal("crew"),
  capacity: z.number().min(0),
});
export type CrewEffect = z.infer<typeof CrewEffect>;

/**
 * Effect payload for a damage-control / repair bay. Each tick, every alive
 * repair module on a ship heals the HP of one damaged alive module on the
 * same ship by `repairRate` (capped at the target's max HP). A repair module
 * with a `repairRate` of 0 is inert; v1 keeps repair module-driven and does
 * not depend on crew. A typical value is around 2 HP/tick — small per tick,
 * so a single bay can't undo a salvo in one frame but stacks with others
 * and lets the ship stay in the fight longer than it otherwise would.
 */
export const RepairEffect = z.object({
  kind: z.literal("repair"),
  repairRate: z.number().min(0),
});
export type RepairEffect = z.infer<typeof RepairEffect>;

/**
 * Discriminated union of all module effects. New module kinds extend this.
 */
export const ModuleEffect = z.discriminatedUnion("kind", [
  WeaponEffect,
  ShieldEffect,
  ArmourEffect,
  EngineEffect,
  PowerPlantEffect,
  CrewEffect,
  RepairEffect,
]);
export type ModuleEffect = z.infer<typeof ModuleEffect>;

/**
 * A module as it appears in the catalog: a fixed, shareable definition.
 * Ship designs reference modules by id; the catalog is bundled with the app
 * and versioned with it, so it is never stored per-design.
 */
export const ModuleDefinition = z.object({
  id: EntityId,
  name: z.string().min(1),
  description: z.string(),
  category: z.enum(["weapon", "defence", "propulsion", "system", "crew"]),
  slotType: ModuleSlotType,
  mass: z.number().min(0),
  cost: z.number().min(0),
  /** Power required to run this module (always >= 0). Supply comes from the effect. */
  powerDraw: z.number().min(0),
  /** Crew required to operate this module (always >= 0). Supply comes from the effect. */
  crewRequired: z.number().min(0),
  effect: ModuleEffect,
  techLevel: z.number().int().min(1).max(5),
  /**
   * Whether this module serves as the ship's bridge / command module. A ship
   * needs at least one alive command module to coordinate its weapons; destroy
   * every command module and the ship can no longer fire. Optional for backward
   * compatibility — modules that omit it are not command modules.
   */
  command: z.boolean().optional(),
});
export type ModuleDefinition = z.infer<typeof ModuleDefinition>;
