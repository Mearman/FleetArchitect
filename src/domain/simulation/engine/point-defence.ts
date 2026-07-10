/**
 * Point-defence intercept: the per-tick candidate build (`buildPdCandidates`)
 * and the per-projectile intercept roll (`tryPointDefenseIntercept`). Split
 * from `weapons.ts` so that file stays under the per-file line cap as the PD
 * model grows (projectile HP, lead-aim).
 */

import type { PointDefenseEffect } from "@/schema/module";
import { hasAliveCommand } from "./alive-modules";
import { SIM } from "./config";
import { isCharged } from "./crew";
import { fastHypot } from "./hypot";
import type { SimModule, SimProjectile, SimShip } from "./types";

/** A PD candidate: a PD module on a modular ship, captured once per tick in
 *  walk order. Only structural facts are baked in; dynamic gates are
 *  re-checked per projectile so mid-tick kills/cooldowns are handled as before. */
export interface PdCandidate {
  readonly ship: SimShip;
  readonly module: SimModule;
  readonly effect: PointDefenseEffect;
}

/** A PD candidate that has cleared every per-projectile gate, augmented with
 *  its tracking-rate margin for the physical hit-chance model. The margin is
 *  `1 − omega / (tracking + pdTrackingEpsilon)`: 1 for a radial inbounder the
 *  mount tracks trivially, 0 at its gimbal limit. It scales the authored
 *  hitChance so a mount with rate headroom is likely to connect while one near
 *  its tracking limit is not. */
export interface FiringCandidate {
  readonly ship: SimShip;
  readonly module: SimModule;
  readonly effect: PointDefenseEffect;
  readonly trackingMargin: number;
}

/** Per-side buckets of PD candidates, built once per tick. Each bucket holds
 *  only PD mounts that were alive at tick start — a dead mount never recovers,
 *  so excluding it here is lossless — in the same ship-major walk order the
 *  former single-list build produced, so a side's firing candidates still
 *  accumulate in identical order. The per-projectile loop still re-checks
 *  `ship.alive`/`m.alive` because a missile impact earlier in the projectile
 *  loop can kill a PD mount before a later missile's PD roll. */
export interface PdBuckets {
  readonly attacker: readonly PdCandidate[];
  readonly defender: readonly PdCandidate[];
}

/** Enumerate every alive PD module on every alive modular ship once per tick,
 *  partitioned by side in walk order, so the per-projectile loop iterates only
 *  the opposing side's pre-filtered mounts. Byte-identical to the former
 *  single-list build plus the per-projectile side gate: each side's candidates
 *  land in its bucket in the same relative order, and mounts dead at tick start
 *  are excluded (they would have been skipped by the alive gate every time). */
export function buildPdCandidates(byId: Map<string, SimShip>): PdBuckets {
  const attacker: PdCandidate[] = [];
  const defender: PdCandidate[] = [];
  for (const [, ship] of byId) {
    if (ship.modules === undefined) continue; // legacy ships don't run PD
    if (!ship.alive) continue; // dead at tick start: permanently out of the fight
    const bucket = ship.side === "attacker" ? attacker : defender;
    for (const m of ship.modules) {
      if (m.effect.kind !== "pointDefense") continue;
      if (!m.alive) continue; // destroyed mount: never fires this tick
      bucket.push({ ship, module: m, effect: m.effect });
    }
  }
  return { attacker, defender };
}

/**
 * Roll for a point-defence intercept (true if the projectile was shot down).
 * In-range, online, off-cooldown PD modules on the opposing side stack their
 * per-module hit chances as a survival product `1 - Π(1 - p_i)`, capped at
 * `SIM.pdMaxStackedChance`; only modular ships carry PD, and PD needs an alive
 * command module. A single rng draw resolves the stack, keeping the rng stream
 * length independent of how many PD modules fire.
 *
 * Per-module chance `p_i` is the physical hit model: the authored `hitChance`
 * scaled by the tracking-rate margin `1 − omega / (tracking + epsilon)`. A
 * mount with lots of rate headroom (slow-crossing or radial target) fires near
 * its authored accuracy; a mount near its gimbal limit fires near zero.
 *
 * Two deterministic filters gate which candidates fire, both preserving the
 * single-draw contract:
 *
 *  - Lead-aim (tracking): the projectile's angular rate across the mount
 *    `omega = |cross| / r²` (cross = dx·p.vy − dy·p.vx, the 2-D analogue of
 *    r×v) must not exceed `cand.effect.tracking + SIM.pdTrackingEpsilon`. The
 *    epsilon lets a `tracking: 0` mount still engage a near-radial infleeder
 *    (omega ≈ 0). This filter runs BEFORE the hitChance stack, so it composes
 *    with the per-module hitChance already wired; it draws no rng.
 *
 *  - Damage step (all-or-nothing, single draw): if the rng roll misses the
 *    stacked chance the projectile passes untouched; if it hits, EVERY firing
 *    candidate applies its `effect.damage` to `p.hp` in walk order, then the
 *    projectile is destroyed iff `p.hp <= 0`. So a heavy torpedo (hp 120) tanks
 *    a screen that deals < 120 cumulative damage; a missile (hp 30) dies to a
 *    couple of typical hits. Only one rng draw is consumed either way.
 *
 * `enemyPdCandidates` is the opposing side's PD bucket from `buildPdCandidates`
 * (once per tick): the side gate is structural there, and mounts dead at tick
 * start are already excluded. Per-projectile gates are re-applied here so this
 * is byte-identical to the former ship×module walk — including the alive gate,
 * which must run per projectile because a missile impact earlier in
 * `updateProjectiles`' loop can kill a PD mount before a later missile's roll.
 * The count, lead-aim, and cooldown passes share one collection (lossless:
 * nothing mutates between them within a single projectile until the damage
 * step, which runs after the draw).
 */
