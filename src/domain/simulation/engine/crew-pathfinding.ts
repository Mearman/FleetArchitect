/**
 * Crew pathfinding over a ship's alive-cell graph: A* over the resolved
 * cell set, the path/wiring/cell-index caches invalidated on topology change,
 * and the cell-key helpers shared with break-apart.
 */

import type { SimModule, SimShip } from "./types";
import { UNREACHABLE } from "./config";

/** Total order on cells by (col, row), used wherever crew or modules must be
 *  scanned in a fixed, RNG-free order. */
export function compareByCell(
  a: { col: number; row: number },
  b: { col: number; row: number },
): number {
  if (a.col !== b.col) return a.col - b.col;
  return a.row - b.row;
}

/** Canonical "col,row" cell key, matching the convention used by break-apart
 *  and the grid toolkit. */
export function crewCellKey(col: number, row: number): string {
  return `${col},${row}`;
}

/**
 * Encode a `(col, row)` cell as a single number for use as a cache key, avoiding
 * the per-lookup string allocation of the `"col,row"` form. Ship grid
 * coordinates are small integers (the design grid is tens of cells across), so
 * the encoding `col * CELL_KEY_STRIDE + row` is collision-free across the
 * practical range; the stride is wide enough that no two distinct cells share an
 * encoding for any realistic grid.
 */
export const CELL_KEY_STRIDE = 100000;

export function cellNum(col: number, row: number): number {
  return col * CELL_KEY_STRIDE + row;
}

/**
 * Rolling fingerprint of a ship's alive-cell topology: a count and a hash over
 * every alive cell's `(col, row)`. A pure function of the alive set, so an
 * unchanged topology yields an unchanged fingerprint and a topology change
 * (a module dies, a chunk splits off) moves it. Used to decide when the path
 * cache is stale: the fingerprint is recomputed at the top of `updateCrew` and
 * compared to the cached value; on a change the cache is cleared wholesale.
 *
 * The hash mixes each cell's coordinates with a positional multiplier so two
 * different sets never collide by accident (the count already differentiates
 * most, and the hash the rest). Deterministic: cells are visited in array order
 * but addition and XOR are commutative, so iteration order never affects the
 * result — only the set membership does.
 */
