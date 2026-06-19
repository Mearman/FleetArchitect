import type { HullTileType, TileGrid } from "@/schema/grid";

/** Default grid dimensions for a fresh design. */
export const DEFAULT_COLS = 5;
export const DEFAULT_ROWS = 5;

/** Maximum grid dimension (columns or rows) the designer will allow. */
export const MAX_DIM = 12;

/** The four hull tile varieties the palette exposes for painting. */
export const HULL_TILES: HullTileType[] = ["block", "edge", "corner", "strut"];

/** The four cardinal facings, in radians, ship-local (0 = forward / +x). */
export const FACINGS: { value: string; label: string }[] = [
  { value: "0", label: "Fwd" },
  { value: `${Math.PI / 2}`, label: "Down" },
  { value: `${Math.PI}`, label: "Aft" },
  { value: `${-Math.PI / 2}`, label: "Up" },
];

/** A design being edited, before it has been persisted. `id`/`createdAt` are
 *  null until the first save. */
export interface WorkingDesign {
  id: string | null;
  createdAt: string | null;
  name: string;
  faction: string;
  grid: TileGrid;
}

/** The thing the user is painting with. `empty` clears a cell; `hull` paints a
 *  hull tile of the chosen type; `module` paints a module cell; `floor` paints
 *  walkable interior decking (corridor or crew-quarters space). */
export type Brush =
  | { kind: "empty" }
  | { kind: "hull"; tile: HullTileType }
  | { kind: "module"; moduleId: string }
  | { kind: "floor" };
