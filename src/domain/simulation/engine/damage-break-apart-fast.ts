/**
 * Fast array-indexed union-find core for break-apart, byte-identical to the
 * Map-based `analyseBreakApart` in `./damage`. Production (`splitBreakApart`)
 * calls this; the Map-based reference stays for the equivalence test in
 * `engine.breakaway.unit.test.ts`.
 *
 * The optimisation replaces the per-call Map allocations (a `Map<SimModule,
 * SimModule>` parent table and a `Map<string, SimModule>` cell lookup, both
 * rebuilt every death-tick) with flat integer-indexed structures: a `number[]`
 * parent table indexed by position in `alive`, a `Set<number>` for the
 * full-module grid-adjacency guard, and a `Map<number, number>` mapping cell
 * key to alive index. Object identity is replaced by alive-index identity,
 * which is a bijection within a single call (each alive module occupies
 * exactly one index).
 *
 * Numeric cell keys: cells are encoded as `col * K + row` where
 * `K = rowSpan + 2` and `rowSpan = maxRow - minRow`. This is collision-free
 * for all probes this function makes. Two cells (c1,r1),(c2,r2) collide iff
 * `(c1-c2)*K = r2-r1`. Inserted (in-grid) cells have rows in `[minRow,
 * maxRow]`; probed cells (±1 neighbours) have rows in `[minRow-1, maxRow+1]`
 * (span `rowSpan+2`). The maximum row difference between an in-grid cell and
 * any probe is `rowSpan+1 < K`, so an in-grid cell never collides with a
 * probe of a differing column; same-column collisions imply same-row (same
 * cell). The only collisions K permits are between two probes (rows
 * `minRow-1` and `maxRow+1`, columns differing by 1) — neither is inserted,
 * so `.has`/`.get` stay correct.
 *
 * Byte-identical-frame reasoning: connected components, the survivor, and the
 * chunks are graph-properties — independent of the union-find data structure
 * or union order. The only ordering requirement is chunk-emission order
 * (first-root-appearance in `alive` iteration), which the index-based grouping
 * preserves by construction: components are grouped by iterating `alive` in
 * order, finding each index's root, and appending to that root's index-list,
 * creating entries in encounter order — the same order the Map reference
 * builds its component lists. Survivor selection (largest list; ties broken
 * by `alive[list[0]].slotId` smallest) is index-identity-independent, matching
 * the Map reference's root-slotId tiebreak. Chunk ids come from the same
 * monotonic `nextChunkId` over the same component-emission order, and the
 * downstream chunk building, crew partitioning, module marking, and survivor
 * momentum split operate on the same module objects via `alive[idx]`.
 */

import type { SimCrew } from "../types";

import { resetCrewForFragment } from "./crew";
import { applyMomentumSplitToSurvivor, makeChunkShip } from "./damage";
import type { SimModule, SimShip } from "./types";

