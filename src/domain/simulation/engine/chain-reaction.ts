/**
 * Explosive chain reactions (realism overhaul, Phase 4): when a volatile module
 * (a reactor or a magazine) is destroyed, it detonates, dealing radial damage to
 * the rest of its ship and chaining into any further volatile cells it kills.
 *
 * Split out of `damage.ts` so each file stays within the line budget; the logic
 * is unchanged. `resolveChainReactions` is the only entry point (called once per
 * ship per tick by the engine); the blast routing reuses `applyDamage` from
 * `damage.ts`, so there is no duplicated damage maths and no import cycle
 * (`damage.ts` never imports this module back).
 */
import { CELL_SIZE } from "@/domain/grid";

import { SIM } from "./config";
import { applyDamage } from "./damage";
import { PERF_GUARDS } from "./perf-guards";
import { localPointToWorld } from "./setup";
import type { SimModule, SimShip } from "./types";

/**
 * True for a module whose destruction sets off a secondary explosion: a reactor
 * (`power` plant) or an ammunition `magazine`. Every other module kind is inert
 * when it dies. The single place the "volatile" set is defined, so the queue
 * builder and the yield calculation agree.
 */
function isVolatile(m: SimModule): boolean {
  return m.effect.kind === "power" || m.effect.kind === "magazine";
}

/**
 * The blast yield (energy-equivalent damage units, the same units as module HP)
 * released when a volatile module is destroyed:
 *  - a reactor releases `SIM.chainReaction.reactorYieldFraction` of its rated
 *    `output` — a tiny fraction, so the shockwave wrecks neighbours without
 *    annihilating the ship;
 *  - a magazine releases `SIM.chainReaction.magazineYieldPerRound` per round it
 *    still held (`ammoStored`) at the moment it died, so a full magazine is a
 *    serious secondary and an empty one barely pops.
 * Returns 0 for any non-volatile module (never called for one, but keeps the
 * function total).
 */
function blastYield(m: SimModule): number {
  if (m.effect.kind === "power") {
    return m.effect.output * SIM.chainReaction.reactorYieldFraction;
  }
  if (m.effect.kind === "magazine") {
    return m.ammoStored * SIM.chainReaction.magazineYieldPerRound;
  }
  return 0;
}

/**
 * Explosive chain reactions (realism overhaul, Phase 4). Detonate every volatile
 * module (reactor / magazine) that has died on this ship but not yet exploded,
 * draining the resulting chain within this single tick.
 *
 * A volatile module explodes the moment its HP reaches zero. Its blast does
 * radial damage to every other alive module on the SAME ship within
 * `SIM.chainReaction.radius`, with linear falloff from the exploding cell's
 * ship-local `(x, y)` to zero at the blast radius. The blast originates inside
 * the hull, so it bypasses shields and armour (shieldPiercing = armourPiercing =
 * 1) and is routed through the existing `applyDamage` pipeline per target cell —
 * no duplicated damage logic. If a blast reduces another reactor/magazine to
 * zero HP, that module is detonated in turn, so a row of volatile cells goes up
 * together.
 *
 * Determinism: the work queue is tick-local (built fresh here, never persisted)
 * and always drained in ascending `slotId` order, and each volatile module
 * carries an `exploded` flag so it detonates exactly once across the whole
 * battle however many ticks the chain spans. With no volatile deaths the queue
 * is empty and the function is a no-op, so a battle that never loses a reactor or
 * magazine is byte-identical to before.
 */
export function resolveChainReactions(ship: SimShip): void {
  if (ship.modules === undefined) return;
  const modules = ship.modules;

  // Seed the queue with every volatile module that has died but not yet
  // detonated. The chain may add more as blasts kill further volatile cells.
  const collectPending = (): SimModule[] =>
    modules
      .filter((m) => !m.alive && isVolatile(m) && !m.exploded)
      .sort((a, b) => (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0));

  let pending = collectPending();
  if (pending.length === 0) return; // no volatile death: the common case, untouched.

  // Spatial index for the blast-target query: every cell keyed by its integer
  // grid position, so a blast can look up only the cells within its radius box
  // instead of scanning (and sorting) the whole hull per blast. Built once for
  // the whole chain; cells only ever die (never resurrect), so a stale entry is
  // simply skipped on lookup via its live `alive` flag — no removal needed.
  // Built only when there is at least one detonation to process, so a battle
  // with no volatile deaths never pays for it.
  const cellIndex = PERF_GUARDS.chainReactionSpatial ? buildCellIndex(modules) : undefined;

  while (pending.length > 0) {
    for (const source of pending) {
      // Mark spent before applying the blast so a cell can never re-enter the
      // queue, even if its own blast somehow reached back to it.
      source.exploded = true;
      detonate(ship, source, cellIndex);
    }
    // The blasts above may have killed further volatile cells; rebuild the
    // queue and keep going until the chain settles.
    pending = collectPending();
  }
}

