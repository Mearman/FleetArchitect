import type { SurfaceKind } from "@/schema/grid";
import type { CrewPriority, Rule, ShipStance } from "@/schema/ai";
import type { TileGrid } from "@/schema/grid";

/** Default grid dimensions for a fresh design. */
export const DEFAULT_COLS = 5;
export const DEFAULT_ROWS = 5;

/** Maximum grid dimension (columns or rows) the designer will allow. */
export const MAX_DIM = 12;

/** The four cardinal facings, in radians, ship-local (0 = forward / +x). */
export const FACINGS: { value: string; label: string }[] = [
  { value: "0", label: "Fwd" },
  { value: `${Math.PI / 2}`, label: "Down" },
  { value: `${Math.PI}`, label: "Aft" },
  { value: `${-Math.PI / 2}`, label: "Up" },
];

/** The four cell-edge directions, in display order. */
export const EDGE_DIRS: ("n" | "e" | "s" | "w")[] = ["n", "e", "s", "w"];

/** A design being edited, before it has been persisted. `id`/`createdAt` are
 *  null until the first save. `source` carries the provenance: a `preset`
 *  design loads read-only; copying it flips this to `user` and clears the id
 *  so the copy saves as a new record. */
export interface WorkingDesign {
  id: string | null;
  createdAt: string | null;
  name: string;
  faction: string;
  grid: TileGrid;
  source: "preset" | "user";
  shipStance: ShipStance;
  crewPriority: CrewPriority;
  /** Player-authored trigger/action rules, evaluated in list order each tick. */
  rules: Rule[];
}

/**
 * The thing the user is painting with. The brush vocabulary mirrors the
 * layered cell model from {@link import("@/schema/grid").SolidCell}:
 *
 *  - `empty`               — clear a cell back to empty (remove substrate + all layers).
 *  - `substrate-<surface>`  — paint a fresh substrate cell carrying that surface.
 *  - `add-surface`         — add/replace a surface on an existing substrate cell
 *                            (does not disturb substrate, edges, or equipment
 *                            unless the new surface forbids it; armor strips
 *                            equipment per the schema refine).
 *  - `remove-surface`      — strip the surface off a substrate cell, leaving a
 *                            bare substrate frame (the cell keeps its substrate;
 *                            use `empty` to remove the whole cell).
 *  - `edge-wall`           — clicking an edge toggles it to/from `wall`.
 *  - `edge-door`           — clicking an edge toggles it to/from `door`; a
 *                            subsequent click on a door edge cycles its state
 *                            between closed and open.
 *  - `equipment`           — mount a module on a deck/bare cell (at most one
 *                            per cell; armor forbids equipment, per the schema).
 *
 * Edge brushes operate on the cell that owns the edge in the direction of the
 * click, so a single click on a shared boundary paints one side. The opposite
 * cell's edge is independent (the schema models edges per-cell).
 */
export type Brush =
  | { kind: "empty" }
  | { kind: "substrate-bare" }
  | { kind: "substrate-deck" }
  | { kind: "substrate-armor" }
  | { kind: "add-surface"; surface: Exclude<SurfaceKind, "bare"> }
  | { kind: "remove-surface" }
  | { kind: "edge-wall" }
  | { kind: "edge-door" }
  | { kind: "equipment"; moduleId: string };

/** The list of surfaces that can be added to an existing substrate cell via the
 *  `add-surface` brush. `bare` is the absence of a surface, not a surface you
 *  add — use `remove-surface` to get there. */
export const ADDABLE_SURFACES: Exclude<SurfaceKind, "bare">[] = ["deck", "armor"];
