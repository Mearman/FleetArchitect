/**
 * Salvage mechanics: deterministic drifting-debris collection and hull claiming.
 *
 * Two related post-battle economy mechanics run each tick, both pure functions of
 * the current ship and debris state with no rng and no wall-clock — so two
 * same-seed runs collect and claim byte-identically.
 *
 *  1. Debris collection. A living ship sweeps up any drifting wreckage fragment
 *     whose centre falls within `SALVAGE_RANGE_M` of the ship's centre, removing
 *     it from the field and adding its mass to the ship's running `salvageMass`.
 *     Each fragment is collected by at most one ship (the first in instanceId
 *     order to reach it), so the recovered mass is conserved exactly.
 *
 *  2. Hull claiming. A derelict enemy hull — every weapon and drive disabled, no
 *     crew left aboard, not already claimed — is claimed by the first living
 *     enemy in instanceId order within `SALVAGE_RANGE_M`. A claimed hull is
 *     marked with `claimedBy` (the claimant's instanceId) and from then on drifts
 *     as inert wreckage: its per-tick engine steps are suppressed (see
 *     `isClaimed` guards in the tick loop), so it neither thrusts, fires, nor
 *     coordinates.
 *
 * Both passes iterate ships in lexicographic instanceId order and debris in id
 * order, so the outcome is a deterministic function of state — the "first
 * claimant wins" rule and the "first collector wins" rule both resolve ties by
 * that fixed order, never by Map/Set insertion order or array churn.
 */

import type { Debris } from "./debris";
import type { SimShip } from "./types";

/**
 * Range (metres) within which a ship collects drifting debris and claims a
 * derelict enemy hull. A short-range tractor/grapple reach: salvage is a
 * close-quarters action, so a ship must close to within roughly a few hull
 * lengths of the wreckage or hull to recover it. Authored gameplay content
 * (a salvage-grapple reach spec), not a physics quantity.
 */
export const SALVAGE_RANGE_M = 50;

/** Squared salvage range, precomputed so the per-pair distance test avoids a
 *  square root. */
const SALVAGE_RANGE_SQ = SALVAGE_RANGE_M * SALVAGE_RANGE_M;

/** Whether a ship has already been claimed as salvage. A claimed hull drifts
 *  inert: the tick loop reads this to suppress its engine steps. */
export function isClaimed(ship: SimShip): boolean {
  return ship.claimedBy !== undefined;
}

/**
 * Stable lexicographic comparison on instanceId, the fixed tie-break for every
 * salvage iteration so the outcome is a deterministic function of state.
 */
function byInstanceId(a: SimShip, b: SimShip): number {
  return a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0;
}

/**
 * The structural half of claimability — everything `isClaimable` checks except
 * the `claimedBy` (already-claimed) flag. This is a function of hull state only
 * (phantom, module list, crew, weapon/engine cell liveness), none of which
 * changes during a single `claimHulls` call — only `claimedBy` mutates there.
 * Pulled out so `claimHulls` can compute it once per hull up front instead of
 * re-deriving it from the module list for every (salvager, hull) pair.
 */
function isStructurallyClaimable(hull: SimShip): boolean {
  if (hull.phantom !== undefined) return false;
  if (hull.modules === undefined) return false;
  // A living crew member aboard still mans and defends the hull — only a hull
  // emptied of crew is a derelict. `crew` is always present (possibly empty) on
  // a modular ship; an undefined list is treated as no crew.
  if (hull.crew !== undefined && hull.crew.some((c) => c.hp > 0)) return false;
  // Every weapon and engine cell must be dead. A hull retaining one live gun or
  // thruster is still a combatant, not salvage.
  let hasOffensiveOrMobilityCell = false;
  for (const m of hull.modules) {
    if (m.effect.kind !== "weapon" && m.effect.kind !== "engine") continue;
    hasOffensiveOrMobilityCell = true;
    if (m.alive) return false;
  }
  // A hull that never carried a weapon or drive is not a fightable combatant to
  // begin with; treat it as non-claimable so claiming targets only genuine
  // disarmed warships, not unarmed tenders or pure-hull chunks.
  return hasOffensiveOrMobilityCell;
}

/**
 * Whether `hull` is a derelict that a salvager may claim: structurally claimable
 * (every weapon and drive module disabled, no living crew, modular) AND not
 * already claimed. A legacy non-modular hull (no module list) is never claimable
 * — it has no per-module death to read — so claiming is opt-in to modular ships,
 * exactly the ships boarding and break-apart already act on. Phantoms (drones /
 * decoys) are transient projections, never hulls, so they are never claimable.
 */
export function isClaimable(hull: SimShip): boolean {
  if (isClaimed(hull)) return false;
  return isStructurallyClaimable(hull);
}

/**
 * Collect drifting debris into the ships that sweep over it. For each fragment in
 * id order, the first living, unclaimed, non-phantom ship in instanceId order
 * whose centre lies within `SALVAGE_RANGE_M` of the fragment collects it: the
 * fragment's mass is added to that ship's `salvageMass` and the fragment is
 * removed from the field. A fragment out of every ship's reach is left to drift.
 *
 * Mutates `ships[*].salvageMass` and rewrites `debris` in place to the surviving
 * (uncollected) fragments — mirroring how `updateMines` / `updatePods` rebuild
 * their arrays to the live remainder. Returns nothing; the caller's `debris`
 * array reference is updated by splice so downstream steps (drift, snapshot) see
 * the post-collection field.
 *
 * Deterministic: ships are sorted once by instanceId; the inner scan stops at the
 * first in-range collector, so the assignment is a pure function of positions.
 */
