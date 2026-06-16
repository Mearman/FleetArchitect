import { z } from "zod";
import { EntityId, IsoTimestamp } from "./primitives";

/** A module installed into a specific hull slot. */
export const ModulePlacement = z.object({
  slotId: EntityId,
  moduleId: EntityId,
});
export type ModulePlacement = z.infer<typeof ModulePlacement>;

/**
 * A player-designed ship: a hull plus the set of modules installed into its
 * slots. This is the unit of persistence and sharing for individual ships.
 */
export const ShipDesign = z.object({
  id: EntityId,
  name: z.string().min(1),
  hullId: EntityId,
  faction: z.string().min(1),
  placements: z.array(ModulePlacement),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});
export type ShipDesign = z.infer<typeof ShipDesign>;
