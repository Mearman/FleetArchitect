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
 * Cross-ship blast (Phase 5): after the within-ship chain is processed, each
 * detonation also deals radial falloff damage to every other alive ship whose
 * bounding disc overlaps the blast sphere. Other ships are hit as an omnidirectional
 * blast at their centre — no shieldPiercing/armourPiercing — using the same linear
 * falloff formula. Iteration order over other ships is lexicographic by instanceId
 * for determinism.
 *
 * Determinism: the work queue is tick-local (built fresh here, never persisted)
 * and always drained in ascending `slotId` order, and each volatile module
 * carries an `exploded` flag so it detonates exactly once across the whole
 * battle however many ticks the chain spans. With no volatile deaths the queue
 * is empty and the function is a no-op, so a battle that never loses a reactor or
 * magazine is byte-identical to before.
 *
 * @param ship      The ship whose volatile modules are being processed.
 * @param allShips  All currently alive ships in the battle (including `ship`
 *                  itself; this function skips the source ship automatically).
 */
export function resolveChainReactions(ship: SimShip, allShips: readonly SimShip[]): void {
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

  // Sort other ships by instanceId once so every detonation iterates them in
  // the same deterministic order without re-sorting per blast.
  const otherShips = allShips
    .filter((s) => s !== ship && s.alive)
    .sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));

  while (pending.length > 0) {
    for (const source of pending) {
      // Mark spent before applying the blast so a cell can never re-enter the
      // queue, even if its own blast somehow reached back to it.
      source.exploded = true;
      detonate(ship, source, cellIndex, otherShips);
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
 * Apply a single volatile module's blast to the rest of its ship and to any
 * other alive ships whose bounding disc overlaps the blast sphere.
 *
 * Within-ship: each alive module within `SIM.chainReaction.radius` of the
 * source cell takes damage that falls off linearly with distance — full yield
 * at the centre, zero at the radius — routed through `applyDamage` aimed at
 * that target cell's world position (so the pipeline's nearest-cell selection
 * lands the hit on it). The blast pierces shields and armour because it goes
 * off inside the hull.
 *
 * Cross-ship: for each other ship whose bounding disc overlaps the blast sphere
 * (`distance(blastCentre, ship.centre) - ship.radius < blastRadius`), the
 * effective damage is computed at the other ship's centre using the same linear
 * falloff formula, then applied via `applyDamage` as an omnidirectional hit
 * (no shieldPiercing/armourPiercing — the blast has to traverse hull plating to
 * reach the other ship). Ships are iterated in lexicographic instanceId order
 * (pre-sorted by the caller) for determinism.
 *
 * Targets on the source ship are processed in ascending `slotId` order so the
 * chain is deterministic regardless of array layout.
 */
/**
 * Compute the cumulative wall/door attenuation factor for the blast wave
 * travelling from `source` to `target` along the dominant-axis (DDA) grid
 * path. Each edge crossed on that path multiplies the surviving fraction by
 * `SIM.wallBlastAttenuation` (wall), `SIM.doorBlastAttenuation` (closed
 * door), or `SIM.doorOpenBlastAttenuation` (open door). A factor below 0.001
 * is clamped to zero — effectively no blast reaches the target.
 *
 * The DDA path steps one cell at a time along the dominant axis, preferring
 * horizontal motion on a tie, and checks the edge of the current cell in the
 * direction of the next step before advancing. This matches the grid topology:
 * the edge "between" two adjacent cells lives on the source-side cell.
 */
function blastAttenuationFactor(
  source: SimModule,
  target: SimModule,
  cellIndex: Map<number, SimModule>,
): number {
  let factor = 1.0;
  let col = source.col;
  let row = source.row;

  while (col !== target.col || row !== target.row) {
    const dCol = target.col - col;
    const dRow = target.row - row;
    // Prefer horizontal movement on a tie so the DDA is deterministic.
    const useHoriz = Math.abs(dCol) >= Math.abs(dRow);
    let dir: "n" | "e" | "s" | "w";
    let nextCol = col;
    let nextRow = row;
    if (useHoriz) {
      if (dCol > 0) { dir = "e"; nextCol = col + 1; }
      else           { dir = "w"; nextCol = col - 1; }
    } else {
      if (dRow > 0) { dir = "s"; nextRow = row + 1; }
      else           { dir = "n"; nextRow = row - 1; }
    }
    // Check the edge on the CURRENT cell in the direction we are about to cross.
    const cell = cellIndex.get(packCell(col, row));
    if (cell !== undefined) {
      const edgeKind = cell.edges[dir];
      if (edgeKind === "wall") {
        factor *= SIM.wallBlastAttenuation;
      } else if (edgeKind === "door") {
        const doorState = cell.edges.doorStates[dir];
        factor *= doorState === "open" ? SIM.doorOpenBlastAttenuation : SIM.doorBlastAttenuation;
      }
    }
    if (factor < 0.001) return 0;
    col = nextCol;
    row = nextRow;
  }
  return factor;
}

function detonate(
  ship: SimShip,
  source: SimModule,
  cellIndex: Map<number, SimModule> | undefined,
  otherShips: readonly SimShip[],
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
    // Wall / door blast attenuation: multiply the damage by the fraction of the
    // wave that survives the edges between the source and target cells. When no
    // cellIndex was built (the naive path) attenuation is skipped (factor = 1),
    // keeping the naive and spatial paths byte-identical in the no-cellIndex case.
    const attenuation = cellIndex !== undefined
      ? blastAttenuationFactor(source, target, cellIndex)
      : 1.0;
    const damage = yieldAmount * falloff * attenuation;
    if (damage <= 0) continue;
    // The target cell's world position so applyDamage's nearest-cell selection
    // lands the hit on it. Internal blast: pierce shields and armour fully.
    const world = localPointToWorld(ship, target.x, target.y);
    applyDamage(ship, damage, 1, 1, world.x, world.y);
  }

  // Cross-ship blast: the explosion's world-space centre (the exploding cell's
  // local position rotated into world space).
  const blastWorld = localPointToWorld(ship, source.x, source.y);

  for (const other of otherShips) {
    // Distance from the blast centre to the other ship's centre.
    const distToCenter = Math.hypot(other.x - blastWorld.x, other.y - blastWorld.y);
    // The blast overlaps the other ship's bounding disc if the nearest point of
    // that disc is closer than the blast radius.
    if (distToCenter - other.radius >= radius) continue;
    // Use the distance to the ship's centre for the falloff calculation: a ship
    // whose centre is within the blast radius takes full-to-zero falloff damage;
    // a ship that only clips the blast edge with its disc takes the damage
    // corresponding to its centre distance (possibly zero if the centre is beyond
    // the radius, but the disc overlap guarantees some cells are within it).
    if (distToCenter >= radius) continue;
    const falloff = 1 - distToCenter / radius;
    const damage = yieldAmount * falloff;
    if (damage <= 0) continue;
    // Omnidirectional external blast: no shield or armour piercing. No impact
    // point specified so applyDamage routes the hit through the nearest-alive
    // module heuristic, appropriate for an undirected shockwave.
    applyDamage(other, damage, 0, 0);
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