export function collectDebris(ships: readonly SimShip[], debris: Debris[]): void {
  if (debris.length === 0) return;
  const collectors = ships
    .filter((s) => s.alive && s.phantom === undefined && !isClaimed(s))
    .sort(byInstanceId);
  if (collectors.length === 0) return;
  const survivors: Debris[] = [];
  for (const fragment of debris) {
    let collected = false;
    for (const ship of collectors) {
      const dx = fragment.x - ship.x;
      const dy = fragment.y - ship.y;
      if (dx * dx + dy * dy > SALVAGE_RANGE_SQ) continue;
      ship.salvageMass += fragment.mass;
      collected = true;
      break;
    }
    if (!collected) survivors.push(fragment);
  }
  // Rewrite the field in place to the uncollected fragments.
  debris.length = 0;
  for (const fragment of survivors) debris.push(fragment);
}

/**
 * Claim derelict enemy hulls. For each living, unclaimed salvager in instanceId
 * order, the first claimable enemy hull in instanceId order within
 * `SALVAGE_RANGE_M` is marked `claimedBy = salvager.instanceId`. Only the first
 * claimant wins a hull: a hull marked claimed this pass is no longer claimable,
 * so a later salvager scanning the same hull skips it.
 *
 * Deterministic: both the salvagers and the candidate hulls are iterated in
 * instanceId order, and claimability reads only ship state, so the assignment is
 * a pure function of the roster — no rng, no insertion order.
 *
 * Structural claimability (phantom, modules, crew, weapon/engine cell liveness)
 * depends only on hull state and is invariant across a single call — only
 * `claimedBy` changes, as hulls get claimed. So the per-hull structural check is
 * computed once up front in a single O(N x M) pass, instead of re-deriving it
 * from the module list for every (salvager, hull) pair. The inner loop then
 * skips a hull iff it is already claimed or structurally non-claimable — exactly
 * the complement of `isClaimable`. The claimed check reads `claimedBy` live, so
 * a hull claimed earlier this same pass is skipped without a separate tracker,
 * preserving the same skip-order, the same first-claimant-wins rule, and the
 * identical per-salvager choice.
 */
export function claimHulls(ships: readonly SimShip[]): void {
  const sorted = [...ships].sort(byInstanceId);
  // Precompute the set of structurally-claimable hull ids once (O(N x M)); this
  // does not change during the call.
  const structurallyClaimableIds: Set<string> = new Set();
  for (const hull of sorted) {
    if (isStructurallyClaimable(hull)) structurallyClaimableIds.add(hull.instanceId);
  }
  for (const salvager of sorted) {
    if (!salvager.alive || salvager.phantom !== undefined || isClaimed(salvager)) {
      continue;
    }
    for (const hull of sorted) {
      if (hull.side === salvager.side) continue;
      // Skip iff claimed-now or structurally non-claimable — the complement of
      // isClaimable(hull) at this instant, without re-scanning the module list.
      if (isClaimed(hull) || !structurallyClaimableIds.has(hull.instanceId)) continue;
      const dx = hull.x - salvager.x;
      const dy = hull.y - salvager.y;
      if (dx * dx + dy * dy > SALVAGE_RANGE_SQ) continue;
      hull.claimedBy = salvager.instanceId;
      break; // one claim per salvager per tick
    }
  }
}

/** A per-ship salvage summary line for the battle result. */
export interface SalvageSummary {
  shipId: string;
  salvageMass: number;
  claimedHulls: string[];
}

/**
 * Build the per-ship salvage summary for the battle result: for every ship that
 * recovered any debris mass or claimed any hull, its total `salvageMass` and the
 * instanceIds of the hulls it claimed. Ships that salvaged nothing are omitted.
 * Emitted in instanceId order so two same-seed runs return the same list; the
 * `claimedHulls` of each entry are likewise sorted by instanceId.
 */
export function summariseSalvage(ships: readonly SimShip[]): SalvageSummary[] {
  const claimedByOwner = new Map<string, string[]>();
  for (const hull of ships) {
    if (hull.claimedBy === undefined) continue;
    const list = claimedByOwner.get(hull.claimedBy);
    if (list === undefined) claimedByOwner.set(hull.claimedBy, [hull.instanceId]);
    else list.push(hull.instanceId);
  }
  const summary: SalvageSummary[] = [];
  for (const ship of ships) {
    const claimedHulls = claimedByOwner.get(ship.instanceId);
    const hasClaims = claimedHulls !== undefined && claimedHulls.length > 0;
    if (ship.salvageMass <= 0 && !hasClaims) continue;
    summary.push({
      shipId: ship.instanceId,
      salvageMass: ship.salvageMass,
      claimedHulls:
        claimedHulls === undefined
          ? []
          : [...claimedHulls].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    });
  }
  return summary.sort((a, b) => (a.shipId < b.shipId ? -1 : a.shipId > b.shipId ? 1 : 0));
}
