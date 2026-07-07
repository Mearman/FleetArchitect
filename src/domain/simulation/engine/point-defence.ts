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
 * `pdCandidates` (buildPdCandidates, once per tick) gives the structural PD
 * set in walk order; per-projectile gates are re-applied here so this is
 * byte-identical to the former ship×module walk. The count and cooldown
 * passes share one collection (lossless: nothing mutates between them within
 * a single projectile).
 */
export function tryPointDefenseIntercept(
  p: SimProjectile,
  pdCandidates: readonly PdCandidate[],
  rng: () => number,
): boolean {
  const enemySide: BattleSide = p.ownerSide === "attacker" ? "defender" : "attacker";
  // Collect in-range, online, off-cooldown PD modules. A single rng draw
  // resolves the stacked chance — keeps the stream length independent of how
  // many PD modules fire.
  const firing: PdCandidate[] = [];
  for (const cand of pdCandidates) {
    const ship = cand.ship;
    if (!ship.alive || ship.side !== enemySide) continue;
    if (!hasAliveCommand(ship)) continue; // no bridge → no coordination
    const m = cand.module;
    if (!m.alive || !m.powered || m.powerCut || !m.manned || !isCharged(m)) continue;
    if (m.cooldown > 0) continue;
    const dx = ship.x - p.x;
    const dy = ship.y - p.y;
    if (fastHypot(dx, dy) <= cand.effect.range) firing.push(cand);
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
  return rng() < capped;
}
