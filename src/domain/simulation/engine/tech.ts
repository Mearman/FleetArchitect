/**
 * Movement/power tech abilities: blink teleport, afterburner boost,
 * overcharge, and the friendly command-aura bonus propagation.
 */

import { isOperational } from "./crew";
import { enemyCentroid, isClosingStance } from "./movement";
import type { CommandAuraEffect } from "@/schema/module";
import type { SimModule, SimShip } from "./types";

/**
 * Static per-ship tech classification, derived once from the module set by
 * {@link buildTechCaches} and held on `SimShip.techCaches`. All three fields are
 * pure functions of `effect.kind` and `powerDraw`, neither of which changes at
 * runtime (effect scaling scales magnitudes only, never `kind`; nothing mutates
 * `powerDraw`), so one build lasts the life of the module array. The per-tick
 * `alive` / `powered` / `isOperational` gates remain in the consumer loops.
 */
export interface TechCaches {
  /** commandAura projectors in module-array order. The narrowed element type
   *  lets `applyCommandAuras` read the aura fields without a per-tick kind
   *  check. Empty when the ship carries no aura carrier. */
  auraModules: AuraModule[];
  /** weapon / pointDefence / shield modules with `powerDraw > 0`, in
   *  module-array order — the only modules `isBrownedOut` can ever report on.
   *  Empty when none qualify. */
  brownoutConsumers: SimModule[];
  /** Whether the ship carries any overcharge module. When false,
   *  `stepOvercharge` short-circuits before the brownout scan. */
  hasOvercharge: boolean;
}

/**
 * A `SimModule` narrowed so its effect is a `commandAura` projector. The cache
 * builder narrows via the discriminated `kind` (see {@link isAuraModule}), so
 * the per-tick read loop accesses `radius` / `rangeBonus` / `accuracyBonus`
 * directly, with no runtime kind check. A real narrowing, not an assertion.
 */
export type AuraModule = SimModule & { effect: CommandAuraEffect };

/**
 * Classify a ship's modules into the static tech subsets the per-tick loops in
 * this file consume: command-aura projectors, brownout-eligible power
 * consumers, and whether any overcharge module is present. A single pass in
 * module-array order; the returned sub-arrays preserve that order so the
 * existing max-bonus and first-ready scans are byte-identical.
 *
 * Re-run by `restoreShip` (checkpoint modules are brand-new objects) and
 * `makeChunkShip` (a severed fragment gets its own module copies and so its own
 * cache) so the cache always references the live module objects.
 */
export function buildTechCaches(modules: readonly SimModule[]): TechCaches {
  const auraModules: AuraModule[] = [];
  const brownoutConsumers: SimModule[] = [];
  let hasOvercharge = false;
  for (const m of modules) {
    if (isAuraModule(m)) {
      auraModules.push(m);
    } else if (m.effect.kind === "overcharge") {
      hasOvercharge = true;
    }
    const kind = m.effect.kind;
    if (
      m.powerDraw > 0 &&
      (kind === "weapon" || kind === "pointDefense" || kind === "shield")
    ) {
      brownoutConsumers.push(m);
    }
  }
  return { auraModules, brownoutConsumers, hasOvercharge };
}

/**
 * Type guard narrowing a `SimModule` to its command-aura projector subtype.
 * Used only at cache build time so the narrowed element type ({@link AuraModule})
 * lets the per-tick read loop skip the kind check; the guard body is the single
 * discriminated-union check, so this is a real narrowing, not an assertion.
 */
function isAuraModule(m: SimModule): m is AuraModule {
  return m.effect.kind === "commandAura";
}

/**
 * Fire any ready blink drive on a ship at the start of its movement, teleporting
 * the hull and putting the drive on cooldown. Opt-in: a ship with no alive,
 * operational, ready blink module is untouched, so non-blink ships move exactly
 * as before. Deterministic — destination is a pure function of positions and
 * stance, no rng. Modules are scanned in (col, row) order; the first ready drive
 * of each mode that finds a valid jump fires (one jump per drive per cooldown).
 *
 * tactical: jump up to `jumpRange` toward the current target when the stance is
 *   closing, or directly away from the nearest enemy when defensive/evasive/
 *   retreating. The toward-target jump is clamped so it never overshoots the
 *   target (a blink that would pass through the target stops on it).
 * escape: only when `structure / maxStructure <= escapeThreshold`; jump up to
 *   `jumpRange` directly away from the centroid of all alive enemies.
 *
 * Velocity is preserved across the teleport (the drive moves the hull, not its
 * momentum), so a blinking ship keeps coasting in whatever direction it was
 * already travelling — deterministic and physically tidy.
 */
