/**
 * Proximity mines and the shared tech-cooldown tick (reactive armour,
 * mine-layer, boarding, blink/afterburner/overcharge recharge).
 */

import { isOperational } from "./crew";
import { applyImpact } from "./damage-impact";
import { energyImpactProfile } from "./impact-profile";
import { cellWorldPosition } from "@/domain/simulation/spatial-hash";
import type { SimMine, SimShip } from "./types";

/**
 * Tick every ship module's tech timers down by one (factions update): an active
 * boost window (`techActive`) counts toward expiry, and a recharging drive
 * (`techCooldown`) counts toward readiness. Run once per tick per ship in array
 * order, modules in (col, row) order, so the timers advance deterministically.
 * A module with all its timers at 0 (every non-tech module, an idle ready tech
 * module, and a charged reactive plate) is untouched, so the step is a no-op for
 * ships without the tech. The reactive armour recharge counter advances here too.
 */
export function stepTechCooldowns(ship: SimShip): void {
  if (ship.modules === undefined) return;
  for (const m of ship.modules) {
    if (m.techActive > 0) m.techActive -= 1;
    if (m.techCooldown > 0) m.techCooldown -= 1;
    // Reactive armour layer recharges toward ready (0). Only ever above 0 on an
    // armour module that has just absorbed a hit, so this is inert otherwise.
    if (m.reactiveCharge > 0) m.reactiveCharge -= 1;
    // Mine-layer recharges toward ready (0). Only ever above 0 on a mine-layer
    // that has just laid a batch, so this is inert otherwise.
    if (m.mineCooldown > 0) m.mineCooldown -= 1;
    // Boarding launcher recharges toward ready (0). Only ever above 0 on a
    // boarding module that has just launched a salvo, so this is inert otherwise.
    if (m.boardingCooldown > 0) m.boardingCooldown -= 1;
  }
}

/**
 * Deterministic ship-local offset for mine index `i` within a batch. Index 0
 * lands on the ship centre; later mines step out in a fixed ring whose radius
 * grows every `MINES_PER_RING` mines, with the angle spread evenly around the
 * circle by index. Pure function of the index — no rng, no ship state — so two
 * runs with the same seed lay every mine at the same place. */
export function mineBatchOffset(
  i: number,
  ringSpacing: number,
): { dx: number; dy: number } {
  if (i <= 0) return { dx: 0, dy: 0 };
  const ring = Math.floor((i - 1) / MINES_PER_RING) + 1;
  const indexInRing = (i - 1) % MINES_PER_RING;
  const angle = (indexInRing / MINES_PER_RING) * (Math.PI * 2);
  const r = ring * ringSpacing;
  return { dx: Math.cos(angle) * r, dy: Math.sin(angle) * r };
}

/** Mines per ring before the batch steps out to the next, larger ring. */
export const MINES_PER_RING = 6;

/**
 * Lay mines for every ready, operational mine-layer module on a ship, appending
 * the new mines to `mines`. Opt-in: a ship with no alive, operational, ready
 * mine-layer adds nothing, so a battle with no mine-layers never grows the array
 * (and so emits no `mines` snapshot, staying byte-identical to baseline).
 *
 * Cap rule: a layer lays a fresh batch only when its `mineCooldown` has elapsed
 * AND it has no mine of its own still alive in the world (matched by owner ship
 * + slot). This bounds the world to at most one live batch per layer, so a long
 * battle can never spawn unbounded mines, and the cooldown still paces re-laying
 * once a batch has been spent. Placement is the deterministic batch ring around
 * the ship's current centre; each mine arms after the effect's `armingDelay`.
 *
 * Ids come from `nextMineId`, a per-run monotonic counter combined with the
 * owner instance id and tick, so they are unique and reproducible across runs.
 */
export function layMines(
  ship: SimShip,
  mines: SimMine[],
  tick: number,
  nextMineId: (ownerId: string, tick: number) => string,
  ringSpacing: number,
): void {
  if (ship.modules === undefined) return;
  for (const m of ship.modules) {
    if (m.effect.kind !== "mineLayer") continue;
    if (m.mineCooldown > 0 || !isOperational(m)) continue;
    // Cap: do not re-lay while this layer's previous batch is still alive.
    const hasLiveBatch = mines.some(
      (mine) =>
        mine.ownerInstanceId === ship.instanceId && mine.ownerSlotId === m.slotId,
    );
    if (hasLiveBatch) continue;
    const effect = m.effect;
    // Mines emanate from the mine-layer module's cell (rotated into world by
    // the ship's pose), with the deterministic batch ring spread around it.
    const cell = cellWorldPosition(ship.x, ship.y, ship.facing, m.x, m.y);
    for (let i = 0; i < effect.mineCount; i++) {
      const { dx, dy } = mineBatchOffset(i, ringSpacing);
      mines.push({
        id: nextMineId(ship.instanceId, tick),
        side: ship.side,
        x: cell.wx + dx,
        y: cell.wy + dy,
        ownerInstanceId: ship.instanceId,
        ownerSlotId: m.slotId,
        armingLeft: effect.armingDelay,
        damage: effect.mineDamage,
        radius: effect.mineRadius,
      });
    }
    m.mineCooldown = effect.layCooldown;
  }
}

/**
 * Advance every mine one tick: count down its arming delay, then detonate any
 * armed mine that has an enemy ship inside its radius against the nearest such
 * enemy (full damage through the standard `applyDamage` path, so shields, armour
 * and modules all apply). A mine never harms its own side. Returns the surviving
 * (un-detonated) mines, mirroring `updateProjectiles` — detonated mines are
 * simply not carried forward, so the array only ever holds live mines.
 *
 * Deterministic: mines step in array (creation) order; the nearest enemy is
 * chosen by squared distance with the ship array order as the tie-break, so two
 * runs with the same seed detonate identical mines against identical targets.
 */
export function updateMines(
  mines: readonly SimMine[],
  ships: readonly SimShip[],
): SimMine[] {
  const survivors: SimMine[] = [];
  for (const mine of mines) {
    if (mine.armingLeft > 0) {
      survivors.push({ ...mine, armingLeft: mine.armingLeft - 1 });
      continue;
    }
    // Armed: find the nearest enemy ship inside the blast radius.
    const radiusSq = mine.radius * mine.radius;
    let nearest: SimShip | undefined;
    let nearestSq = Number.POSITIVE_INFINITY;
    for (const ship of ships) {
      if (!ship.alive || ship.side === mine.side) continue;
      const dx = ship.x - mine.x;
      const dy = ship.y - mine.y;
      const dSq = dx * dx + dy * dy;
      if (dSq > radiusSq) continue;
      // Strict-less keeps the first ship in array order on an exact tie.
      if (dSq < nearestSq) {
        nearest = ship;
        nearestSq = dSq;
      }
    }
    if (nearest === undefined) {
      survivors.push(mine);
      continue;
    }
    // Detonate: damage the nearest enemy and consume the mine (drop it).
    applyImpact(nearest, energyImpactProfile({ energyJ: mine.damage, shieldPiercing: 0, armourPiercing: 0 }), mine.x, mine.y);
  }
  return survivors;
}
