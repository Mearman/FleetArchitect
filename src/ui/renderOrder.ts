import { type ShipSnapshot } from "@/schema/battle";

/**
 * Order ships back-to-front for canvas rendering.
 *
 * The battle renderer paints each ship entirely before moving to the next, so
 * the iteration order decides which ship overlaps which. The snapshot emits
 * ships in simulation array order (attackers, then defenders), which has
 * nothing to do with where they sit on screen — a defender high up would paint
 * over an attacker below it. Sorting by world-y (smaller y, further "back" /
 * top of screen, first; larger y, closer / bottom, last) gives a natural
 * overlap where ships lower down sit in front of ships higher up.
 *
 * Ties on y break by `instanceId` so the order is fully deterministic: no
 * flicker between frames and reproducible in tests.
 *
 * Pure: returns a new array and never mutates its input.
 */
export function orderShipsForRender(ships: readonly ShipSnapshot[]): ShipSnapshot[] {
  return [...ships].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0;
  });
}