/** Integer encoding of a cell's grid position into a single number key, packing
 *  `col` and `row` so two distinct cells never collide. Cols/rows are small,
 *  bounded grid indices, so the linear pack is exact within safe-integer range. */
function packCell(col: number, row: number): number {
  // Offset into the non-negative range, then pack row into the high band. The
  // 0x10000 stride comfortably exceeds any real grid dimension, so (col, row)
  // pairs map one-to-one onto distinct integers.
  return (row + 0x8000) * 0x10000 + (col + 0x8000);
}

/** Index every module by its packed cell key. One module per (col, row), so the
 *  map is a bijection over the ship's cells. */
function buildCellIndex(modules: readonly SimModule[]): Map<number, SimModule> {
  const index = new Map<number, SimModule>();
  for (const m of modules) index.set(packCell(m.col, m.row), m);
  return index;
}

/**
 * Apply a single volatile module's blast to the rest of its ship. Each alive
 * module within `SIM.chainReaction.radius` of the source cell takes damage that
 * falls off linearly with distance — full yield at the centre, zero at the
 * radius — routed through `applyDamage` aimed at that target cell's world
 * position (so the pipeline's nearest-cell selection lands the hit on it). The
 * blast pierces shields and armour because it goes off inside the hull.
 *
 * Targets are processed in ascending `slotId` order so the chain is deterministic
 * regardless of array layout.
 */
function detonate(
  ship: SimShip,
  source: SimModule,
  cellIndex: Map<number, SimModule> | undefined,
): void {
  if (ship.modules === undefined) return;
  const yieldAmount = blastYield(source);
  if (yieldAmount <= 0) return;
  const { radius } = SIM.chainReaction;

  const targets = collectBlastTargets(ship.modules, source, radius, cellIndex);

  for (const target of targets) {
    const dist = Math.hypot(target.x - source.x, target.y - source.y);
    if (dist >= radius) continue;
    const falloff = 1 - dist / radius;
    const damage = yieldAmount * falloff;
    if (damage <= 0) continue;
    // The target cell's world position so applyDamage's nearest-cell selection
    // lands the hit on it. Internal blast: pierce shields and armour fully.
    const world = localPointToWorld(ship, target.x, target.y);
    applyDamage(ship, damage, 1, 1, world.x, world.y);
  }
}

/**
 * The blast's candidate target cells: every alive cell other than the source,
 * in ascending `slotId` order. Two equivalent derivations:
 *
 *  - **spatial** (`cellIndex` supplied): only cells within the blast's radius
 *    box are gathered. A cell's ship-local position is `(col − centreCol)·CELL`,
 *    so the separation between two cells of one ship is exactly
 *    `CELL·(Δcol, Δrow)` and `dist = CELL·hypot(Δcol, Δrow)`. Any cell with
 *    `|Δcol| > ⌊radius/CELL⌋` or `|Δrow| > ⌊radius/CELL⌋` therefore has
 *    `dist ≥ radius` and is excluded by the caller's distance test regardless —
 *    so omitting it here changes nothing. The box is `(2k+1)²` cells, bounded by
 *    the radius, never by hull size: O(1) per blast rather than O(C).
 *  - **naive** (`cellIndex` undefined): scan and sort every cell on the ship.
 *
 * Both return the identical list (same members, same order), so the blast loop —
 * and the alive-set evolution it drives as cells die — is byte-identical either
 * way. The spatial path is a pure bound on the same computation.
 */
function collectBlastTargets(
  modules: readonly SimModule[],
  source: SimModule,
  radius: number,
  cellIndex: Map<number, SimModule> | undefined,
): SimModule[] {
  if (cellIndex === undefined) {
    return modules
      .filter((m) => m.alive && m !== source)
      .sort((a, b) => (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0));
  }
  // Cells farther than this many grid steps in either axis cannot be within the
  // blast radius (see the derivation above), so the box is the exact superset of
  // the reachable cells, bounded by the radius and not the hull.
  const k = Math.floor(radius / CELL_SIZE);
  const targets: SimModule[] = [];
  for (let dCol = -k; dCol <= k; dCol += 1) {
    for (let dRow = -k; dRow <= k; dRow += 1) {
      const cell = cellIndex.get(packCell(source.col + dCol, source.row + dRow));
      if (cell === undefined || !cell.alive || cell === source) continue;
      targets.push(cell);
    }
  }
  targets.sort((a, b) => (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0));
  return targets;
}
