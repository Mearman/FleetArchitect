import { z } from "zod";
import { HullTileType } from "./grid";

/**
 * A ship's size tier. No longer authored: it is derived from the number of
 * occupied cells in the ship's grid (see `deriveClassification`). Kept as a
 * value for UI labelling, targeting flavour, and the engine's per-class
 * collision-radius and base-mass tables for the legacy aggregated path.
 */
export const ShipClassification = z.enum([
  "fighter",
  "frigate",
  "cruiser",
  "dreadnought",
]);
export type ShipClassification = z.infer<typeof ShipClassification>;

/**
 * A structural hull-tile type. A ship is built from these in its grid; each
 * type contributes `mass` to the ship's total and `hp` as its break-apart
 * anchor strength. The four shapes (corner, edge, strut, block) differ only
 * in their stats and render metadata — the grid records which type sits in a
 * cell, the catalog defines what that type weighs and how much punishment it
 * takes.
 *
 * `faction` identifies which race's part set this tile belongs to. A valid
 * design uses tiles and modules from exactly one faction.
 */
export const HullTileDefinition = z.object({
  type: HullTileType,
  name: z.string().min(1),
  faction: z.string().min(1),
  /** Structural mass contributed by one tile of this type. */
  mass: z.number().min(0),
  /** Hit points of one tile of this type — its break-apart anchor strength. */
  hp: z.number().min(0),
});
export type HullTileDefinition = z.infer<typeof HullTileDefinition>;
