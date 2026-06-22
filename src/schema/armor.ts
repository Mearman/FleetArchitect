import { z } from "zod";

/**
 * A ship's size tier. Derived from the number of occupied cells in the ship's
 * grid (see `deriveClassification` in `src/domain/grid.ts`). Used for UI
 * labelling, targeting flavour, and the legacy aggregated engine path's
 * per-class collision-radius and base-mass tables (Phase 1 will retire that
 * path; until then the classification still keys those lookups).
 */
export const ShipClassification = z.enum([
  "fighter",
  "frigate",
  "cruiser",
  "dreadnought",
]);
export type ShipClassification = z.infer<typeof ShipClassification>;

/**
 * A per-faction material definition for one layer of a built cell
 * (`substrate`, `deck`, or `armor`). All values are authored catalogue content
 * — the game's content, not engine knobs — and each is documented as the
 * physical quantity it represents (`mass = materialDensity * cellArea *
 * plateThickness`, `hp = energy to destroy the material volume`) so future
 * content authors know what they are tuning.
 *
 * Phase 2 ports the existing per-faction armour stats verbatim from the
 * retired `ArmourEffect` modules: `hp` becomes the surface HP of one armor
 * cell, `damageReduction` becomes the fraction of incoming damage the plate
 * absorbs before it reaches the cell, `mass` becomes the per-cell mass. The
 * reactive fields are carried for Foundry but not yet consumed by the damage
 * pipeline (Phase 4 unifies damage).
 */
export const LayerMaterial = z.object({
  /** Which layer this material describes. */
  layer: z.enum(["substrate", "deck", "armor"]),
  faction: z.string().min(1),
  /** Energy required to destroy one cell of this layer (damage points in the
   *  current model; joules once Phase 4 unifies damage). Authored as
   *  `materialDensity * cellArea * plateThickness * specificDestructionEnergy`
   *  and recorded as the resulting value. */
  hp: z.number().min(0),
  /** Fraction of incoming damage absorbed before it reaches the cell (0..1).
   *  Meaningful only for `armor`; 0 for substrate and deck. */
  damageReduction: z.number().min(0).max(1).default(0),
  /** Per-cell mass. Authored as `materialDensity * cellArea * plateThickness`
   *  and recorded as the resulting value. */
  mass: z.number().min(0),
  /** Optional reactive-armour behaviour (Foundry armor). When present, an extra
   *  damageReduction fraction applied to a hit and then spent, recharging over
   *  `reactiveWindow` ticks. Ported verbatim from the retired ArmourEffect
   *  fields; consumed by the damage pipeline (Phase 2 ports the existing
   *  reactive behaviour via the per-module `reactiveCharge` timer). */
  reactiveReduction: z.number().min(0).max(1).optional(),
  reactiveWindow: z.number().int().min(0).optional(),
});
export type LayerMaterial = z.infer<typeof LayerMaterial>;