export function applyBlink(
  ship: SimShip,
  byId: ReadonlyMap<string, SimShip>,
  ships: readonly SimShip[],
): void {
  if (ship.modules === undefined) return;
  for (const m of ship.modules) {
    if (m.effect.kind !== "blink") continue;
    if (m.techCooldown > 0 || !isOperational(m)) continue;
    const effect = m.effect;

    let destX: number | undefined;
    let destY: number | undefined;

    if (effect.mode === "escape") {
      // Emergency disengage: only when wounded past the threshold.
      if (effect.escapeThreshold === undefined) continue;
      if (ship.maxStructure <= 0) continue;
      if (ship.structure / ship.maxStructure > effect.escapeThreshold) continue;
      const centroid = enemyCentroid(ship, ships);
      if (centroid === undefined) continue;
      const away = jumpAwayFrom(ship, centroid.x, centroid.y, effect.jumpRange);
      destX = away.x;
      destY = away.y;
    } else {
      // tactical: close on the target when pressing, open the range otherwise.
      if (isClosingStance(ship)) {
        const target = ship.target !== undefined ? byId.get(ship.target) : undefined;
        if (target === undefined || !target.alive) continue;
        const toward = jumpToward(ship, target.x, target.y, effect.jumpRange);
        destX = toward.x;
        destY = toward.y;
      } else {
        const centroid = enemyCentroid(ship, ships);
        if (centroid === undefined) continue;
        const away = jumpAwayFrom(ship, centroid.x, centroid.y, effect.jumpRange);
        destX = away.x;
        destY = away.y;
      }
    }

    if (destX === undefined || destY === undefined) continue;
    ship.x = destX;
    ship.y = destY;
    m.techCooldown = effect.cooldown;
  }
}

/**
 * The point reached by jumping up to `range` from the ship toward (tx, ty),
 * clamped so the jump never overshoots the destination: if the target is within
 * `range`, the jump lands exactly on it. A zero-distance target (already on top)
 * leaves the ship where it is.
 */
export function jumpToward(
  ship: SimShip,
  tx: number,
  ty: number,
  range: number,
): { x: number; y: number } {
  const dx = tx - ship.x;
  const dy = ty - ship.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= 0) return { x: ship.x, y: ship.y };
  const step = Math.min(dist, range);
  return { x: ship.x + (dx / dist) * step, y: ship.y + (dy / dist) * step };
}

/**
 * The point reached by jumping `range` from the ship directly away from
 * (fromX, fromY). When the ship is exactly on the reference point (no defined
 * direction), it stays put rather than picking an arbitrary heading.
 */
export function jumpAwayFrom(
  ship: SimShip,
  fromX: number,
  fromY: number,
  range: number,
): { x: number; y: number } {
  const dx = ship.x - fromX;
  const dy = ship.y - fromY;
  const dist = Math.hypot(dx, dy);
  if (dist <= 0) return { x: ship.x, y: ship.y };
  return { x: ship.x + (dx / dist) * range, y: ship.y + (dy / dist) * range };
}

/**
 * Decide whether to engage an afterburner this tick and return the combined
 * thrust/turn multipliers to apply to the ship's movement. Opt-in: a ship with
 * no afterburner module returns the identity (1, 1) and is unaffected.
 *
 * Activation rule: when the ship has movement intent this tick (`wantsToMove` —
 * it is closing, kiting, fleeing, or escaping the black hole), each alive,
 * operational afterburner module that is ready (`techCooldown === 0`) and not
 * already active engages for `duration` ticks and starts its `cooldown`. An
 * already-active module keeps contributing its boost until its window expires.
 * A ship holding station (no movement intent) does not waste a charge.
 *
 * The returned multipliers are the product of every active module's
 * `thrustBoost` / `turnBoost`, so stacked afterburners compound. Modules are
 * scanned in (col, row) order; the result is order-independent (a product).
 */
export function afterburnerMultipliers(
  ship: SimShip,
  wantsToMove: boolean,
): { thrust: number; turn: number } {
  if (ship.modules === undefined) return { thrust: 1, turn: 1 };
  let thrust = 1;
  let turn = 1;
  for (const m of ship.modules) {
    if (m.effect.kind !== "afterburner") continue;
    if (!isOperational(m)) continue;
    if (m.techActive <= 0 && wantsToMove && m.techCooldown === 0) {
      m.techActive = m.effect.duration;
      m.techCooldown = m.effect.cooldown;
    }
    if (m.techActive > 0) {
      thrust *= m.effect.thrustBoost;
      turn *= m.effect.turnBoost;
    }
  }
  return { thrust, turn };
}

