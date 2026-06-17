import { z } from "zod";
import { EntityId, IsoTimestamp } from "./primitives";
import { TileGrid } from "./grid";

/**
 * A player-designed ship: an authoritative 2D tile grid of hull and module
 * cells. The grid is the single source of truth for the ship's shape, mass,
 * connectivity, and the position of every module — there is no separate hull
 * id or slot/placement list. This is the unit of persistence and sharing for
 * individual ships.
 */
export const ShipDesign = z.object({
  id: EntityId,
  name: z.string().min(1),
  faction: z.string().min(1),
  grid: TileGrid,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});
export type ShipDesign = z.infer<typeof ShipDesign>;
