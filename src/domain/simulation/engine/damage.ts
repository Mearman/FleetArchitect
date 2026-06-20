/**
 * Damage application: structure/shield/module damage, reactive armour, the
 * directional-shield lookup, nearest-alive-module hit selection, and the
 * break-apart chunk logic.
 */

import type { SimCrew } from "../types";

import { resetCrewForFragment } from "./crew";
import { comTangentialVelocity, localCentreOfMass, recomputeAggregates } from "./physics";
import { makeResourceState } from "./resource-step";
import { angleDifference, normaliseAngle, worldToLocal } from "./setup";
import type { SimModule, SimShip } from "./types";

/**
 * Apply incoming weapon damage. Shields absorb the non-pierced fraction
 * first; any shield contact resets the shield-regeneration delay.
 *
 * What gets past the shields (`rawStructure`) then either:
 *  - per-module ship: strikes the alive module whose cell is nearest the
 *    world-space impact point (transformed into ship-local coordinates),
 *    destroying it if its HP runs out; overflow spills to hull structure,
 *    reduced by armour; or
 *  - legacy aggregated ship: hits structure directly, reduced by armour.
 *
 * When the ship carries directional shield modules (an alive shield whose
 * `shieldArc < 2π`), the incoming shot direction is tested against each
 * shield's arc. A directional shield whose arc covers the shot absorbs the
 * hit using its module HP (in addition to the pooled shield pool above),
 * before any structural module is touched. If the directional shield is
 * destroyed, the leftover spills onward to the next-nearest module.
 *
 * `impactX/impactY` are the world-space hit location (a projectile's
 * position, or for hitscan the target's edge facing the shooter). When
 * provided we use the projectile's velocity direction as the shot angle;
 * otherwise we fall back to the direction from the target toward the
 * attacker (or 0 if no attacker is known).
 */
export function applyDamage(
  ship: SimShip,
  damage: number,
  shieldPiercing: number,
  armourPiercing: number,
  impactX?: number,
  impactY?: number,
  shotAngle?: number,
  /**
   * Ordered penetration path: the modules the shot passes through, frontmost
   * first, as resolved by the broad-phase cell lookup. When supplied (a
   * projectile-vs-cell hit) structural damage strikes the frontmost cell and
   * any overflow carries to the next cell behind along the travel direction.
   * When omitted (hitscan / legacy) the spill falls back to the nearest-alive
   * heuristic so beams and the aggregated path are unchanged.
   */
  path?: readonly SimModule[],
): void {
  const bypass = damage * shieldPiercing;
  const toShield = damage - bypass;
  const shieldAbsorbed = Math.min(ship.shield, toShield);
  ship.shield -= shieldAbsorbed;
  if (shieldAbsorbed > 0) {
    ship.shieldRegenCountdown = ship.shieldRechargeDelay;
  }
  if (shieldAbsorbed > 0) {
    // Adaptive shields: any hit to the shield pool resets the untouched streak,
    // so the recharge ramp restarts from the base rate. A ship with no adaptive
    // shield reads `shieldAdaptiveRamp === 0` later, so this reset is harmless.
    ship.shieldUntouchedTicks = 0;
  }
  const spill = toShield - shieldAbsorbed;
  // Reactive armour (factions update) is part of the Phase 4 unified-damage
  // work. Its data lives on the per-faction armor layer material
  // (`LayerMaterial.reactiveReduction`/`reactiveWindow`) and the per-module
  // `reactiveCharge` timer; the pipeline that consumes them lands alongside
  // the joules refactor. For Phase 2 the full shield-bypass + spill amount
  // flows onward to structural damage unchanged.
  const rawStructure = bypass + spill;

  if (ship.modules !== undefined) {
    applyModuleDamage(ship, rawStructure, armourPiercing, impactX, impactY, shotAngle, path);
    return;
  }

  const effectiveReduction = ship.armourReduction * (1 - armourPiercing);
  ship.structure -= rawStructure * (1 - effectiveReduction);
  if (ship.structure <= 0) {
    ship.structure = 0;
    ship.alive = false;
  }
}

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
    for (const cell of path) {
      if (remaining <= 0) return;
      if (!cell.alive || cell === shield) continue;
      remaining = damageCell(cell, remaining);
      if (remaining <= 0) return; // this cell absorbed the rest
    }
    // Overflow past the last cell on the path falls to the hull structure.
    if (remaining > 0) spillToStructure(ship, remaining, armourPiercing);
    return;
  }

  // Nearest-alive fallback (hitscan / legacy).
  while (remaining > 0) {
    const target = nearestAliveModule(ship, local);
    if (target === undefined) {
      spillToStructure(ship, remaining, armourPiercing);
      return;
    }
    remaining = damageCell(target, remaining);
  }
}

/**
 * Apply damage to a single cell, depleting outer layer first: surface HP
 * (armor or deck) before scaffold HP (`hp`). Returns the leftover damage that
 * spills onward once the cell is destroyed (scaffold HP exhausted). When the
 * surface layer is gone but the scaffold survives, the cell remains alive and
 * no spill occurs — only scaffold destruction destroys the cell and severs
 * the graph.
 */
