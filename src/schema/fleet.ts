import { z } from "zod";
import { EntityId, Vec2, IsoTimestamp } from "./primitives";
import { Formation } from "./formation";
import { Doctrine } from "./ai";

/** A ship's deployment in a fleet: which design, where, facing which way. */
export const FleetShip = z.object({
  designId: EntityId,
  position: Vec2,
  facing: z.number(),
  /**
   * Per-ship doctrine override. Overrides the design's doctrine at the leaf:
   * the fleet-ship doctrine's base axes win over the design's, and its rule
   * list is evaluated before the design's. A fleet persisted before the
   * doctrine overhaul carries a legacy `orders` object; the storage read
   * boundary (`normaliseFleetInput`) compiles it into a doctrine at parse
   * time, so a record written under the old shape parses under the new one.
   */
  doctrine: Doctrine.optional(),
});
export type FleetShip = z.infer<typeof FleetShip>;

/**
 * Whether a fleet was authored by the player or shipped as a built-in preset.
 * Presets are read-only; the storage layer rejects any attempt to overwrite one.
 */
export const FleetSource = z.enum(["preset", "user"]);
export type FleetSource = z.infer<typeof FleetSource>;

/**
 * A fleet: a named formation tree of deployed ships. The unit of persistence
 * and sharing for force composition, and the input to a battle.
 *
 * A fleet is a single root {@link Formation} whose children are ship leaves (the
 * atomic unit — a lone ship needs no wrapping asset), nested sub-formations, or
 * references to a reusable formation template (expanded inline before resolve).
 * A flat root of ship leaves with no `layout` resolves to the legacy deployment
 * column byte-identically, so a fleet lifted from the former flat `ships[]` form
 * fights exactly as before.
 *
 * `source` and `revision` are additive (`.default()`-ed) so existing fleets
 * parse unchanged. They mirror {@link ShipDesign}'s provenance fields: preset
 * fleets are bundled catalogue content (read-only, no history); user fleets
 * are player-authored and accrue a revision on each version-history snapshot.
 */
export const Fleet = z.object({
  id: EntityId,
  name: z.string().min(1),
  faction: z.string().min(1),
  // `Formation` is a live binding resolved through the fleet.ts ↔ formation.ts
  // import cycle; wrap it in z.lazy so the reference is read at parse time
  // (after both modules have finished initialising), not at schema-construction
  // time when the binding is still undefined. Mirrors the deferred `FleetShip`
  // reference inside formation.ts's own z.lazy.
  formation: z.lazy(() => Formation),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
  /** Whether this record is a bundled preset or a player-authored fleet. */
  source: FleetSource.default("user"),
  /**
   * Monotonically increasing revision number, bumped on each save that creates
   * a version-history snapshot. Starts at 1 for fresh fleets; presets stay on
   * their authored revision.
   */
  revision: z.number().int().min(1).default(1),
});
export type Fleet = z.infer<typeof Fleet>;
