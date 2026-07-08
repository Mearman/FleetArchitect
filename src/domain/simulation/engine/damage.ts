/**
 * Damage application: structure/shield/module damage, reactive armour, the
 * directional-shield lookup, nearest-alive-module hit selection, and the
 * break-apart chunk logic.
 */

import type { SimCrew } from "../types";

import { computeChunkOutline, computeChunkRenderOutline } from "./chunk-outline";
import { analyseBreakApartFast } from "./damage-break-apart-fast";
import { defaultAiDecisions } from "./ai-step";
import { aliveDirectionalShields } from "./directional-shield-cache";
import { SIM } from "./config";
import { resetCrewForFragment } from "./crew";
import { recomputeAggregatesWithScaling } from "./effect-scaling";
import { comTangentialVelocity, localCentreOfMass } from "./physics";
import { buildTechCaches } from "./tech";
import { angleDifference, normaliseAngle, worldToLocal } from "./setup";
import type { SimModule, SimShip } from "./types";

/**
 * Per-module damage.
 *
 * A directional shield module whose arc covers the shot direction always
 * intercepts first (using its own HP as the shield pool); if it is destroyed,
 * the leftover spills onward.
 *
 * The structural hit then resolves one of two ways:
 *  - **cell path** (projectile-vs-cell): when `path` is supplied, the shot
 *    strikes the frontmost cell it passed through and any overflow carries to
 *    the next cell behind along the travel direction, in order, until the
 *    damage is spent or the path is exhausted. This is the exact cell hit the
 *    broad-phase resolved, not a Euclidean nearest guess.
 *  - **nearest fallback** (hitscan / no path): the shot strikes the nearest
 *    alive module to the impact point and spills to the next nearest.
 *
 * In both cases, overflow past the last available module falls through to the
 * hull structure, armour-reduced. A ship with no alive modules takes the full
 * amount to structure.
 */
export function applyModuleDamage(
  ship: SimShip,
  amount: number,
  armourPiercing: number,
  impactX?: number,
  impactY?: number,
  shotAngle?: number,
  path?: readonly SimModule[],
  eFrac = 1,
  pFrac = 1,
): void {
  // Transform the world-space impact point into ship-local (design)
  // coordinates so it lines up with module.x/module.y.
  const local = worldToLocal(ship, impactX, impactY);

  // A directional shield covering the shot intercepts before any structural
  // cell is touched, regardless of which routing the structure uses.
  let remaining = amount;
  const shield = directionalShieldFor(ship, shotAngle);
  if (shield !== undefined) {
    shield.hp -= remaining;
    if (shield.hp > 0) return; // shield absorbed the whole hit
    remaining = -shield.hp;
    shield.hp = 0;
    shield.alive = false;
  }

  if (path !== undefined) {
    // Cell-path penetration: spill through the resolved cells in order. Skip
    // the intercepting shield if it appears in the path (already resolved).
    for (let i = 0; i < path.length; i += 1) {
      if (remaining <= 0) return;
      const cell = path[i];
      if (cell === undefined) continue;
      if (!cell.alive || cell === shield) continue;
      // Wall / door edge stopping: before the projectile enters this cell, check
      // the edge on the previous cell in the direction of travel. An edge that is
      // grid-adjacent (|dCol| + |dRow| === 1) and carries a wall or closed door
      // absorbs stopping energy from the round. A gap (non-adjacent cells in the
      // path) means open space — no edge to check.
      if (i > 0) {
        const prev = path[i - 1];
        if (prev !== undefined) {
          const dCol = cell.col - prev.col;
          const dRow = cell.row - prev.row;
          if (Math.abs(dCol) + Math.abs(dRow) === 1) {
            let dir: "n" | "e" | "s" | "w";
            if (dCol === 1)       dir = "e";
            else if (dCol === -1) dir = "w";
            else if (dRow === 1)  dir = "s";
            else                  dir = "n";
            const edgeKind = prev.edges[dir];
            if (edgeKind === "wall") {
              remaining -= SIM.wallStopping;
              if (remaining <= 0) return;
            } else if (edgeKind === "door") {
              const doorState = prev.edges.doorStates[dir];
              if (doorState !== "open") {
                remaining -= SIM.doorStopping;
                if (remaining <= 0) return;
              }
            }
          }
        }
      }
      remaining = damageCell(cell, remaining, armourPiercing, eFrac, pFrac);
      if (remaining <= 0) return; // this cell absorbed the rest
    }
    // Overflow past the last cell on the path falls to the hull structure.
    if (remaining > 0) spillToStructure(ship, remaining, armourPiercing);
    return;
  }

  // Nearest-alive fallback (hitscan / legacy, or any no-path impact). The prior
  // loop re-ran nearestAliveModule per overflow step, re-scanning the whole
  // module array each time (O(K x M) for a hit spilling through K modules).
  // damageCell only mutates the cell it is passed, so no module other than the
  // one being damaged flips alive mid-call; the alive set captured once is
  // stable and can be walked in selection order without a rescan per step.
  if (ship.modules !== undefined) {
    if (local === undefined) {
      // No impact point: nearestAliveModule returns the first alive module in
      // array order, so a single in-order walk (skipping dead) reproduces the
      // exact selection the old repeated rescan produced.
      for (const m of ship.modules) {
        if (remaining <= 0) return;
        if (!m.alive) continue;
        remaining = damageCell(m, remaining, armourPiercing, eFrac, pFrac);
      }
    } else {
      // First target via one linear scan, so a hit absorbed by the nearest
      // module pays no sort. Only when it spills onward do we materialise the
      // distance order once and advance along it, replacing the per-step rescan.
      const target = nearestAliveModule(ship, local);
      if (target !== undefined) {
        remaining = damageCell(target, remaining, armourPiercing, eFrac, pFrac);
        if (remaining > 0) {
          for (const m of aliveModulesByDistance(ship.modules, local)) {
            if (remaining <= 0) return;
            remaining = damageCell(m, remaining, armourPiercing, eFrac, pFrac);
          }
        }
      }
    }
  }
  if (remaining > 0) spillToStructure(ship, remaining, armourPiercing);
}

