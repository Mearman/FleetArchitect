/**
 * Stealth and electronic warfare: cloak, signature modules, ECM jamming,
 * ECCM restore, and the net tracking-reduction a firing ship suffers against
 * a given target.
 */

import type { CloakEffect, EcmEffect } from "@/schema/module";

import { SIM } from "./config";
import { isOperational } from "./crew";
import type { SimShip } from "./types";

/**
 * The cloak effect of a ship that is currently cloaking it, or undefined.
 *
 * A ship is cloaked when it carries at least one alive/operational cloak module
 * AND it has not fired within that module's `decloakTicks` window. The decloak
 * window opens on the tick the ship last fired (`lastFiredTick`, set in
 * `fireWeapons`) and stays open for `decloakTicks` ticks afterwards. While the
 * window is open the cloak is dropped, so the ship is acquirable like any other.
 *
 * When several cloak modules are fitted the longest `decloakTicks` governs (the
 * ship stays exposed for the worst of them after firing); the modules are
 * scanned in fixed (col, row) order so the choice is deterministic. Returns
 * undefined when the ship has no operational cloak or is inside its decloak
 * window — in both cases the cloak is not hiding it this tick.
 */
export function activeCloak(ship: SimShip, tick: number): CloakEffect | undefined {
  if (ship.modules === undefined) return undefined;
  let best: CloakEffect | undefined;
  for (const m of ship.modules) {
    if (m.effect.kind !== "cloak") continue;
    if (!isOperational(m)) continue;
    const cloak = m.effect;
    // Within the decloak window the cloak is down: ignore this module.
    if (tick - ship.lastFiredTick < cloak.decloakTicks) continue;
    if (best === undefined || cloak.decloakTicks > best.decloakTicks) {
      best = cloak;
    }
  }
  return best;
}

/**
 * The signature multiplier currently reducing how far enemies can acquire this
 * ship: the smallest `acquisitionMultiplier` across its alive/operational
 * signature modules (the best stealth coating governs), or 1 when it carries
 * none — i.e. no reduction. Modules are scanned in fixed (col, row) order so the
 * tie-break (equal multipliers) is deterministic, though the result is identical
 * for ties since the value, not the module, is returned.
 */
export function signatureMultiplier(ship: SimShip): number {
  if (ship.modules === undefined) return 1;
  let multiplier = 1;
  for (const m of ship.modules) {
    if (m.effect.kind !== "signature") continue;
    if (!isOperational(m)) continue;
    if (m.effect.acquisitionMultiplier < multiplier) {
      multiplier = m.effect.acquisitionMultiplier;
    }
  }
  return multiplier;
}

/**
 * The viewer's effective passive acquisition range (world units): the base
 * acquisition radius plus the sum of every alive/operational sensor module's
 * `detectionRange`. Sensors are additive — bolting on more arrays sees further.
 * A viewer with no sensor modules sees out to the per-battle scaled base
 * acquisition range, which for a non-stealth target is unbounded in effect (that
 * target is always detectable; see `isDetectable`), so this range only ever
 * gates stealthed prey.
 */
export function viewerAcquireRange(viewer: SimShip): number {
  let range = SIM.baseAcquireRange;
  if (viewer.modules === undefined) return range;
  for (const m of viewer.modules) {
    if (m.effect.kind !== "sensor") continue;
    if (!isOperational(m)) continue;
    range += m.effect.detectionRange;
  }
  return range;
}

/**
 * Whether the viewer has an alive/operational pierce-cloak sensor whose
 * effective range covers `distance` — an active scan that defeats a passive
 * cloak. Each pierce-cloak sensor reaches `SIM.baseAcquireRange + detectionRange`
 * (the same additive model as `viewerAcquireRange`, but counting only the
 * pierce-cloak arrays, since a plain sensor extends ordinary acquisition without
 * seeing through cloak). Scanned in fixed (col, row) order; short-circuits on
 * the first sensor in range.
 */
export function viewerPiercesCloakAt(
  viewer: SimShip,
  distance: number,
): boolean {
  if (viewer.modules === undefined) return false;
  for (const m of viewer.modules) {
    if (m.effect.kind !== "sensor") continue;
    if (m.effect.pierceCloak !== true) continue;
    if (!isOperational(m)) continue;
    if (distance <= SIM.baseAcquireRange + m.effect.detectionRange) return true;
  }
  return false;
}

