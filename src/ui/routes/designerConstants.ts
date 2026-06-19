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

/** A design being edited, before it has been persisted. `id`/`createdAt` are
 *  null until the first save. */
export interface WorkingDesign {
  id: string | null;
  createdAt: string | null;
  name: string;
  faction: string;
  grid: TileGrid;
}

/** The thing the user is painting with. `empty` clears a cell; `scaffold-bare`,
 *  `scaffold-deck`, and `scaffold-armor` paint a built cell with that surface
 *  (and all-open edges); `equipment` paints an equipment module on a deck cell.
 *
 *  This is the minimal Phase 2 brush set: enough to reproduce every preset
 *  shape and let a player build a layered ship. The full Phase 8 designer UX
 *  adds wall/door edge toggles, airtightness feedback, and surface
 *  add/remove on existing scaffold cells. */
export type Brush =
  | { kind: "empty" }
  | { kind: "scaffold-bare" }
  | { kind: "scaffold-deck" }
  | { kind: "scaffold-armor" }
  | { kind: "equipment"; moduleId: string };
