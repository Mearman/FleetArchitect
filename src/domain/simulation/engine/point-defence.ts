/**
 * Point-defence intercept: the per-tick candidate build (`buildPdCandidates`)
 * and the per-projectile intercept roll (`tryPointDefenseIntercept`). Split
 * from `weapons.ts` so that file stays under the per-file line cap as the PD
 * model grows (projectile HP, lead-aim).
 */

import type { BattleSide } from "@/schema/battle";
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

/** Enumerate every PD module on every modular ship once per tick in walk
 *  order, so the per-projectile loop iterates only PD modules. */
export function buildPdCandidates(byId: Map<string, SimShip>): PdCandidate[] {
  const candidates: PdCandidate[] = [];
  for (const [, ship] of byId) {
    if (ship.modules === undefined) continue; // legacy ships don't run PD
    for (const m of ship.modules) {
      if (m.effect.kind !== "pointDefense") continue;
      candidates.push({ ship, module: m, effect: m.effect });
    }
  }
  return candidates;
}

/**
 * Roll for a point-defence intercept (true if the projectile was shot down).
 * In-range, online, off-cooldown PD modules on the opposing side stack their
 * authored per-module hitChance as a survival product
 * `1 - Π(1 - hitChance)`, capped at `SIM.pdMaxStackedChance`; only modular
 * ships carry PD, and PD needs an alive command module. A single rng draw
 * resolves the stack, keeping the rng stream length independent of how many PD
 * modules fire.
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
 * `pdCandidates` (buildPdCandidates, once per tick) gives the structural PD
 * set in walk order; per-projectile gates are re-applied here so this is
 * byte-identical to the former ship×module walk. The count, lead-aim, and
 * cooldown passes share one collection (lossless: nothing mutates between them
 * within a single projectile until the damage step, which runs after the draw).
 */
export function tryPointDefenseIntercept(
  p: SimProjectile,
  pdCandidates: readonly PdCandidate[],
  rng: () => number,
  /** Reusable scratch for the firing subset (`state.pdFiringScratch`) — cleared
   *  at the top of each call. When omitted a fresh array is allocated. Same
   *  clear-and-reuse contract as `cellHashScratch` in `updateProjectiles`. */
  firingScratch?: PdCandidate[],
): boolean {
  const enemySide: BattleSide = p.ownerSide === "attacker" ? "defender" : "attacker";
  // Collect in-range, online, off-cooldown PD modules. A single rng draw
  // resolves the stacked chance — keeps the stream length independent of how
  // many PD modules fire.
  const firing = firingScratch ?? [];
  firing.length = 0;
  // `hasAliveCommand` linear-scans ship.modules, so it is O(cells). The cheap
  // O(1) gates (module state, cooldown, range, lead-aim) run first so a
  // candidate already excluded by a trivial check never pays that scan.
  // pdCandidates is built ship-major (buildPdCandidates walks byId), so a
  // ship's candidates are contiguous; cache the bridge-alive result per ship
  // to compute it once per (ship, projectile) instead of once per PD module.
  // Nothing mutates module alive/hp between candidates in this collection loop
  // (cooldown and hp writes happen strictly after the firing set is finalised),
  // so the cached value is valid for the whole loop.
  let lastShip: SimShip | undefined;
  let lastShipHasCommand = false;
  for (const cand of pdCandidates) {
    const ship = cand.ship;
    if (!ship.alive || ship.side !== enemySide) continue;
    const m = cand.module;
    if (!m.alive || !m.powered || m.powerCut || !m.manned || !isCharged(m)) continue;
    if (m.cooldown > 0) continue;
    const dx = ship.x - p.x;
    const dy = ship.y - p.y;
    if (fastHypot(dx, dy) > cand.effect.range) continue;
    // Lead-aim gate: a mount can only follow a projectile whose traverse
    // across it stays within the mount's `tracking` (plus the radial-inbound
    // epsilon). `cross = dx·p.vy − dy·p.vx` is the 2-D r×v; |cross|/r² is the
    // angular rate. No rng — a deterministic geometric filter that composes
    // with the hitChance stack below.
    const r2 = dx * dx + dy * dy;
    if (r2 > 0) {
      const cross = dx * p.vy - dy * p.vx;
      const omega = Math.abs(cross) / r2;
      if (omega > cand.effect.tracking + SIM.pdTrackingEpsilon) continue;
    }
    if (ship !== lastShip) {
      lastShip = ship;
      lastShipHasCommand = hasAliveCommand(ship);
    }
    if (!lastShipHasCommand) continue; // no bridge → no coordination
    firing.push(cand);
  }
  if (firing.length === 0) return false;
  // Stack per-module hit chances: each candidate multiplies the projectile's
  // survival by (1 - its authored hitChance), so a faction's PD accuracy
  // (Synthetic 0.7 vs Swarm 0.35) actually matters. pdHitChancePerModule is the
  // fallback for a module that omits the field.
  let survival = 1;
  for (const cand of firing) {
    survival *= 1 - (cand.effect.hitChance ?? SIM.pdHitChancePerModule);
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