/**
 * Whether `viewer` can currently acquire `target` as a firing/targeting
 * candidate, given the squared distance between them. This is the stealth
 * acquisition gate that filters the candidate enemy set in `pickTarget` and
 * `electFocusTarget`, and validates a shot in `fireWeapons`.
 *
 * Opt-in by construction: a target with neither an operational cloak nor an
 * operational signature module is ALWAYS detectable, regardless of distance —
 * exactly the pre-stealth behaviour, so existing fleets produce byte-identical
 * targeting (the determinism fixtures rely on this).
 *
 * Cloak: an operational cloak (outside its post-fire decloak window) hides the
 * target outright UNLESS the viewer has a pierce-cloak sensor in range. A
 * cloaked target is invisible even if it also carries a signature module — the
 * cloak is the stronger effect.
 *
 * Signature: an operational signature module shrinks the viewer's effective
 * acquisition range to `viewerAcquireRange(viewer) * acquisitionMultiplier`; the
 * target is acquired only within that reduced range.
 *
 * The computation is a pure function of the two ships' module states, their
 * separation, and the tick — no rng is drawn, so the random stream is untouched
 * by stealth and stays the same length regardless of detection outcomes.
 */
export function isDetectable(
  viewer: SimShip,
  target: SimShip,
  distanceSq: number,
  tick: number,
): boolean {
  const cloak = activeCloak(target, tick);
  if (cloak !== undefined) {
    // Cloaked: only an in-range pierce-cloak sensor can see it.
    return viewerPiercesCloakAt(viewer, Math.sqrt(distanceSq));
  }
  const multiplier = signatureMultiplier(target);
  // Fast path and opt-in guarantee: a target with no signature reduction is
  // detectable at any distance, so non-stealth targeting is unchanged.
  if (multiplier >= 1) return true;
  const effectiveRange = viewerAcquireRange(viewer) * multiplier;
  return distanceSq <= effectiveRange * effectiveRange;
}

/**
 * The strongest ECM (jamming) effect operational on a ship — the one degrading
 * fire aimed AT it. The strongest is the module with the largest
 * `trackingReduction` (the heaviest jammer dominates); modules are scanned in
 * fixed (col, row) order so the choice is deterministic even on ties. Returns
 * undefined when the ship carries no alive/operational ECM, in which case
 * incoming fire is untouched — the opt-in default that keeps non-ECM battles
 * byte-identical.
 */
export function targetEcm(ship: SimShip): EcmEffect | undefined {
  if (ship.modules === undefined) return undefined;
  let best: EcmEffect | undefined;
  for (const m of ship.modules) {
    if (m.effect.kind !== "ecm") continue;
    if (!isOperational(m)) continue;
    const ecm = m.effect;
    if (best === undefined || ecm.trackingReduction > best.trackingReduction) {
      best = ecm;
    }
  }
  return best;
}

/**
 * The fraction of ECM-stripped tracking/lock that an attacker's ECCM restores:
 * the largest `trackingRestore` across its alive/operational ECCM modules (the
 * best counter governs), clamped to 1, or 0 when the attacker carries none.
 * Modules are scanned in fixed (col, row) order so the tie-break is
 * deterministic. An attacker with no ECCM gets 0 restore, so an ECM target
 * degrades its fire by the full reduction — and a battle with no ECCM is
 * unaffected by this function (it always returns 0).
 */
export function attackerEccmRestore(ship: SimShip): number {
  if (ship.modules === undefined) return 0;
  let restore = 0;
  for (const m of ship.modules) {
    if (m.effect.kind !== "eccm") continue;
    if (!isOperational(m)) continue;
    if (m.effect.trackingRestore > restore) restore = m.effect.trackingRestore;
  }
  return restore > 1 ? 1 : restore;
}

/**
 * The net tracking-reduction fraction an `attacker`'s fire suffers when aimed at
 * `target`, after the target's ECM jams the lock and the attacker's ECCM claws
 * some of it back: `max(0, trackingReduction - trackingRestore)`. Returns 0 when
 * the target carries no operational ECM, so a projectile spawned against a
 * non-ECM ship keeps its full tracking — non-ECM battles are byte-identical.
 */
export function netTrackingReduction(attacker: SimShip, target: SimShip): number {
  const ecm = targetEcm(target);
  if (ecm === undefined) return 0;
  const net = ecm.trackingReduction - attackerEccmRestore(attacker);
  return net > 0 ? net : 0;
}
