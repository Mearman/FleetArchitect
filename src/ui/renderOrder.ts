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
 * The back-to-front depth comparison for two ships: smaller depth (further
 * "back") first, ties broken by `instanceId` for a fully deterministic, stable
 * total order. Shared by the pure {@link orderShipsForRender} and the
 * buffer-reusing {@link orderShipsForRenderInto} so the ordering rule lives in
 * exactly one place.
 */
function compareShipDepth(a: ShipSnapshot, b: ShipSnapshot, depth: ShipDepth): number {
  const da = depth(a.x, a.y);
  const db = depth(b.x, b.y);
  if (da !== db) return da - db;
  return a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0;
}

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
 * Pure: returns a new array and never mutates its input. The per-frame hot path
 * should use {@link orderShipsForRenderInto}, which reuses a caller-owned buffer
 * and insertion-sorts (positions drift little across frames so the prior order
 * is a near-sorted starting point); this pure form remains the reference.
 */
export function orderShipsForRender(
  ships: readonly ShipSnapshot[],
  depth: ShipDepth = FLAT_DEPTH,
): ShipSnapshot[] {
  return [...ships].sort((a, b) => compareShipDepth(a, b, depth));
}

/**
 * Order ships back-to-front into a caller-owned reusable buffer, returning it.
 *
 * Same ordering as {@link orderShipsForRender} (the comparator is a strict total
 * order on depth then `instanceId`, so there is exactly one correct permutation —
 * the result is identical regardless of algorithm). The hot battle draw calls
 * this every rAF; reusing one buffer avoids the per-frame `[...ships]` array
 * allocation (and its subsequent GC pressure) that the pure form pays.
 *
 * The buffer's contents are overwritten to match `ships` and its length set to
 * `ships.length`, so it never retains stale entries from a prior frame. Mutates
 * the buffer in place; does not mutate `ships`. The copy uses `for...of` and the
 * `.sort` comparator receives its elements typed as `ShipSnapshot`, so neither
 * path touches a `ShipSnapshot | undefined` index read.
 */
export function orderShipsForRenderInto(
  ships: readonly ShipSnapshot[],
  out: ShipSnapshot[],
  depth: ShipDepth = FLAT_DEPTH,
): ShipSnapshot[] {
  let n = 0;
  for (const s of ships) {
    out[n] = s;
    n += 1;
  }
  out.length = n;
  out.sort((a, b) => compareShipDepth(a, b, depth));
  return out;
}
