import { z } from "zod";
import { EntityId, IsoTimestamp } from "./primitives";
import { TileGrid } from "./grid";
import { ShipStance, CrewPriority, Rule } from "./ai";

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
 * The AI and provenance fields are additive: every one carries a `.default()`
 * so designs authored before this schema version parse unchanged. The
 * simulation does not yet read `shipStance`/`crewPriority`/`rules` — that
 * interpreter lands in a later phase — but the values are persisted now so
 * designs capture the author's intent at the point of creation.
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
  /** Base posture; overridden and extended by `rules`. */
  shipStance: ShipStance.default("balanced"),
  /** Crew task-scheduler priority mode. */
  crewPriority: CrewPriority.default("combat"),
  /**
   * Player-authored trigger/action rules, evaluated in list order each tick.
   * Empty by default — the stance alone governs behaviour.
   */
  rules: z.array(Rule).default([]),
});
export type ShipDesign = z.infer<typeof ShipDesign>;
