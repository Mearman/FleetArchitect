/**
 * Crew priority modes: the deterministic ordering of the four crew task kinds
 * (manning, ammo haul, power haul, repair) under each `CrewPriority` stance.
 *
 * This is the pure ordering logic only. `engine.ts` (the crew tick) consumes
 * `crewTaskOrder` to drive its idle-crew assignment passes in the order it
 * returns; the assignment, pathfinding, and hauling mechanics stay where they
 * are. Splitting the ordering out keeps `crew.ts` under the file-length guard
 * and gives the priority modes a single, well-tested home.
 *
 * Determinism contract: `crewTaskOrder` is a pure function of `(priority,
 * shipState)`. No RNG, no Map/Set insertion order, no time-of-day. Two calls
 * with equal inputs return arrays that are `===`-equal in content and order.
 * The only conditional — damage-control elevating repair when structure is
 * critical — is a pure comparison of `structure / maxStructure` against a named
 * ratio, so the same ship state always yields the same order.
 */

import { z } from "zod";

/**
 * The crew task kinds the idle-assignment loop can hand out. These match the
 * `SimCrew.job` values the crew tick already understands, plus `repair` (the
 * repair-bay / damage-control task, which the crew tick routes the same way as
 * a manning run — walk to the station and hold). Ordering these is the whole
 * job of this module.
 *
 * Defined as a Zod enum so the literal union, the runtime validator, and the
 * ordered list of values all derive from one definition (single source of
 * truth). `CrewTaskKind.options` is the canonical readonly array of the four
 * kinds in their authored order.
 */
export const CrewTaskKind = z.enum(["manning", "haulAmmo", "haulPower", "repair"]);
export type CrewTaskKind = z.infer<typeof CrewTaskKind>;
/** The four task kinds in their authored order (manning, ammo, power, repair). */
export const CREW_TASK_KINDS: readonly CrewTaskKind[] = CrewTaskKind.options;

/**
 * The crew priority stance a ship's doctrine commits to. A Zod enum so the
 * schema can lift this verbatim when Phase 0's AI schema additions land
 * properly; until then this module is the single source of truth for the
 * literal union and its runtime validation.
 *
 * - `combat` — win the firefight now: man weapons first, keep them fed with
 *   ammo, then power, then repair.
 * - `damageControl` — keep the ship alive: when structure is critical, repair
 *   comes before everything; otherwise man stations to keep fighting while
 *   damage is patched.
 * - `resupply` — rebuild the magazines and buffers: haul ammo and charge first,
 *   then man stations, then repair.
 */
export const CrewPriority = z.enum(["combat", "damageControl", "resupply"]);
export type CrewPriority = z.infer<typeof CrewPriority>;

/**
 * The minimum state `crewTaskOrder` needs from a ship to decide its task
 * order. Kept deliberately narrow — only the structure ratio feeds the
 * damage-control conditional — so the function is easy to test without
 * constructing a whole `SimShip`. Callers pass a ship-derived view; the
 * engine integration builds this from `SimShip.structure` / `maxStructure`.
 */
export interface CrewPriorityShipState {
  /**
   * Current structure (hit points) of the ship's hull. Non-negative; zero
   * means destroyed (the ship would not be crewed, but the function still
   * returns a valid order for it).
   */
  structure: number;
  /**
   * The ship's structure at full integrity. Always positive for a live ship;
   * the ratio `structure / maxStructure` is what the damage-control
   * conditional reads.
   */
  maxStructure: number;
}

/**
 * The structure fraction below which a damage-control ship treats repair as
 * the overriding priority — structure has fallen into the lower half of its
 * range, meaning the ship has lost more of its damage reserve than it retains.
 *
 * Derived from the symmetry of the integrity scale: a ship is "intact" at the
 * top and "destroyed" at the bottom, so the midpoint (`1/2`) is the natural
 * boundary between "hurt but fighting" and "critical, patch me first". This is
 * the ratio form of a physical anchor (the half-way point of a bounded
 * quantity), not a hand-tuned feel constant — it falls out of the scale's
 * geometry.
 */
export const CRITICAL_STRUCTURE_RATIO = 1 / 2;

/**
 * Whether a ship's structure has fallen into the critical band where
 * damage-control doctrine elevates repair above all other tasks. Pure: a simple
 * ratio test against {@link CRITICAL_STRUCTURE_RATIO}. Guarded against a
 * non-positive `maxStructure` (a degenerate or destroyed ship) by treating it
 * as critical — there is nothing left to lose by repairing.
 */
export function structureIsCritical(state: CrewPriorityShipState): boolean {
  if (state.maxStructure <= 0) return true;
  return state.structure / state.maxStructure < CRITICAL_STRUCTURE_RATIO;
}

/**
 * The ordered list of crew task kinds for a ship under a given priority,
 * evaluated against its current state.
 *
 * The base orderings (when no conditional fires) are:
 * - `combat` — manning, haulAmmo, haulPower, repair. Man the weapons first so
 *   they fire this tick; feed them ammo so they keep firing; keep the power
 *   buffers topped; repair last, because a dead enemy deals no damage.
 * - `damageControl` — manning, repair, haulAmmo, haulPower. Keep the stations
 *   manned so the ship still fights while damage is patched, then repair, then
 *   the hauls.
 * - `resupply` — haulAmmo, haulPower, manning, repair. Rebuild the magazines
 *   and charge buffers first (the ship is presumed safe to do so), then man
 *   stations, then repair.
 *
 * Conditional (damage-control only): when {@link structureIsCritical} is true,
 * repair jumps to the front — `repair, manning, haulPower, haulAmmo` — because
 * a ship one hit from destruction gains more from patching the hull than from
 * anything else. The haul order is also swapped (power before ammo) so a
 * critical ship keeps its shields and point-defence charged ahead of its
 * offensive magazines.
 *
 * The returned array always contains each task kind exactly once; only the
 * order changes. Callers iterate it in order and assign idle crew to the
 * first kind with unmet demand.
 */
export function crewTaskOrder(
  priority: CrewPriority,
  state: CrewPriorityShipState,
): readonly CrewTaskKind[] {
  switch (priority) {
    case "combat":
      // Man weapons, feed them, power them, then repair.
      return ["manning", "haulAmmo", "haulPower", "repair"];
    case "resupply":
      // Rebuild magazines and buffers first, then man, then repair.
      return ["haulAmmo", "haulPower", "manning", "repair"];
    case "damageControl": {
      if (structureIsCritical(state)) {
        // Structure critical: patch the hull before anything else, keep
        // defensive power (shields, point-defence) charged ahead of
        // offensive ammo, and man stations last.
        return ["repair", "haulPower", "manning", "haulAmmo"];
      }
      // Hurt but stable: keep fighting while damage is patched.
      return ["manning", "repair", "haulAmmo", "haulPower"];
    }
  }
}
