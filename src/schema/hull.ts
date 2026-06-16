import { z } from "zod";
import { EntityId, Vec2 } from "./primitives";
import { ModuleSlotType } from "./module";

export const ShipClassification = z.enum([
  "fighter",
  "frigate",
  "cruiser",
  "dreadnought",
]);
export type ShipClassification = z.infer<typeof ShipClassification>;

/**
 * A slot on a hull where a module of the matching type can be installed.
 * `position` is relative to the hull centre, used both for rendering and to
 * derive weapon firing arcs / engine placement in the sim.
 */
export const HullSlot = z.object({
  id: EntityId,
  type: ModuleSlotType,
  position: Vec2,
});
export type HullSlot = z.infer<typeof HullSlot>;

/** Outline polygon (relative coordinates) for rendering the hull silhouette. */
export const HullShape = z.object({
  outline: z.array(Vec2).min(3),
});
export type HullShape = z.infer<typeof HullShape>;

/**
 * A hull as it appears in the catalog: the chassis a ship design is built on.
 * Hulls carry base structure and base mobility; modules add to or modify these.
 */
export const HullDefinition = z.object({
  id: EntityId,
  name: z.string().min(1),
  faction: z.string().min(1),
  classification: ShipClassification,
  massCapacity: z.number().min(0),
  baseCost: z.number().min(0),
  baseStructure: z.number().min(0),
  baseSpeed: z.number().min(0),
  baseTurnRate: z.number().min(0),
  slots: z.array(HullSlot).min(1),
  shape: HullShape,
});
export type HullDefinition = z.infer<typeof HullDefinition>;
