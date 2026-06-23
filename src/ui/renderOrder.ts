import { type ShipSnapshot } from "@/schema/battle";

/**
 * The back-to-front draw-order key for a ship at world `(x, y)`. Lower keys
 * paint first (further "back"); higher keys paint last (closer / in front).
 * Defaults to world-y (the flat top-down depth); the isometric view supplies
 * `x + y` so depth runs along the diamond instead of straight down the screen.
 */
export type ShipDepth = (x: number, y: number) => number;

/** Flat top-down depth: a ship lower on screen (larger y) sits in front. */
const FLAT_DEPTH: ShipDepth = (_x, y) => y;

/**
 * Order ships back-to-front for canvas rendering.
 *
 * The battle renderer paints each ship entirely before moving to the next, so
 * the iteration order decides which ship overlaps which. The snapshot emits
 * ships in simulation array order (attackers, then defenders), which has
 * nothing to do with where they sit on screen — a defender high up would paint
 * over an attacker below it. Sorting by a depth key (smaller, further "back" /
 * top of screen, first; larger, closer / bottom, last) gives a natural overlap
 * where ships nearer the viewer sit in front.
 *
 * The depth key defaults to world-y (the flat top-down view). Under the
 * isometric projection both world axes contribute, so the caller passes the
 * projection's `depth` (`x + y`) to order along the tilted plane.
 *
 * Ties on depth break by `instanceId` so the order is fully deterministic: no
 * flicker between frames and reproducible in tests.
 *
 * Pure: returns a new array and never mutates its input.
 */
export function orderShipsForRender(
  ships: readonly ShipSnapshot[],
  depth: ShipDepth = FLAT_DEPTH,
): ShipSnapshot[] {
  return [...ships].sort((a, b) => {
    const da = depth(a.x, a.y);
    const db = depth(b.x, b.y);
    if (da !== db) return da - db;
    return a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0;
  });
}
