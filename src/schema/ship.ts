import { z } from "zod";
import { EntityId, IsoTimestamp } from "./primitives";
import { TileGrid } from "./grid";
import { Doctrine } from "./ai";

/**
 * Provenance of a persisted record. `preset` records are bundled catalogue
 * content: they are read-only in the designer and never accrue version
 * history. `user` records are player-authored and fully editable. Defaults to
 * `user` so existing designs — which have no `source` field — parse as
 * player-owned.
 */
/**
 * Whether a design was authored by the player or shipped as a built-in preset.
 * Presets are read-only; the storage layer rejects any attempt to overwrite one.
 */
export const DesignSource = z.enum(["preset", "user"]);
export type DesignSource = z.infer<typeof DesignSource>;

/**
 * A player-designed ship: an authoritative 2D tile grid of hull and module
 * cells. The grid is the single source of truth for the ship's shape, mass,
 * connectivity, and the position of every module — there is no separate hull
 * id or slot/placement list. This is the unit of persistence and sharing for
 * individual ships.
 *
 * Behaviour is authored solely through `doctrine` (the unified vocabulary over
 * the spatial, targeting, fire, stance, crew, cohesion, and retreat axes). A
 * design persisted before the doctrine overhaul carries the legacy trio
 * `shipStance` / `crewPriority` / `rules`; the storage read boundary
 * (`normaliseDesignInput`) compiles that trio into a doctrine at parse time,
 * so a record written under the old shape parses under the new one.
 */
export const ShipDesign = z.object({
  id: EntityId,
  name: z.string().min(1),
  faction: z.string().min(1),
  grid: TileGrid,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
  /** Whether this record is a bundled preset or a player-authored design. */
  source: DesignSource.default("user"),
  /**
   * Monotonically increasing revision number, bumped on each save that creates
   * a version-history snapshot. Starts at 1 for fresh designs; presets stay on
   * their authored revision.
   */
  revision: z.number().int().min(1).default(1),
  /**
   * The ship's behaviour: a base action plus an ordered list of conditional
   * rules. Required with an empty default so a design literal need not set it
   * (absent doctrine parses to "no rules, empty base" — pure legacy behaviour);
   * every runtime read path also fills it via the normaliser when a stored
   * record carries the legacy trio instead.
   */
  doctrine: Doctrine.default({ base: {}, rules: [] }),
});
export type ShipDesign = z.infer<typeof ShipDesign>;