/** Apply damage to a cell via two streams meeting at the substrate, returning
 *  the leftover that spills onward. `eFrac`/`pFrac` are the hit's energy/momentum
 *  split (default 1/1): energy ablates the passive coating (`surfaceHp`), momentum
 *  depletes the finite reactive plate (`reactiveHp`); both overflow to substrate. */
function damageCell(cell: SimModule, amount: number, armourPiercing: number, eFrac = 1, pFrac = 1): number {
  const pierce = 1 - armourPiercing;
  const ePart = amount * eFrac; // energy stream
  const pPart = amount * pFrac; // momentum stream
  let overflow = 0;

  // Energy → ablative surface coating (ePart is the energy fraction; surfaceReduction is not re-scaled by eFrac).
  if (ePart > 0) {
    if (cell.surfaceHp > 0) {
      const sRed = Math.min(cell.surfaceReduction * pierce, 1);
      cell.surfaceHp -= ePart * (1 - sRed);
      if (cell.surfaceHp <= 0) {
        overflow += -cell.surfaceHp;
        cell.surfaceHp = 0;
        if (cell.surface === "armor") cell.surface = "bare";
      }
    } else {
      overflow += ePart;
    }
  }

  // Momentum → finite reactive plate; emptying it arms the cooldown.
  if (pPart > 0) {
    if (cell.reactiveHp > 0) {
      const cancel = Math.min(pPart * Math.min(cell.reactiveReduction * pierce, 1), cell.reactiveHp);
      cell.reactiveHp -= cancel;
      if (cell.reactiveHp === 0) cell.reactiveCharge = cell.reactiveWindow;
      overflow += pPart - cancel;
    } else {
      overflow += pPart;
    }
  }

  cell.hp -= overflow;
  if (cell.hp > 0) return 0;
  const spill = -cell.hp;
  cell.hp = 0;
  cell.alive = false;
  return spill;
}

/** Apply leftover structural damage to the hull, armour-reduced, and kill the
 *  ship if its integrity runs out. */
export function spillToStructure(ship: SimShip, amount: number, armourPiercing: number): void {
  const reduction = ship.armourReduction * (1 - armourPiercing);
  ship.structure -= amount * (1 - reduction);
  if (ship.structure <= 0) {
    ship.structure = 0;
    ship.alive = false;
  }
}

