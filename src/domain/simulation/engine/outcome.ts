/**
 * Pure battle-outcome scoring. `leadingSide` decides which side is ahead by
 * remaining hit points — the tie-break the loop uses when a battle ends by the
 * no-progress watchdog or a focused test's explicit `maxTicks` cap rather than by
 * a decisive elimination. No simulation state, no side effects: a pure function
 * of the two ship lists, kept out of the loop module so the tick loop reads as
 * the simulation and this reads as the verdict.
 */

import type { BattleSide } from "@/schema/battle";
import type { SimShip } from "./types";

/**
 * The side with the greater total remaining structure + shield, or "draw" on an
 * exact tie. Only real ships count — phantoms (drones/decoys) are transient and
 * must not swing a timeout decision.
 */
export function leadingSide(
  attackers: readonly SimShip[],
  defenders: readonly SimShip[],
): BattleSide {
  const total = (group: readonly SimShip[]): number =>
    group.reduce(
      (sum, s) => (s.phantom === undefined ? sum + s.structure + s.shield : sum),
      0,
    );
  const a = total(attackers);
  const d = total(defenders);
  if (a > d) return "attacker";
  if (d > a) return "defender";
  return "draw";
}