export function aliveCellFingerprint(ship: SimShip): number {
  if (ship.modules === undefined) return 0;
  let count = 0;
  let hash = 2166136261 >>> 0; // FNV-32 offset basis
  for (const m of ship.modules) {
    if (!m.alive) continue;
    count += 1;
    // Fold the cell coordinates into the running hash. Each coordinate is
    // shifted into its own bit band so (col,row) pairs are distinguished, not
    // just their sum.
    hash ^= (m.col + 0x9e3779b9) & 0xffffffff;
    hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (m.row + 0x85ebca6b) & 0xffffffff;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  // Combine count and hash into a single number; a change in either flips the
  // fingerprint. The count alone catches the common one-cell-death case fast.
  return count * 0x100000000 + hash;
}

/**
 * Invalidate the ship's path cache if the alive-cell topology has changed since
 * the cache was built. Called at the top of `updateCrew`, before any path
 * lookup, so a module destroyed this tick (its `alive` flag already flipped by
 * the damage phase and `recomputeAggregates`) is reflected before crew plan.
 * Cheap: a single pass over the module array to recompute the fingerprint, then
 * a comparison. On no change (the vast majority of ticks) nothing happens.
 */
export function refreshPathCache(ship: SimShip): void {
  if (ship.modules === undefined) return;
  const fingerprint = aliveCellFingerprint(ship);
  if (ship.topologyFingerprint !== fingerprint) {
    ship.pathCache = new Map();
    ship.wiringReach = undefined; // topology changed: wiring BFS is stale
    ship.aliveCells = undefined; // topology changed: cell index is stale
    ship.topologyFingerprint = fingerprint;
  } else if (ship.pathCache === undefined) {
    ship.pathCache = new Map();
  }
}

/**
 * Look up (or compute and cache) the crew path between two cells on a ship.
 * The cache is keyed by the directed `(from, to)` pair and invalidated wholesale
 * on any topology change (see `refreshPathCache`). On a cache hit this is an O(1)
 * map lookup; on a miss it runs the A* below and stores the result. The cached
 * array is returned by reference — callers copy via `pathIndex` offset rather
 * than `slice`, so the shared array is never mutated.
 *
 * Determinism: the cache is a pure memo of the A* over a fixed topology, so a
 * cached result is identical to a fresh one for the same `(from, to, topology)`.
 * The A* itself is deterministic (fixed tie-break, no RNG, no Map/Set iteration
 * order in any decision).
 */
export function findCrewPath(
  ship: SimShip,
  cells: ReadonlyMap<string, SimModule>,
  from: { col: number; row: number },
  to: { col: number; row: number },
): { col: number; row: number }[] | undefined {
  const cache = ship.pathCache;
  if (cache !== undefined) {
    const fromN = cellNum(from.col, from.row);
    const toN = cellNum(to.col, to.row);
    const inner = cache.get(fromN);
    if (inner !== undefined) {
      const cached = inner.get(toN);
      if (cached !== undefined) {
        return cached === UNREACHABLE ? undefined : cached;
      }
    }
    const path = computeCrewPathAStar(cells, from, to);
    if (inner !== undefined) {
      inner.set(toN, path ?? UNREACHABLE);
    } else {
      const fresh = new Map<number, { col: number; row: number }[] | typeof UNREACHABLE>();
      fresh.set(toN, path ?? UNREACHABLE);
      cache.set(fromN, fresh);
    }
    return path;
  }
  return computeCrewPathAStar(cells, from, to);
}

/**
 * Deterministic A* over a ship's alive cells, treating every alive module cell
 * as a walkable interior tile (crew stand on hull, modules, and floor alike).
 * Returns the path inclusive of both endpoints, or undefined when no 4-connected
 * route of alive cells links them.
 *
 * The engine works on its resolved cell set rather than a `TileGrid`, so this
 * mirrors `domain/grid.findPath` over that set: same Manhattan heuristic, same
 * fixed tie-break (lowest f, then lowest row, then lowest col) so two runs with
 * identical inputs yield byte-identical paths. No RNG, no Map/Set iteration
 * order dependence.
 *
 * The open set is a binary min-heap ordered by `(f, row, col)` — the same
 * comparator the old sorted array used — with lazy deletion for decrease-key
 * (a node rediscovered at a better f is pushed again; the stale entry is skipped
 * when it surfaces). This yields the identical expansion order as the old
 * O(n) sorted-array splice, at O(log n) per push, so a cache miss is no longer
 * quadratic in the open-set size.
 */
export function computeCrewPathAStar(
  cells: ReadonlyMap<string, SimModule>,
  from: { col: number; row: number },
  to: { col: number; row: number },
): { col: number; row: number }[] | undefined {
  const fromKey = crewCellKey(from.col, from.row);
  const toKey = crewCellKey(to.col, to.row);
  if (!cells.has(fromKey) || !cells.has(toKey)) return undefined;
  if (from.col === to.col && from.row === to.row) {
    return [{ col: from.col, row: from.row }];
  }

  const heuristic = (col: number, row: number): number =>
    Math.abs(col - to.col) + Math.abs(row - to.row);

  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, { col: number; row: number }>();
  gScore.set(fromKey, 0);

  // Binary min-heap of open entries, ordered by (f, row, col) — the same
  // tie-break the old sorted array enforced. Lazy deletion: a node rediscovered
  // at a better f is pushed again; the stale entry is filtered on pop by
  // comparing its f against the best-known gScore + heuristic.
  const heap: { col: number; row: number; f: number }[] = [
    { col: from.col, row: from.row, f: heuristic(from.col, from.row) },
  ];
  const closed = new Set<string>();

  /** Heap comparator: lowest f, then lowest row, then lowest col. */
  const better = (
    a: { f: number; row: number; col: number },
    b: { f: number; row: number; col: number },
  ): boolean => {
    if (a.f !== b.f) return a.f < b.f;
    if (a.row !== b.row) return a.row < b.row;
    return a.col < b.col;
  };

  const pushHeap = (entry: { col: number; row: number; f: number }): void => {
    heap.push(entry);
    let i = heap.length - 1;
    while (i > 0) {
      const parentIdx = (i - 1) >>> 1;
      const pe = heap[parentIdx];
      const ie = heap[i];
      if (pe === undefined || ie === undefined) break;
      if (better(ie, pe)) {
        heap[parentIdx] = ie;
        heap[i] = pe;
        i = parentIdx;
      } else break;
    }
  };

  const popHeap = (): { col: number; row: number; f: number } | undefined => {
    const top = heap[0];
    if (top === undefined) return undefined;
    const last = heap.pop();
    if (heap.length > 0 && last !== undefined) {
      heap[0] = last;
      let i = 0;
      const n = heap.length;
      for (;;) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        let best = i;
        const be = heap[i];
        if (be === undefined) break;
        if (left < n) {
          const le = heap[left];
          if (le !== undefined && better(le, be)) best = left;
        }
        if (right < n) {
          const re = heap[right];
          const bestE = heap[best];
          if (re !== undefined && bestE !== undefined && better(re, bestE)) best = right;
        }
        if (best === i) break;
        const a = heap[best];
        const b = heap[i];
        if (a === undefined || b === undefined) break;
        heap[best] = b;
        heap[i] = a;
        i = best;
      }
    }
    return top;
  };

  for (;;) {
    const current = popHeap();
    if (current === undefined) break;
    const currentKey = crewCellKey(current.col, current.row);
    if (closed.has(currentKey)) continue; // stale re-discovery: skip
    closed.add(currentKey);

    if (current.col === to.col && current.row === to.row) {
      const path: { col: number; row: number }[] = [
        { col: current.col, row: current.row },
      ];
      let key = currentKey;
      for (;;) {
        const prev = cameFrom.get(key);
        if (prev === undefined) break;
        path.unshift({ col: prev.col, row: prev.row });
        key = crewCellKey(prev.col, prev.row);
      }
      return path;
    }

    const currentG = gScore.get(currentKey) ?? Infinity;
    // Visit the four edge neighbours in a fixed order; the tie-break in the open
    // set makes the chosen path canonical regardless of insertion order here.
    const candidates = [
      { col: current.col - 1, row: current.row },
      { col: current.col + 1, row: current.row },
      { col: current.col, row: current.row - 1 },
      { col: current.col, row: current.row + 1 },
    ];
    for (const n of candidates) {
      const nKey = crewCellKey(n.col, n.row);
      if (!cells.has(nKey)) continue; // not a walkable alive cell
      if (closed.has(nKey)) continue; // already finalised
      const tentativeG = currentG + 1;
      if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, { col: current.col, row: current.row });
        gScore.set(nKey, tentativeG);
        pushHeap({ col: n.col, row: n.row, f: tentativeG + heuristic(n.col, n.row) });
      }
    }
  }
  return undefined;
}

/**
 * Index a ship's alive modules by their integer cell key. This is the walkable
 * graph crew path over and the lookup used to find which module (if any) sits on
 * a given cell.
 */
export function aliveCellMap(ship: SimShip): Map<string, SimModule> {
  const map = new Map<string, SimModule>();
  if (ship.modules === undefined) return map;
  for (const m of ship.modules) {
    if (m.alive) map.set(crewCellKey(m.col, m.row), m);
  }
  return map;
}