export function analyseBreakApartFast(
  ship: SimShip,
  currentTick: number,
  nextChunkId: (parentId: string, tick: number) => string,
): SimShip[] {
  if (ship.modules === undefined) return [];

  const alive: SimModule[] = ship.modules.filter((m) => m.alive);
  const n = alive.length;
  if (n === 0) return [];

  // Grid-adjacency guard: at least one pair of cells (alive or dead) shares a
  // grid edge. Only `.has` is needed, so a Set replaces the Map reference.
  // Fold the row-bounds pass into the same loop so the numeric cell-key K
  // (which depends on rowSpan) is available without a second scan.
  // Row bounds: needed to compute K before any cell can be encoded. A
  // separate tight pass over rows is cheaper than encoding twice.
  let minRow = Number.POSITIVE_INFINITY;
  let maxRow = Number.NEGATIVE_INFINITY;
  for (const m of ship.modules) {
    if (m.row < minRow) minRow = m.row;
    if (m.row > maxRow) maxRow = m.row;
  }
  // K = rowSpan + 2. See the collision-freeness argument in the header.
  const rowSpan = maxRow - minRow;
  const K = rowSpan + 2;
  const encode = (col: number, row: number): number => col * K + row;
  const allCells = new Set<number>();
  for (const m of ship.modules) allCells.add(encode(m.col, m.row));
  let hasGridAdjacency = false;
  for (const m of ship.modules) {
    if (
      allCells.has(encode(m.col - 1, m.row)) ||
      allCells.has(encode(m.col + 1, m.row)) ||
      allCells.has(encode(m.col, m.row - 1)) ||
      allCells.has(encode(m.col, m.row + 1))
    ) {
      hasGridAdjacency = true;
      break;
    }
  }
  if (!hasGridAdjacency) return [];

  // Union-find over alive indices: parent[i] = i initially. The array is
  // fully initialised for every index in [0, n), so the indexed access always
  // hits a defined entry; the explicit undefined check narrows for
  // noUncheckedIndexedAccess rather than acting as a runtime fallback.
  const parent: number[] = new Array<number>(n);
  for (let i = 0; i < n; i += 1) parent[i] = i;
  const find = (i: number): number => {
    let root = i;
    let next = parent[root];
    while (next !== undefined && next !== root) {
      root = next;
      next = parent[root];
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  // Map each alive cell key to its alive index. Cells are unique per grid
  // position, so one index per (col, row).
  const byCell = new Map<number, number>();
  for (let i = 0; i < n; i += 1) {
    const m = alive[i];
    if (m === undefined) continue;
    byCell.set(encode(m.col, m.row), i);
  }

  // 4-connected adjacency: union each alive index with its alive
  // edge-neighbours. Same neighbour lookup as the Map reference.
  for (let i = 0; i < n; i += 1) {
    const m = alive[i];
    if (m === undefined) continue;
    const neighbours = [
      byCell.get(encode(m.col - 1, m.row)),
      byCell.get(encode(m.col + 1, m.row)),
      byCell.get(encode(m.col, m.row - 1)),
      byCell.get(encode(m.col, m.row + 1)),
    ];
    for (const ni of neighbours) {
      if (ni !== undefined) union(i, ni);
    }
  }

  // Group alive indices by root, preserving first-root-appearance order
  // (iterate alive in order, find root, append to that root's index list,
  // creating entries in encounter order). This preserves chunk-emission order.
  const componentRoots: number[] = [];
  const componentIndices: number[][] = [];
  const rootToListIndex = new Map<number, number>();
  for (let i = 0; i < n; i += 1) {
    const r = find(i);
    let listIndex = rootToListIndex.get(r);
    if (listIndex === undefined) {
      listIndex = componentRoots.length;
      rootToListIndex.set(r, listIndex);
      componentRoots.push(r);
      componentIndices.push([i]);
    } else {
      const list = componentIndices[listIndex];
      if (list === undefined) continue;
      list.push(i);
    }
  }
  if (componentRoots.length <= 1) return [];

  // Resolve each component's alive-index list back to module lists, in
  // encounter order. These are the same module objects the Map reference
  // groups, accessed in the same order.
  const components: SimModule[][] = componentIndices.map((indices) =>
    indices.map((idx) => {
      const mod = alive[idx];
      if (mod === undefined) throw new Error("alive index out of range");
      return mod;
    }),
  );

  // Survivor selection: largest list; ties broken by list[0].slotId smallest.
  // Identical to the Map reference's root-slotId tiebreak (the root of a
  // component's list is its first-appearance module, i.e. alive[list[0]]).
  let survivorModules: SimModule[] = [];
  let survivorListIndex = -1;
  for (let li = 0; li < components.length; li += 1) {
    const list = components[li];
    if (list === undefined) continue;
    if (
      list.length > survivorModules.length ||
      (list.length === survivorModules.length &&
        survivorListIndex !== -1 &&
        list[0] !== undefined &&
        survivorModules[0] !== undefined &&
        survivorModules[0].slotId > list[0].slotId)
    ) {
      survivorModules = list;
      survivorListIndex = li;
    }
  }
  if (survivorListIndex === -1) return [];

  // From here onward the logic is identical to the Map reference: snapshot
  // the parent's pre-split state, partition crew by component, build chunk
  // ships, mark migrated modules dead, reset crew, and apply the survivor's
  // momentum split. All operate on the same module objects via the resolved
  // component lists.
  const parentComX = ship.comX;
  const parentComY = ship.comY;
  const parentVelX = ship.velX;
  const parentVelY = ship.velY;

  const componentOfCell = new Map<number, SimModule[]>();
  for (const list of components) {
    for (const m of list) componentOfCell.set(encode(m.col, m.row), list);
  }
  const crewOfComponent = new Map<SimModule[], SimCrew[]>();
  const parentCrew = ship.crew ?? [];
  for (const c of parentCrew) {
    const list = componentOfCell.get(encode(c.col, c.row));
    if (list === undefined) continue;
    const bucket = crewOfComponent.get(list);
    if (bucket === undefined) crewOfComponent.set(list, [c]);
    else bucket.push(c);
  }

  const survivorSet = new Set(survivorModules);
  const chunks: SimShip[] = [];
  for (const list of components) {
    if (list === survivorModules) continue;
    const chunkCrew = crewOfComponent.get(list) ?? [];
    const chunk = makeChunkShip(ship, list, chunkCrew, nextChunkId(ship.instanceId, currentTick));
    chunks.push(chunk);
    for (const m of list) {
      if (!survivorSet.has(m)) {
        m.alive = false;
        m.surfaceHp = 0;
        m.hp = 0;
      }
    }
  }

  ship.crew = crewOfComponent.get(survivorModules) ?? [];
  for (const chunk of chunks) {
    if (chunk.crew === undefined) continue;
    for (const c of chunk.crew) resetCrewForFragment(c);
  }
  for (const c of ship.crew) resetCrewForFragment(c);

  applyMomentumSplitToSurvivor(
    ship,
    survivorModules,
    parentComX,
    parentComY,
    parentVelX,
    parentVelY,
  );
  return chunks;
}