/**
 * Whether a ship is in a power brownout this tick: an alive consumer module
 * (weapon, PD, or shield) that `recomputeAggregates` had to take offline to fit
 * the reactor budget. Mirrors the cut set the brownout loop produces, so a ship
 * whose whole demand fits its supply reports no brownout. Pure read of the
 * `powered` flags the latest recompute left.
 *
 * Iterates the precomputed `techCaches.brownoutConsumers` (weapon/PD/shield with
 * `powerDraw > 0`) instead of the full module array: the static kind and
 * power-draw filters are folded into the cache at ship construction, leaving
 * only the per-tick `alive` / `powered` read in the loop. `techCaches` is
 * `undefined` exactly when the ship has no modules (legacy aggregated path or a
 * phantom), which previously returned false here too.
 */
export function isBrownedOut(ship: SimShip): boolean {
  const consumers = ship.techCaches?.brownoutConsumers;
  if (consumers === undefined) return false;
  for (const m of consumers) {
    if (!m.alive) continue;
    if (!m.powered) return true;
  }
  return false;
}

/**
 * Engage a ready reactor overcharge when the ship is browning out (factions
 * update). Called after `recomputeAggregates` has settled the power budget: if a
 * consumer is offline for want of supply and an alive, operational overcharge
 * module is ready (`techCooldown === 0`, not already active), fire it for
 * `duration` ticks and start its `cooldown`, then return true so the caller can
 * re-run aggregates and bring the surge to bear this same tick. Opt-in: a ship
 * with no overcharge module, or one not browned out, returns false and is
 * untouched. Modules scanned in (col, row) order; the first ready module fires.
 *
 * The static `hasOvercharge` flag (built once at ship construction) short-
 * circuits the whole call for the common case of a ship carrying no overcharge
 * module, skipping the brownout scan entirely — an overcharge that can never
 * exist can never fire, and `isBrownedOut` has no side effects, so eliding it is
 * byte-identical to the previous "scan, find nothing, return false" path.
 */
export function stepOvercharge(ship: SimShip): boolean {
  const { modules, techCaches } = ship;
  if (modules === undefined || techCaches === undefined) return false;
  if (!techCaches.hasOvercharge) return false;
  if (!isBrownedOut(ship)) return false;
  for (const m of modules) {
    if (m.effect.kind !== "overcharge") continue;
    if (!isOperational(m)) continue;
    if (m.techActive > 0 || m.techCooldown > 0) continue;
    m.techActive = m.effect.duration;
    m.techCooldown = m.effect.cooldown;
    return true;
  }
  return false;
}

/**
 * Recompute every ship's command-aura bonuses for the tick (factions update).
 * A ship with an alive, operational command-aura module projects its
 * `rangeBonus` / `accuracyBonus` to every friendly ship (itself included) within
 * `radius` world units. Each beneficiary takes the *max* bonus covering it — auras
 * do not stack — so layering carriers only ever raises a ship to the strongest
 * single aura, which bounds the buff regardless of fleet size.
 *
 * Deterministic and opt-in. Bonuses are reset to 0 on every ship first, then
 * raised by each source in array order; the max is order-independent. A battle
 * with no aura module touches nothing past the reset to the value the ship
 * already holds (0), so byte output is unchanged. Run after movement and before
 * firing so the buff reflects this tick's positions.
 */
export function applyCommandAuras(ships: readonly SimShip[]): void {
  for (const s of ships) {
    s.auraRangeBonus = 0;
    s.auraAccuracyBonus = 0;
  }
  for (const source of ships) {
    if (!source.alive) continue;
    // The per-ship `auraModules` list is the full module array filtered to
    // commandAura projectors at ship construction (a static kind). A ship with
    // no cache (no modules — legacy or phantom) or an empty list carries no
    // aura, so it is skipped without scanning its module array this tick. The
    // `isOperational` gate and the radius/bonus comparisons below are unchanged,
    // so byte output is identical to the previous full-module-array scan.
    const auraModules = source.techCaches?.auraModules;
    if (auraModules === undefined || auraModules.length === 0) continue;
    for (const m of auraModules) {
      if (!isOperational(m)) continue;
      const aura = m.effect;
      const radiusSq = aura.radius * aura.radius;
      for (const ally of ships) {
        if (!ally.alive || ally.side !== source.side) continue;
        const dx = ally.x - source.x;
        const dy = ally.y - source.y;
        if (dx * dx + dy * dy > radiusSq) continue;
        if (aura.rangeBonus > ally.auraRangeBonus) ally.auraRangeBonus = aura.rangeBonus;
        if (aura.accuracyBonus > ally.auraAccuracyBonus) {
          ally.auraAccuracyBonus = aura.accuracyBonus;
        }
      }
    }
  }
}
