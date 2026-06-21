import type { SimMine, SimShip } from "./types";

/**
 * No-progress stalemate watchdog. An uncapped battle has no fixed tick limit, so
 * this is its termination guarantee. It tracks all-time lows of three monotone
 * quantities and counts consecutive "idle" ticks — ticks that set no new low in
 * any of them, meaning the battle made no headway:
 *
 *  - combined hull+shield HP across live ships — damage landing, or a kill;
 *  - the closest enemy-pair distance — the two sides closing;
 *  - the closest ship-to-mine distance — a ship drifting onto a hazard.
 *
 * After enough consecutive idle ticks neither side can make further progress, so
 * the caller ends the battle (deciding it on remaining HP). Every input is
 * deterministic per-tick state, so two same-seed runs trip the watchdog on the
 * same tick. Squared distances avoid a sqrt and preserve the ordering.
 */
export interface StalemateWatch {
  hpLow: number;
  enemyDistLow: number;
  mineDistLow: number;
  idleTicks: number;
}

/** Combined hull+shield HP across live, real (non-phantom) ships. */
function liveHpTotal(ships: readonly SimShip[]): number {
  return ships.reduce(
    (sum, s) =>
      s.alive && s.phantom === undefined ? sum + s.structure + s.shield : sum,
    0,
  );
}

/** Closest squared distance between any live real attacker and defender. */
function minEnemyDist2(
  attackers: readonly SimShip[],
  defenders: readonly SimShip[],
): number {
  let min = Infinity;
  for (const a of attackers) {
    if (!a.alive || a.phantom !== undefined) continue;
    for (const d of defenders) {
      if (!d.alive || d.phantom !== undefined) continue;
      const dx = a.x - d.x;
      const dy = a.y - d.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < min) min = dist2;
    }
  }
  return min;
}

/** Closest squared distance between any live real ship and any laid mine. */
function minMineDist2(
  ships: readonly SimShip[],
  mines: readonly SimMine[],
): number {
  if (mines.length === 0) return Infinity;
  let min = Infinity;
  for (const s of ships) {
    if (!s.alive || s.phantom !== undefined) continue;
    for (const m of mines) {
      const dx = s.x - m.x;
      const dy = s.y - m.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < min) min = dist2;
    }
  }
  return min;
}

/** Initialise the watch from the tick-0 state. */
export function createStalemateWatch(ships: readonly SimShip[]): StalemateWatch {
  return {
    hpLow: liveHpTotal(ships),
    enemyDistLow: Infinity,
    mineDistLow: Infinity,
    idleTicks: 0,
  };
}

/**
 * Record this tick. A new all-time low in any tracked quantity is progress and
 * resets the idle counter; otherwise the idle counter advances. Returns true
 * once `idleLimit` consecutive idle ticks have elapsed — the battle is stuck.
 */
export function tickStalemateWatch(
  watch: StalemateWatch,
  ships: readonly SimShip[],
  attackers: readonly SimShip[],
  defenders: readonly SimShip[],
  mines: readonly SimMine[],
  idleLimit: number,
): boolean {
  const hp = liveHpTotal(ships);
  const enemyDist = minEnemyDist2(attackers, defenders);
  const mineDist = minMineDist2(ships, mines);
  let progressed = false;
  if (hp < watch.hpLow) {
    watch.hpLow = hp;
    progressed = true;
  }
  if (enemyDist < watch.enemyDistLow) {
    watch.enemyDistLow = enemyDist;
    progressed = true;
  }
  if (mineDist < watch.mineDistLow) {
    watch.mineDistLow = mineDist;
    progressed = true;
  }
  if (progressed) {
    watch.idleTicks = 0;
    return false;
  }
  watch.idleTicks += 1;
  return watch.idleTicks >= idleLimit;
}