export function tryPointDefenseIntercept(
  p: SimProjectile,
  /** The opposing side's PD candidates for this tick (the enemy bucket from
   *  `buildPdCandidates`, pre-filtered to alive-at-tick-start). Side is
   *  structural — the caller selects the enemy bucket — so there is no side
   *  gate in the loop. */
  enemyPdCandidates: readonly PdCandidate[],
  rng: () => number,
  /** Reusable scratch for the firing subset (`state.pdFiringScratch`) — cleared
   *  at the top of each call. When omitted a fresh array is allocated. Same
   *  clear-and-reuse contract as `cellHashScratch` in `updateProjectiles`. */
  firingScratch?: FiringCandidate[],
): boolean {
  // Collect in-range, online, off-cooldown PD modules. A single rng draw
  // resolves the stacked chance — keeps the stream length independent of how
  // many PD modules fire.
  const firing = firingScratch ?? [];
  firing.length = 0;
  // `hasAliveCommand` linear-scans ship.modules, so it is O(cells). The cheap
  // O(1) gates (module state, cooldown, range, lead-aim) run first so a
  // candidate already excluded by a trivial check never pays that scan.
  // The enemy bucket is built ship-major (buildPdCandidates walks byId), so a
  // ship's candidates are contiguous; cache the bridge-alive result per ship
  // to compute it once per (ship, projectile) instead of once per PD module.
  // Nothing mutates module alive/hp between candidates in this collection loop
  // (cooldown and hp writes happen strictly after the firing set is finalised),
  // so the cached value is valid for the whole loop.
  let lastShip: SimShip | undefined;
  let lastShipHasCommand = false;
  for (const cand of enemyPdCandidates) {
    const ship = cand.ship;
    // Side is structural (the caller passes the enemy bucket); alive is
    // re-checked because a missile impact earlier in updateProjectiles' loop
    // can kill this mount before this projectile's roll.
    if (!ship.alive) continue;
    const m = cand.module;
    if (!m.alive || !m.powered || m.powerCut || !m.manned || !isCharged(m)) continue;
    if (m.cooldown > 0) continue;
    const dx = ship.x - p.x;
    const dy = ship.y - p.y;
    if (fastHypot(dx, dy) > cand.effect.range) continue;
    // Lead-aim gate + tracking-rate margin: a mount can only follow a
    // projectile whose traverse across it stays within the mount's `tracking`
    // (plus the radial-inbound epsilon). `cross = dx·p.vy − dy·p.vx` is the
    // 2-D r×v; |cross|/r² is the angular rate. No rng — a deterministic
    // geometric filter. The margin `1 − omega / limit` (1 at omega 0, 0 at the
    // limit) then scales the authored hitChance so a mount with rate headroom
    // is likely to connect while one near its gimbal limit is not.
    const r2 = dx * dx + dy * dy;
    let trackingMargin = 1; // r2 == 0: projectile on the mount, trivially tracked
    if (r2 > 0) {
      const cross = dx * p.vy - dy * p.vx;
      const omega = Math.abs(cross) / r2;
      const trackingLimit = cand.effect.tracking + SIM.pdTrackingEpsilon;
      if (omega > trackingLimit) continue;
      trackingMargin = 1 - omega / trackingLimit;
    }
    if (ship !== lastShip) {
      lastShip = ship;
      lastShipHasCommand = hasAliveCommand(ship);
    }
    if (!lastShipHasCommand) continue; // no bridge → no coordination
    firing.push({ ...cand, trackingMargin });
  }
  if (firing.length === 0) return false;
  // Stack per-module hit chances: each candidate multiplies the projectile's
  // survival by (1 - its effective chance), where the effective chance is the
  // authored hitChance scaled by the tracking-rate margin. A faction's PD
  // accuracy (Synthetic 0.7 vs Swarm 0.35) sets the ceiling; the margin sets
  // how close to that ceiling each mount gets. pdHitChancePerModule is the
  // fallback for a module that omits the field.
  let survival = 1;
  for (const cand of firing) {
    const base = cand.effect.hitChance ?? SIM.pdHitChancePerModule;
    survival *= 1 - base * cand.trackingMargin;
  }
  const stacked = 1 - survival;
  const capped = Math.min(stacked, SIM.pdMaxStackedChance);
  // Consume one cycle on every contributing module regardless of outcome — a
  // PD battery firing into the sky still pays its cooldown, spacing salvos
  // across ticks rather than back-to-back.
  for (const cand of firing) {
    cand.module.cooldown = cand.effect.cooldown;
  }
  // All-or-nothing damage step (preserves the single-draw contract). A miss
  // leaves the projectile untouched; a hit applies every firing candidate's
  // authored `damage` to `p.hp` in walk order, then the projectile dies iff its
  // hull is gone. A heavy torpedo (hp 120) tanks a screen that deals < 120
  // cumulatively; a missile (hp 30) dies to ~2 typical hits.
  if (rng() >= capped) return false;
  for (const cand of firing) {
    p.hp -= cand.effect.damage;
  }
  return p.hp <= 0;
}