/**
 * The alive directional shield module whose arc covers `shotAngle`, or
 * undefined if none does. Each shield's coverage is a cone centred on
 * `shieldFacing` with half-arc `shieldArc/2`; an omnidirectional shield
 * (arc ≥ 2π) is handled by the pooled shield, not here. `shotAngle` is in
 * world coordinates, so it is rotated into the ship's local frame before the
 * arc test. When two shields cover the shot the one with the most remaining
 * HP intercepts, so a pair of front shields share hits rather than the first
 * being chewed apart.
 *
 * The candidate set is cached per ship against the aggregates fingerprint (see
 * `./directional-shield-cache`); the per-hit `m.hp` read stays live, so a shield
 * that already absorbed part of a prior hit this tick still contributes its
 * reduced HP to the max-of-HP selection — byte-identical to a per-hit full
 * module scan.
 */
export function directionalShieldFor(
  ship: SimShip,
  shotAngle: number | undefined,
): SimModule | undefined {
  if (ship.modules === undefined || shotAngle === undefined) return undefined;
  const localShot = normaliseAngle(shotAngle - ship.facing);
  let candidate: SimModule | undefined;
  let bestScore = -Infinity;
  for (const m of aliveDirectionalShields(ship)) {
    const halfArc = m.shieldArc / 2;
    const offset = Math.abs(angleDifference(m.shieldFacing, localShot));
    if (offset > halfArc) continue; // shot is outside this shield's arc
    if (m.hp > bestScore) {
      bestScore = m.hp;
      candidate = m;
    }
  }
  return candidate;
}

/** The alive module whose cell is nearest the given local point (or the
 *  first alive module in array order when there's no impact point). Used for the
 *  first target of a no-path impact; the subsequent overflow walk is handled by
 *  `aliveModulesByDistance`, which materialises the distance order once instead
 *  of re-scanning per step. Iterates `ship.modules` in place rather than
 *  allocating a filtered copy; the strict `<` comparison preserves the original
 *  "first wins" tie-break on equal distances (same array order, same module). */