function damageCell(cell: SimModule, amount: number): number {
  let remaining = amount;
  // Surface layer first (armor / deck). Bare cells have maxSurfaceHp === 0 so
  // this pass is skipped and the damage hits the scaffold directly.
  if (cell.surfaceHp > 0) {
    cell.surfaceHp -= remaining;
    if (cell.surfaceHp > 0) return 0;
    remaining = -cell.surfaceHp;
    cell.surfaceHp = 0;
  }
  // Scaffold layer next.
  cell.hp -= remaining;
  if (cell.hp > 0) return 0;
  remaining = -cell.hp;
  cell.hp = 0;
  cell.alive = false;
  return remaining;
}

/**
 * Reduce a structural hit by the best charged reactive armour layer on the ship.
 *
 * Phase 2 note: reactive armour was previously an equipment-module effect
 * (`ArmourEffect.reactiveReduction`). Armour is now a cell surface and the
 * reactive fields live on the per-faction armor layer material
 * (`LayerMaterial.reactiveReduction` / `reactiveWindow`). The damage pipeline
 * that consumes them lands in Phase 4 alongside the joules refactor; for
 * Phase 2 the call site in `applyDamage` passes the full shield-bypass +
 * spill amount onward unchanged. This helper is removed — Phase 4 will
 * reintroduce it inspecting the ship's armor layer material and the
 * per-module `reactiveCharge` timer.
 */

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
 */
export function directionalShieldFor(
  ship: SimShip,
  shotAngle: number | undefined,
): SimModule | undefined {
  if (ship.modules === undefined || shotAngle === undefined) return undefined;
  const localShot = normaliseAngle(shotAngle - ship.facing);
  let candidate: SimModule | undefined;
  let bestScore = -Infinity;
  for (const m of ship.modules) {
    if (!m.alive || m.effect.kind !== "shield") continue;
    if (m.shieldArc >= Math.PI * 2) continue; // omnidirectional, use the pool
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
 *  centroid of alive modules when there's no impact point). */
export function nearestAliveModule(
  ship: SimShip,
  local: { x: number; y: number } | undefined,
): SimModule | undefined {
  if (ship.modules === undefined) return undefined;
  const alive = ship.modules.filter((m) => m.alive);
  if (alive.length === 0) return undefined;
  if (local === undefined) return alive[0];
  let best: SimModule | undefined;
  let bestDist = Infinity;
  for (const m of alive) {
    const d = (m.x - local.x) ** 2 + (m.y - local.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best;
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
 * The split happens at most once per ship per tick. After splitting, the
 * original ship's modules array is mutated so that every module belonging
 * to a non-primary component is marked `alive: false`. The chunk SimShips
 * carry their own copies of those modules (alive: true), re-derived
 * aggregates, and a fresh instanceId from `nextChunkId`.
 *
 * The function returns the list of new chunk ships to be added to the
 * simulation's ship list. Returns an empty array when no split happens.
 */
export function splitBreakApart(
  ship: SimShip,
  currentTick: number,
  nextChunkId: (parentId: string, tick: number) => string,
): SimShip[] {
  if (ship.modules === undefined) return [];
  const alive = ship.modules.filter((m) => m.alive);
  if (alive.length === 0) return [];
  // Every solid cell is scaffold-anchored by definition (scaffold is the
  // structural connectivity base of every built cell), so break-apart runs on
  // every modular ship — the previous hull-anchor gate is gone, since under
  // the layered-cell model there is no separate "hull cell" kind to gate on;
  // the scaffold itself is the anchor.
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
  if (!hasGridAdjacency) return [];

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
  if (components.size <= 1) return []; // connected — no split


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
  if (survivorRoot === undefined) return [];

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
    // Linear velocity starts at the parent's; the tangential term from the
    // parent's spin is added below, once recomputeAggregates has derived the
    // chunk's own centre of mass.
    velX: parent.velX,
    velY: parent.velY,
    // Angular velocity is conserved verbatim — a rigid fragment leaves the
    // parent spinning at the same rate it was spinning as part of the whole.
    angVel: parent.angVel,
    dilationFactor: 1,
    structure: chunkStructure,
    maxStructure: chunkStructure,
    shield: 0,
    maxShield: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 0,
    shieldRegenCountdown: 0,
    // A fresh chunk starts with no shield (reset above) so its adaptive ramp and
    // untouched streak begin at zero; recomputeAggregates re-derives the ramp
    // from the chunk's own shield modules. Auras are recomputed each tick.
    shieldAdaptiveRamp: 0,
    shieldUntouchedTicks: 0,
    auraRangeBonus: 0,
    auraAccuracyBonus: 0,
    armourReduction: 0,
    thrust: 0,
    turnRate: 0,
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
    orders: parent.orders,
    // A fragment inherits the parent's crew doctrine, stance, and rules — it
    // is a piece of the same ship, so it fights under the same posture.
    crewPriority: parent.crewPriority,
    shipStance: parent.shipStance,
    rules: parent.rules,
    aiHoldFire: false,
    target: undefined,
    alive: true,
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
  };
  // Force a clean recompute so chunk aggregates match its own modules.
  // This derives the chunk's own ship-local centre of mass (comX/comY).
  recomputeAggregates(chunk);
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
  // A chunk's shield pool resets to zero — it has no recharge, and the
  // parent's pooled shield doesn't carry over.
  chunk.shield = 0;
  chunk.maxShield = 0;
  // A fresh fragment gets its own resource state derived from its module set
  // (Phase 12 wiring): the chunk is a new ship with its own cells, so its
  // thermal/propellant/atmosphere/power fields start from the chunk's own
  // mass and module layout, not the parent's (now-stale) field.
  chunk.resource = makeResourceState(chunk);
  return chunk;
}
