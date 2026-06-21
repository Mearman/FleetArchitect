/**
 * Boarding pods: launch, in-flight homing, and the boarding action that
 * disables functional modules on contact.
 */

import type { BattleSpaceConfig } from "./space-config";
import { SIM } from "./config";
import { isOperational } from "./crew";
import { recomputeAggregates } from "./physics";
import { worldToLocal } from "./setup";
import { isDetectable } from "./stealth";
import type { SimPod, SimShip } from "./types";

/**
 * Launch boarding pods for every ready, operational boarding module on a ship,
 * appending the new pods to `pods`. A module fires only when it is off cooldown
 * and there is a detectable enemy within the effect's `range`; it targets the
 * nearest such enemy and launches `podCount` pods carrying `troops` apiece, then
 * goes on cooldown. Opt-in: a ship with no alive, operational, ready boarding
 * module adds nothing, so a battle with no boarding modules never grows the
 * array (and emits no `pods` snapshot, staying byte-identical to baseline).
 *
 * Detectability reuses the stealth acquisition gate, so a cloaked/low-signature
 * ship cannot be boarded unless the launcher can detect it. Deterministic:
 * modules scan in (col, row) order; the nearest detectable enemy is chosen by
 * squared distance with ship array order as the tie-break; pod ids come from
 * `nextPodId`, a per-run monotonic counter combined with owner id and tick.
 */
export function launchPods(
  ship: SimShip,
  pods: SimPod[],
  ships: readonly SimShip[],
  tick: number,
  nextPodId: (ownerId: string, tick: number) => string,
  space: BattleSpaceConfig,
): void {
  if (ship.modules === undefined) return;
  for (const m of ship.modules) {
    if (m.effect.kind !== "boarding") continue;
    if (m.boardingCooldown > 0 || !isOperational(m)) continue;
    const effect = m.effect;
    // Find the nearest detectable enemy inside launch range.
    const rangeSq = effect.range * effect.range;
    let target: SimShip | undefined;
    let nearestSq = Number.POSITIVE_INFINITY;
    for (const enemy of ships) {
      if (!enemy.alive || enemy.side === ship.side) continue;
      const dx = enemy.x - ship.x;
      const dy = enemy.y - ship.y;
      const dSq = dx * dx + dy * dy;
      if (dSq > rangeSq) continue;
      if (!isDetectable(ship, enemy, dSq, tick, space)) continue;
      // Strict-less keeps the first ship in array order on an exact tie.
      if (dSq < nearestSq) {
        target = enemy;
        nearestSq = dSq;
      }
    }
    if (target === undefined) continue;
    for (let i = 0; i < effect.podCount; i += 1) {
      pods.push({
        id: nextPodId(ship.instanceId, tick),
        side: ship.side,
        x: ship.x,
        y: ship.y,
        targetInstanceId: target.instanceId,
        troops: effect.troops,
      });
    }
    m.boardingCooldown = effect.cooldown;
  }
}

/**
 * Advance every pod one tick: home on its target, and on contact board it. A
 * pod whose target is gone or dead expires (is dropped). A pod that reaches its
 * target (within the target's collision radius) boards: it disables `troops` of
 * the target's alive functional modules nearest the impact point, then the pod
 * is consumed. Returns the surviving (un-boarded, in-flight) pods, mirroring
 * `updateMines`/`updateProjectiles` — consumed and expired pods are simply not
 * carried forward, so the array only ever holds live pods.
 *
 * Module selection on boarding: the pod's world position is transformed into the
 * target's ship-local space; among alive functional modules (not pure hull, not
 * the command module — boarding suppresses systems, it does not one-shot the
 * bridge) the `troops` nearest to that local point are disabled, chosen by
 * squared local distance with module array `(col, row)` order as the tie-break.
 * The aggregates are recomputed so the disablement reflects in the ship's combat
 * stats immediately. Deterministic: pods step in array (creation) order; every
 * distance/order choice is a pure function of state, no rng.
 */
export function updatePods(pods: readonly SimPod[], ships: readonly SimShip[]): SimPod[] {
  const byId = new Map(ships.map((s) => [s.instanceId, s]));
  const survivors: SimPod[] = [];
  for (const pod of pods) {
    const target = byId.get(pod.targetInstanceId);
    if (target === undefined || !target.alive) continue; // target gone: pod expires
    // Home toward the target's current centre, clamped so the pod never overshoots.
    const dx = target.x - pod.x;
    const dy = target.y - pod.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= target.radius) {
      // Contact: board the target and consume the pod.
      boardShip(target, pod);
      continue;
    }
    const step = Math.min(SIM.boardingPodSpeed, dist);
    survivors.push({
      ...pod,
      x: pod.x + (dx / dist) * step,
      y: pod.y + (dy / dist) * step,
    });
  }
  return survivors;
}

/**
 * Disable `pod.troops` of `ship`'s alive functional modules nearest the pod's
 * impact point (the pod's current world position, transformed into ship-local
 * space), then recompute the ship's aggregates so the loss shows in its combat
 * stats. Functional = any non-hull, non-command module, so boarding suppresses
 * weapons/engines/shields/etc. but cannot one-shot the bridge. Modules are
 * scanned in array `(col, row)` order and chosen by squared local distance with
 * that order as the tie-break — a pure function of state, no rng.
 */
export function boardShip(ship: SimShip, pod: SimPod): void {
  if (ship.modules === undefined) return;
  // Transform the pod's impact point into ship-local space. worldToLocal returns
  // undefined only for undefined inputs, and pod.x/pod.y are always defined, so
  // this never falls through in practice; the guard boards the centre-of-mass
  // systems rather than skipping, so a degenerate impact still degrades the ship.
  const local = worldToLocal(ship, pod.x, pod.y);
  const ix = local === undefined ? ship.comX : local.x;
  const iy = local === undefined ? ship.comY : local.y;
  // Candidates: alive functional modules (not armor plate — boarding disables
  // equipment, not structure), by distance from the impact point.
  const candidates = ship.modules
    .filter(
      (m) => m.alive && m.surface !== "armor" && !m.command,
    )
    .map((m) => {
      const ddx = m.x - ix;
      const ddy = m.y - iy;
      return { m, dSq: ddx * ddx + ddy * ddy };
    });
  // Stable sort by distance; array order is the tie-break (sort is stable in
  // modern engines, and the map preserves module (col, row) order).
  candidates.sort((a, b) => a.dSq - b.dSq);
  const toDisable = Math.min(pod.troops, candidates.length);
  for (let i = 0; i < toDisable; i += 1) {
    const c = candidates[i];
    if (c === undefined) break;
    c.m.alive = false;
    c.m.surfaceHp = 0;
    c.m.hp = 0;
  }
  recomputeAggregates(ship);
}

// ---------------------------------------------------------------------------
// Phantom combatants (factions update): drones launched by hangars and decoys
// launched by decoy launchers. Both are lightweight SimShips (see the `phantom`
// field) so enemies can target and shoot them through the normal pipelines; they
// are skipped as firers/movers/colliders and instead home/strike (drones) or sit
// as a targetable pool (decoys) in the bespoke steps below.
// ---------------------------------------------------------------------------