export function nearestAliveModule(
  ship: SimShip,
  local: { x: number; y: number } | undefined,
): SimModule | undefined {
  if (ship.modules === undefined) return undefined;
  if (local === undefined) {
    for (const m of ship.modules) {
      if (m.alive) return m;
    }
    return undefined;
  }
  let best: SimModule | undefined;
  let bestDist = Infinity;
  for (const m of ship.modules) {
    if (!m.alive) continue;
    const d = (m.x - local.x) ** 2 + (m.y - local.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best;
}

/** The currently-alive modules ordered by squared distance to `local`, with
 *  ties broken by original array order. Materialised once per spilling no-path
 *  impact so the overflow walk advances along the same selection order that
 *  repeated `nearestAliveModule` calls would have produced, without re-scanning
 *  every module per step. The explicit `<`/`>` comparator matches
 *  `nearestAliveModule`'s strict-< "first wins" behaviour exactly, and
 *  `Array.prototype.sort`'s stability (ES2019) preserves array order on equal
 *  distances — so the order is byte-identical to the prior per-step rescan. */
function aliveModulesByDistance(
  modules: readonly SimModule[],
  local: { x: number; y: number },
): SimModule[] {
  const alive: SimModule[] = [];
  for (const m of modules) {
    if (m.alive) alive.push(m);
  }
  alive.sort((a, b) => {
    const da = (a.x - local.x) ** 2 + (a.y - local.y) ** 2;
    const db = (b.x - local.x) ** 2 + (b.y - local.y) ** 2;
    if (da < db) return -1;
    if (da > db) return 1;
    return 0;
  });
  return alive;
}

/**
 * Break-apart: when the alive modules on a modular ship no longer form a
 * single 4-connected graph (sharing a grid edge between adjacent cells),
 * each disconnected component becomes its own rigid body. The largest
 * component stays with the original SimShip (keeping its `instanceId` and
 * side); every smaller component is split off as a fresh SimShip with a
 * fresh id, inheriting the parent's velocity.
 *
 * Connectivity is defined purely on alive modules — dead modules are gone
 * for all purposes including graph connectivity. A non-modular ship (no
 * `modules` array) never splits: the legacy aggregated path stays whole.
 *
 * Two parallel implementations share the analysis core (`analyseBreakApart`):
 *  - `splitBreakApartReference`: the oracle. It always runs the full analysis,
 *    the naive path used only to prove the optimisation is behaviour-preserving.
 *  - `splitBreakApart`: the production path. It skips the analysis when the
 *    ship's alive-module count is unchanged since the last evaluation.
 *
 * Byte-identical-frame reasoning for the production skip: the engine only ever
 * flips a module's `alive` flag from true to false (verified: no path sets it
 * back to true), so `aliveCount` is monotonically non-increasing within a
 * ship's lifetime. Therefore `aliveCount` unchanged ⟺ no module died ⟺ the
 * alive set is unchanged ⟺ the connectivity graph is unchanged ⟺ the full
 * analysis also yields no split, and skipping it returns the same `[]` the
 * analysis would have. When the count changed, the production path runs the
 * identical analysis. On checkpoint resume the marker
 * (`breakApartLastAliveCount`) is `undefined` (it is not captured — see
 * `src/schema/checkpoint.ts`), so the first resumed tick fails the equality
 * test and analyses; on an unchanged topology that analysis returns `[]`
 * exactly as a skip would, so resumed frames are byte-identical to non-resumed
 * ones.
 *
 * The split happens at most once per ship per tick. After splitting, the
 * original ship's modules array is mutated so that every module belonging
 * to a non-primary component is marked `alive: false`. The chunk SimShips
 * carry their own copies of those modules (alive: true), re-derived
 * aggregates, and a fresh instanceId from `nextChunkId`.
 */

/**
 * The shared analysis core: the current post-guard logic verbatim, minus the
 * topology-marker reads/writes (the marker is owned by the caller, not the
 * analysis). Returns the new chunk ships (empty when no split happens); the
 * caller decides whether to even call it. Mutates `ship` exactly as the
 * original `splitBreakApart` did: migrated modules flip to dead, crew is
 * repartitioned, and the survivor's momentum split is applied.
 */
function analyseBreakApart(
  ship: SimShip,
  currentTick: number,
  nextChunkId: (parentId: string, tick: number) => string,
): SimShip[] {
  if (ship.modules === undefined) return [];

  const alive = ship.modules.filter((m) => m.alive);
  if (alive.length === 0) return [];
  // Every solid cell is substrate-anchored by definition (substrate is the
  // structural connectivity base of every built cell), so break-apart runs on
  // every modular ship — the previous hull-anchor gate is gone, since under
  // the layered-cell model there is no separate "hull cell" kind to gate on;
  // the substrate itself is the anchor.
  //
  // The one remaining guard: the ship must actually be a grid (at least one
  // pair of cells shares a grid edge). Synthetic fixtures that place modules
  // at non-adjacent positions bypass the grid entirely and have no graph to
  // split; a real design always has at least one edge-adjacency because cells
  // come from a `TileGrid`. We check the full module set (including destroyed
  // cells) so a ship whose only bridge cell just died still qualifies — the
  // split it is about to undergo is the very reason break-apart exists.
  const allByCell = new Map<string, SimModule>();
  for (const m of ship.modules) allByCell.set(`${m.col},${m.row}`, m);
  let hasGridAdjacency = false;
  for (const m of ship.modules) {
    if (
      allByCell.has(`${m.col - 1},${m.row}`) ||
      allByCell.has(`${m.col + 1},${m.row}`) ||
      allByCell.has(`${m.col},${m.row - 1}`) ||
      allByCell.has(`${m.col},${m.row + 1}`)
    ) {
      hasGridAdjacency = true;
      break;
    }
  }
  if (!hasGridAdjacency) {
    // Not a grid: it never splits at this topology.
    return [];
  }

  // Union-Find over alive modules, grouped by exact 4-connected (edge-sharing)
  // grid adjacency. Only alive modules are nodes: a destroyed hull cell no
  // longer bridges its neighbours, so the graph can split apart when an anchor
  // cell dies. Non-modular ships (no `modules` array) never split; the legacy
  // aggregated path stays whole.
  const parent = new Map<SimModule, SimModule>();
  for (const m of alive) parent.set(m, m);
  const find = (m: SimModule): SimModule => {
    let root = m;
    while (parent.get(root) !== root) {
      const next = parent.get(root);
      if (next === undefined) break;
      root = next;
    }
    return root;
  };
  const union = (a: SimModule, b: SimModule): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Index alive modules by their integer cell so each cell can find its four
  // edge neighbours in O(1). Cells are unique per grid position, so the map is
  // one module per (col, row).
  const cellKey = (col: number, row: number): string => `${col},${row}`;
  const byCell = new Map<string, SimModule>();
  for (const m of alive) byCell.set(cellKey(m.col, m.row), m);

  // 4-connected adjacency: a cell unions with the alive module directly above,
  // below, left, and right of it. Diagonal cells are NOT connected — the
  // structural "bolted together" test is a shared edge, not a shared corner.
  for (const m of alive) {
    const edgeNeighbours = [
      byCell.get(cellKey(m.col - 1, m.row)),
      byCell.get(cellKey(m.col + 1, m.row)),
      byCell.get(cellKey(m.col, m.row - 1)),
      byCell.get(cellKey(m.col, m.row + 1)),
    ];
    for (const n of edgeNeighbours) {
      if (n !== undefined) {
        union(m, n);
      }
    }
  }

  // Group alive modules by their component root.
  const components = new Map<SimModule, SimModule[]>();
  for (const m of alive) {
    const r = find(m);
    const list = components.get(r);
    if (list === undefined) components.set(r, [m]);
    else list.push(m);
  }
  if (components.size <= 1) {
    // Connected: a single component, no split.
    return [];
  }


  // Pick the largest component as the survivor. Ties broken by string
  // comparison on the root slotId so the choice is fully deterministic.
  let survivorRoot: SimModule | undefined;
  let survivorModules: SimModule[] = [];
  for (const [, list] of components) {
    if (
      list.length > survivorModules.length ||
      (list.length === survivorModules.length &&
        survivorRoot !== undefined &&
        list[0] !== undefined &&
        survivorRoot.slotId > list[0].slotId)
    ) {
      survivorRoot = list[0];
      survivorModules = list;
    }
  }
  if (survivorRoot === undefined) {
    // No survivor resolved: no split performed.
    return [];
  }

  // Snapshot the parent's pre-split centre of mass before any module
  // migration shifts it. Every fragment's tangential kick is measured
  // relative to this single CoM so total linear and angular momentum are
  // conserved across the split (each cell keeps the world velocity it had
  // as part of the spinning whole; see makeChunkShip).
  const parentComX = ship.comX;
  const parentComY = ship.comY;
  const parentVelX = ship.velX;
  const parentVelY = ship.velY;

  // Partition crew by the component their current cell belongs to. Each cell is
  // unique per component, so a crew member's (col, row) maps it to exactly one
  // fragment; a member mid-path is assigned by where it currently stands. Crew
  // whose cell is in no alive component (it died this tick) are dropped — but
  // updateCrew already removed crew on freshly-dead cells before break-apart, so
  // in practice every member maps to a fragment. The lookup is keyed by cell so
  // the split is deterministic regardless of map iteration order.
  const componentOfCell = new Map<string, SimModule[]>();
  for (const [, list] of components) {
    for (const m of list) componentOfCell.set(cellKey(m.col, m.row), list);
  }
  const crewOfComponent = new Map<SimModule[], SimCrew[]>();
  const parentCrew = ship.crew ?? [];
  for (const c of parentCrew) {
    const list = componentOfCell.get(cellKey(c.col, c.row));
    if (list === undefined) continue; // on a dead cell — killed
    const bucket = crewOfComponent.get(list);
    if (bucket === undefined) crewOfComponent.set(list, [c]);
    else bucket.push(c);
  }

  // Build chunk SimShips for every non-survivor component. Each chunk
  // inherits the parent's world position, facing, and angular velocity, but
  // gets a fresh instanceId and a CoM-tangential linear velocity. The chunk
  // carries its own copies of the migrated SimModules so subsequent ticks
  // treat it as an independent ship.
  const survivorSet = new Set(survivorModules);
  const chunks: SimShip[] = [];
  for (const [, list] of components) {
    if (list === survivorModules) continue;
    const chunkCrew = crewOfComponent.get(list) ?? [];
    const chunk = makeChunkShip(ship, list, chunkCrew, nextChunkId(ship.instanceId, currentTick));
    chunks.push(chunk);
    // Mark the migrated modules as gone on the original ship so its
    // hit-selection and aggregate recompute ignore them from now on.
    for (const m of list) {
      if (!survivorSet.has(m)) {
        m.alive = false;
        m.surfaceHp = 0;
        m.hp = 0;
      }
    }
  }

  // The parent keeps only the crew whose cell stayed with the survivor
  // fragment; everyone else either migrated to a chunk (copied independently)
  // or died with a severed cell. A migrating crew member that was mid-haul to a
  // station now on a different fragment is reset to idle so it re-plans within
  // its own fragment next tick.
  ship.crew = crewOfComponent.get(survivorModules) ?? [];
  for (const chunk of chunks) {
    if (chunk.crew === undefined) continue;
    for (const c of chunk.crew) resetCrewForFragment(c);
  }
  for (const c of ship.crew) resetCrewForFragment(c);

  // The surviving fragment's centre of mass shifts once the migrated modules
  // are gone. Apply the same tangential split to it so it, too, keeps the
  // world velocity its new CoM had under the parent's spin. recomputeAggregates
  // (run by the caller after this returns) derives the survivor's new CoM, so
  // do it here directly from the survivor module set with the same convention.
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

/**
 * Reference (oracle) break-apart implementation: always runs the full analysis.
 * Kept as the naive path so the determinism suite can prove the optimised
 * production path (`splitBreakApart`) is behaviour-preserving. Does NOT read
 * or write `breakApartLastAliveCount` — pure pass-through to `analyseBreakApart`.
 */
export function splitBreakApartReference(
  ship: SimShip,
  currentTick: number,
  nextChunkId: (parentId: string, tick: number) => string,
): SimShip[] {
  return analyseBreakApart(ship, currentTick, nextChunkId);
}

/**
 * Production break-apart implementation. Skips the O(C) union-find when the
 * ship's alive-module count is unchanged since the last evaluation, which holds
 * exactly when no module has died (the engine never sets `alive` back to true),
 * which holds exactly when the alive set — and therefore the connectivity graph
 * — is unchanged, in which case the full analysis also yields no split. On the
 * first ever call `breakApartLastAliveCount` is `undefined`, so the equality
 * test fails and the analysis runs — correct. See the header comment of this
 * section for the full byte-identical-frame reasoning, including resume.
 */
export function splitBreakApart(
  ship: SimShip,
  currentTick: number,
  nextChunkId: (parentId: string, tick: number) => string,
): SimShip[] {
  if (ship.aliveCount === ship.breakApartLastAliveCount) return [];
  ship.breakApartLastAliveCount = ship.aliveCount;
  return analyseBreakApartFast(ship, currentTick, nextChunkId);
}

/**
 * Apply the CoM-tangential momentum split to the surviving fragment in place.
 * Mirrors the fragment treatment in makeChunkShip: the survivor's new centre
 * of mass (over its remaining alive cells, the grid being the single source of
 * truth for mass) gains the tangential velocity it had under the parent's spin —
 * `v_parent + ω × (survivorCoM − parentCoM)`, with the local CoM offset rotated
 * by the ship facing into world axes. Angular velocity is unchanged.
 */
export function applyMomentumSplitToSurvivor(
  ship: SimShip,
  survivorModules: readonly SimModule[],
  parentComX: number,
  parentComY: number,
  parentVelX: number,
  parentVelY: number,
): void {
  const survivorCom = localCentreOfMass(survivorModules);
  const split = comTangentialVelocity(
    ship.facing,
    ship.angVel,
    parentVelX,
    parentVelY,
    survivorCom.x - parentComX,
    survivorCom.y - parentComY,
  );
  ship.velX = split.vx;
  ship.velY = split.vy;
}

/**
 * Build a fresh SimShip for a disconnected chunk of modules. The chunk
 * inherits the parent's world position and facing verbatim, and a
 * physically correct momentum split: it keeps the parent's angular
 * velocity ω, and its linear velocity is the parent's linear velocity
 * plus the tangential velocity the chunk's centre of mass already had
 * due to the parent's spin — `v_parent + ω × (chunkCoM − parentCoM)`.
 * The CoM offset is ship-local, so it is rotated by the parent's facing
 * into world axes before the cross product, matching the world frame of
 * `velX/velY`. Per-cell masses make each fragment's mass sum correct on
 * recompute, so total linear and angular momentum are conserved across
 * the split (the parent's surviving fragment carries the complement).
 * Aggregates are recomputed from the chunk's own module set so the chunk
 * participates in subsequent ticks' movement, firing, and damage.
 *
 * The chunk's structure field is reset to the parent's remaining
 * structure scaled by the fraction of modules it carries — so a chunk
 * with half the modules takes roughly half the structural damage before
 * dying. This is a v1 simplification: a more faithful model would
 * partition the hull HP by component, but per-module hull HP isn't
 * tracked on the aggregated ship.
 *
 * `instanceId` is supplied by the caller so two runs with identical
 * inputs deterministically produce the same chunk ids. The id is built
 * from the parent's id, the tick the split happened on, and a per-tick
 * counter — together those uniquely identify the chunk within a battle.
 */
export function makeChunkShip(
  parent: SimShip,
  modules: readonly SimModule[],
  crew: readonly SimCrew[],
  instanceId: string,
): SimShip {
  const totalAlive = parent.modules === undefined ? 1 : parent.modules.filter((m) => m.alive).length;
  const fraction = totalAlive === 0 ? 1 : modules.length / totalAlive;
  const chunkStructure = Math.max(1, parent.structure * fraction);
  // Independent copies of the modules: mutations on one ship must not
  // bleed into the other.
  const chunkModules: SimModule[] = modules.map((m) => ({ ...m }));
  const chunk: SimShip = {
    instanceId,
    faction: parent.faction,
    side: parent.side,
    classification: parent.classification,
    x: parent.x,
    y: parent.y,
    facing: parent.facing,
    // Linear velocity starts at the parent's; the tangential spin term is added
    // below once recomputeAggregates derives the chunk's own centre of mass.
    velX: parent.velX,
    velY: parent.velY,
    // Momentum (px/py) is re-derived from velocity on the chunk's first move
    // tick, so seeding 0 here is sufficient.
    px: 0,
    py: 0,
    // Angular velocity is conserved — a rigid fragment leaves spinning at the
    // parent's rate.
    angVel: parent.angVel,
    dilationFactor: 1,
    structure: chunkStructure,
    maxStructure: chunkStructure,
    // Shield and deflector pools reset to zero on a fresh chunk;
    // recomputeAggregates re-derives capacity from the chunk's own modules.
    shield: 0,
    maxShield: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 0,
    shieldRegenCountdown: 0,
    shieldAdaptiveRamp: 0,
    shieldUntouchedTicks: 0,
    deflector: 0,
    maxDeflector: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    deflectorRegenCountdown: 0,
    auraRangeBonus: 0,
    auraAccuracyBonus: 0,
    armourReduction: 0,
    thrust: 0,
    turnRate: 0,
    // A fresh chunk has not fired its engines yet; the next move tick sets it.
    engineThrottle: 0,
    // Placeholders; recomputeAggregates derives the real mass, CoM, MoI, and
    // broad-phase radius from the chunk's own module set immediately after
    // construction.
    mass: 0,
    comX: 0,
    comY: 0,
    momentOfInertia: 1,
    radius: parent.radius,
    cost: 0,
    weapons: [],
    weaponCooldowns: [],
    // A fragment inherits the parent's doctrine — it is a piece of the same
    // ship, so it fights under the same posture.
    doctrine: parent.doctrine,
    ...defaultAiDecisions(), // live AI decisions; the AI step rewrites them next tick
    target: undefined,
    alive: true,
    // A break-away chunk starts with no salvage of its own — recovered mass and
    // any hull claims belong to the parent that did the salvaging, not the
    // severed fragment.
    salvageMass: 0,
    // A fragment inherits a deep copy of the parent's ghost memory — it
    // remembers the enemies the parent had a fix on at the moment of the split
    // (independent objects so decay on one fragment never bleeds into the
    // other). Awareness is transient and rebuilt next tick, so it starts empty.
    ghosts: parent.ghosts.map((g) => ({ ...g })),
    awareness: new Map(),
    modules: chunkModules,
    // The crew whose cells fell into this fragment, copied independently so the
    // chunk and its parent never share crew state. A fragment with nobody aboard
    // leaves its crewed stations unmanned — a severed section can't crew itself.
    crew: crew.map((c) => ({
      ...c,
      // Deep-copy the path so the chunk's crew never share array identity with
      // the parent's crew (the arrays are never mutated in place, but the
      // snapshot and any future mutation must be independent). pathIndex is
      // reset by resetCrewForFragment (called by the caller after this), so the
      // copied value here is transient.
      path: c.path.map((p) => ({ ...p })),
      pathIndex: c.pathIndex,
    })),
    hullBaseThrust: parent.hullBaseThrust,
    // A fragment inherits the parent's last-fired tick, so a chunk that breaks
    // off a ship that just fired carries the same open decloak window.
    lastFiredTick: parent.lastFiredTick,
    // A fragment inherits the parent's current sensor saturation, so a chunk
    // that breaks off a freshly-flash-blinded ship stays blinded on its own
    // receiver (battlefield-medium phase 5).
    sensorSaturation: parent.sensorSaturation,
  };
  // A severed fragment gets its own module copies, so build its own static tech
  // classification from them (a chunk may inherit a commandAura or overcharge
  // module from the parent; without this the per-tick tech loops would silently
  // skip it). chunkModules are independent objects, so the cache references the
  // chunk's copies, not the parent's.
  chunk.techCaches = buildTechCaches(chunkModules);
  // Force a clean recompute so chunk aggregates match its own modules.
  // This derives the chunk's own ship-local centre of mass (comX/comY).
  // Carry over effect-scaling metadata for any multi-cell anchors that
  // migrated with the chunk (covers left in the parent simply read as dead —
  // the chunk's anchor lost them). The parent's entries for migrated anchors
  // stay behind but are skipped (the parent's copies are now dead).
  if (parent.scalingMeta !== undefined && parent.scalingMeta.length > 0) {
    const chunkSlots = new Set(chunk.modules?.map((m) => m.slotId));
    const chunkScaling = parent.scalingMeta.filter((e) => chunkSlots.has(e.slotId));
    if (chunkScaling.length > 0) chunk.scalingMeta = chunkScaling;
  }
  recomputeAggregatesWithScaling(chunk);
  // Momentum split: set the chunk's linear velocity to the parent's plus the
  // tangential velocity the chunk's CoM had under the parent's spin.
  const split = comTangentialVelocity(
    parent.facing,
    parent.angVel,
    parent.velX,
    parent.velY,
    chunk.comX - parent.comX,
    chunk.comY - parent.comY,
  );
  chunk.velX = split.vx;
  chunk.velY = split.vy;
  // Shield and deflector pools reset to zero — the parent's pools don't carry
  // over; recomputeAggregates re-derives capacity from the chunk's own modules.
  chunk.shield = 0;
  chunk.maxShield = 0;
  chunk.deflector = 0;
  chunk.maxDeflector = 0;
  // Compute the chunk's outlines. The collision outline (octilinear shrink-wrap
  // of the chunk's whole footprint) stays on `computeOutline`; the bevelled
  // render outline (the 45-degree-faceted hull the designer renders) is
  // `computeChunkRenderOutline`, which the snapshot descriptor prefers so a
  // split-off chunk does not snap to an octilinear silhouette. Grid dimensions
  // come from the parent's full module set so the resulting vertices share the
  // same ship-local coordinate frame as module.x/y.
  const chunkOutline = computeChunkOutline(parent.modules ?? [], modules);
  if (chunkOutline.length > 0) chunk.outline = chunkOutline;
  const chunkRenderOutline = computeChunkRenderOutline(parent.modules ?? [], modules);
  if (chunkRenderOutline.length > 0) chunk.renderOutline = chunkRenderOutline;
  return chunk;
}
