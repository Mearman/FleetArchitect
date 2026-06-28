/**
 * Ship-ship collision: the spatial-hash build, broad-phase pairing, and the
 * contact resolution that separates overlapping ships and applies impulse.
 */

import { CELL_SIZE } from "@/domain/grid";
import { SpatialHash, cellWorldPosition } from "@/domain/simulation/spatial-hash";

import { SIM, SPEED_OF_LIGHT_M_PER_TICK } from "./config";
import { applyDamage } from "./damage";
import { outerWorldLoop, polygonsContact } from "./poly-collision";
import { localPointToWorld, worldToLocal } from "./setup";
import type { SimModule, SimShip } from "./types";
import { applyImpulse } from "./weapons";

/** A ship cell placed in the broad-phase: the owning ship, the cell, and its
 *  world-space centre at the moment the hash was built. */
export interface ShipCell {
  ship: SimShip;
  module: SimModule;
  wx: number;
  wy: number;
}

/**
 * Build a uniform spatial hash over every alive ship's occupied cells in world
 * space. Each alive module on a modular ship contributes one entry at its
 * world-space cell centre (the ship's pose composed with the cell's ship-local
 * centre). Legacy aggregated ships have no cells, so they don't participate in
 * the cell-level broad-phase — they keep the centre-based behaviour. The hash
 * backs both projectile-vs-cell hits and ship-vs-ship collision so the two
 * agree on where every cell is.
 */
export function buildShipCellHash(ships: readonly SimShip[]): SpatialHash<ShipCell> {
  const hash = new SpatialHash<ShipCell>();
  for (const ship of ships) {
    if (!ship.alive || ship.modules === undefined) continue;
    for (const m of ship.modules) {
      if (!m.alive) continue;
      const { wx, wy } = cellWorldPosition(ship.x, ship.y, ship.facing, m.x, m.y);
      hash.insert({ ship, module: m, wx, wy }, wx, wy);
    }
  }
  return hash;
}

/**
 * The frontmost occupied cell a segment passes within `radius` of, or
 * undefined. The segment is the path a moving point (a projectile) swept this
 * tick; a cell is struck when its world centre lies within `radius` of the
 * segment, and the FRONTMOST — smallest projection along the travel direction,
 * ties broken by nearest approach — is the entry cell. This is the swept
 * anti-tunnelling collision: a projectile moving many cells per tick still
 * strikes the first cell its path crosses, where a single point sample at the
 * post-move position would step clean past it. Deterministic:
 * `candidatesAlongSegment` is an order-stable superset and the distance and
 * projection tests are pure, with ties resolved by first-found order.
 */
export function nearestCellAlongSegment(
  hash: SpatialHash<ShipCell>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  accept: (cell: ShipCell) => boolean,
): ShipCell | undefined {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const segLenSq = dx * dx + dy * dy;
  const radiusSq = radius * radius;
  let best: ShipCell | undefined;
  let bestProj = Infinity;
  let bestDistSq = Infinity;
  for (const entry of hash.candidatesAlongSegment(x0, y0, x1, y1, radius)) {
    const cell = entry.payload;
    if (!accept(cell)) continue;
    // Projection of the cell centre onto the segment, clamped to [0,1] (the
    // reachable span); the closest point on the segment to the cell.
    let t = segLenSq > 0 ? ((cell.wx - x0) * dx + (cell.wy - y0) * dy) / segLenSq : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = x0 + t * dx;
    const py = y0 + t * dy;
    const dSq = (cell.wx - px) * (cell.wx - px) + (cell.wy - py) * (cell.wy - py);
    if (dSq > radiusSq) continue;
    // Frontmost: smallest projection (earliest reach); tie-break nearest approach.
    if (t < bestProj || (t === bestProj && dSq < bestDistSq)) {
      best = cell;
      bestProj = t;
      bestDistSq = dSq;
    }
  }
  return best;
}

/**
 * Two cells overlap when their world-space centres are within one cell size of
 * each other — each cell is treated as a disc of radius `CELL_SIZE/2`, so the
 * discs intersect when the centre distance is below `CELL_SIZE`. The contact
 * depth is how far the discs overlap; used for positional separation.
 */
export const CELL_CONTACT_DISTANCE = CELL_SIZE;

/**
 * Ship-vs-ship collision at cell granularity. All ships are solid bodies —
 * enemies and friendlies alike — so no two ships may interpenetrate. Cells from
 * different ships that overlap (centre distance below `CELL_CONTACT_DISTANCE`)
 * register a contact for that ship pair; per pair, the deepest contact's normal
 * and point drive the response:
 *
 *  - **Elastic impulse** along the contact normal, scaled by the relative
 *    velocity of the two contact points (including each ship's spin), the
 *    reduced mass, and the lever arms about each CoM — delivered through the
 *    existing `applyImpulse` so the linear push and the torque are consistent
 *    with the rest of the rigid-body model. Approaching pairs exchange
 *    momentum; pairs already separating are left alone so a resolved contact
 *    doesn't get pulled back together.
 *  - **Positional separation** pushing the two ships apart along the normal by
 *    the penetration depth, split between them in inverse proportion to mass,
 *    so the cells stop overlapping this tick rather than drifting through.
 *
 * Each ordered ship pair is resolved at most once per tick. Legacy aggregated
 * ships (no cells) don't appear in the hash and so never collide at the cell
 * level — they keep passing through, matching the pre-grid behaviour.
 */
/**
 * The deepest contact resolved for one unordered ship pair this tick: the two
 * ships, the contact point and normal (from `a` toward `b`) in world space, and
 * the penetration depth. Returned by `resolveShipCollisions` so the kinetic
 * collision-damage step can apply structural damage to the same pairs the
 * impulse step pushed apart, without re-running the broad phase.
 */
export interface ShipContact {
  a: SimShip;
  b: SimShip;
  // Contact point in world space (midpoint of the two cell centres).
  px: number;
  py: number;
  // Unit normal from a toward b.
  nx: number;
  ny: number;
  depth: number;
  // Relative linear velocity of b w.r.t. a, captured BEFORE the restitution
  // impulse reflects it, so the kinetic-damage step measures the true approach
  // energy rather than the post-bounce velocity. Set when the contact is
  // resolved, just before `resolveContact` mutates the ships' velocities.
  relVx: number;
  relVy: number;
}

/**
 * The contact-generation boundary: given the cell hash, produce the per-pair
 * deepest disc contact (before outline refine). Both implementations of
 * ship-ship collision share this contract — a reference (oracle) per-cell swept
 * scan and an optimised ship-pair broad-phase — and hand their output to the
 * shared narrow-phase ({@link resolveCandidateContacts}), which refines by hull
 * outline, applies the impulse, and returns the ordered contact list.
 *
 * The map is keyed by the unordered pair key (`pairKey`) and holds, for each
 * pair, the deepest disc contact found (greatest `depth`). Both implementations
 * must produce the same map for any given hash: the same set of pair keys, and
 * for each the same `depth`, `px`, `py`, `nx`, `ny` (`relVx`/`relVy` are filled
 * later by the narrow-phase). The optimised implementation is a strict superset
 * at the candidate-pair level — it may visit extra pairs that the disc test
 * then rejects — so its surviving contacts match the reference exactly.
 */
type CandidateContacts = Map<string, ShipContact>;

/**
 * Record a disc contact between two cells of ships `a` and `b` (a < b by
 * instanceId), keeping the deepest per pair. Shared by both contact-generation
 * implementations. `(wx, wy)` is a's cell centre; `(ox, oy)` is b's. The normal
 * points from a's cell toward b's; when the two cells sit exactly on top of each
 * other it falls back to the line between ship centres so the push is still
 * well-defined. `relVx`/`relVy` are left at 0 — the narrow-phase fills them from
 * the pre-impulse velocities just before resolution.
 */
function recordDeepest(
  contacts: CandidateContacts,
  a: SimShip,
  b: SimShip,
  wx: number,
  wy: number,
  ox: number,
  oy: number,
): void {
  const dx = ox - wx;
  const dy = oy - wy;
  const distSq = dx * dx + dy * dy;
  if (distSq >= CELL_CONTACT_DISTANCE * CELL_CONTACT_DISTANCE) return;
  const dist = Math.sqrt(distSq);
  const depth = CELL_CONTACT_DISTANCE - dist;
  let nx: number;
  let ny: number;
  if (dist > 1e-9) {
    nx = dx / dist;
    ny = dy / dist;
  } else {
    const cdx = b.x - a.x;
    const cdy = b.y - a.y;
    const cdist = Math.hypot(cdx, cdy);
    if (cdist > 1e-9) {
      nx = cdx / cdist;
      ny = cdy / cdist;
    } else {
      nx = 1;
      ny = 0;
    }
  }
  const key = pairKey(a, b);
  const existing = contacts.get(key);
  if (existing === undefined || depth > existing.depth) {
    contacts.set(key, {
      a,
      b,
      px: (wx + ox) / 2,
      py: (wy + oy) / 2,
      nx,
      ny,
      depth,
      relVx: 0,
      relVy: 0,
    });
  }
}

/**
 * REFERENCE (oracle) contact generation: the original per-cell swept-segment
 * scan. For every alive cell in the hash, query the buckets along the path it
 * traced this tick — the segment from its pre-move position `(wx - velX, wy -
 * velY)` to its current `(wx, wy)` — widened by the contact radius, and record
 * the deepest disc contact per unordered ship pair.
 *
 * The sweep exists for anti-tunnelling: without it, two ships passing at a
 * relative speed above CELL_SIZE per tick can have cell centres in non-adjacent
 * buckets and the post-move nearest pair would be missed by a static disc query
 * rooted at the post-move bucket alone. A segment query (rather than a disc
 * widened by the whole displacement) keeps the cost linear in the displacement
 * instead of quadratic. The actual contact depth is always computed on the
 * POST-MOVE positions (`recordDeepest` reads `wx/wy` and `ox/oy`), so the sweep
 * only widens the CANDIDATE set — the narrow-phase depth test is unchanged.
 *
 * This is O(total_cells) segment queries and allocates a `Set` per cell inside
 * `candidatesAlongSegment`; the optimised broad-phase below avoids both for the
 * common case where most ships never approach each other.
 */
export function generateCandidateContactsReference(hash: SpatialHash<ShipCell>): CandidateContacts {
  const contacts: CandidateContacts = new Map();
  for (const entry of hash.entries()) {
    const { ship: a, wx, wy } = entry.payload;
    const x0 = wx - a.velX;
    const y0 = wy - a.velY;
    for (const other of hash.candidatesAlongSegment(x0, y0, wx, wy, CELL_CONTACT_DISTANCE)) {
      const b = other.payload.ship;
      if (a === b) continue;
      // Resolve each unordered pair once: only consider a < b by instanceId.
      if (a.instanceId >= b.instanceId) continue;
      recordDeepest(contacts, a, b, wx, wy, other.wx, other.wy);
    }
  }
  return contacts;
}

/**
 * OPTIMISED contact generation: a ship-pair broad-phase over bounding circles,
 * then the per-cell deepest search only for the pairs that survive. Ships with
 * no candidate partner contribute nothing, exactly as in the reference scan.
 *
 * Broad-phase. Each ship's alive cells provably lie within a bounding circle
 * centred on the ship's position `(x, y)` of radius `ship.radius` (set by
 * `gridRadius` as the farthest cell-centre distance plus half a cell, so the
 * disc encloses every cell). Two ships can produce a disc contact only if some
 * post-move cell of A lies within `CELL_CONTACT_DISTANCE` of some post-move
 * cell of B; since cells lie inside their bounding discs, a necessary condition
 * is `|B.pos − A.pos| ≤ r_a + r_b + CELL_CONTACT_DISTANCE`. That bound is a
 * STRICT SUPERSET of the true contact relation — false negatives would drift
 * frames (and there are none); false positives merely cost an extra per-pair
 * cell scan that the depth test rejects. Velocities are not needed: the
 * reference computes every contact depth on post-move positions, so tunnelling
 * pairs (which the reference also rejects) carry through identically.
 *
 * Narrow-phase per pair. For each surviving pair, walk A's alive cells and query
 * the hash with a static disc of radius `CELL_CONTACT_DISTANCE` — equivalent to
 * the reference's swept segment when the cell's per-tick displacement stays
 * below the contact distance, and a superset of the same cell set otherwise
 * (duplicate candidates are harmless: `recordDeepest` keeps the deepest per
 * pair). The static `forEachCandidate` walk avoids both the per-call `Set`
 * allocation the segment query performs and the per-call result-array
 * allocation `candidates` performs — relevant here because this narrow-phase
 * runs once per A-cell per candidate pair, so the array allocation was a
 * measurable share of the profile.
 */
export function generateCandidateContactsOptimised(hash: SpatialHash<ShipCell>): CandidateContacts {
  // Collect each ship's alive cells and bounding info in a single pass over the
  // hash. A ship appears in the hash iff it is modular and has at least one
  // alive cell, so the derived set is exactly the ships that can contact.
  const shipOrder: SimShip[] = [];
  const shipCells = new Map<string, { wx: number; wy: number }[]>();
  for (const entry of hash.entries()) {
    const ship = entry.payload.ship;
    let list = shipCells.get(ship.instanceId);
    if (list === undefined) {
      list = [];
      shipCells.set(ship.instanceId, list);
      shipOrder.push(ship);
    }
    list.push({ wx: entry.wx, wy: entry.wy });
  }

  const contacts: CandidateContacts = new Map();
  for (let i = 0; i < shipOrder.length; i += 1) {
    const a = shipOrder[i]!;
    const aCells = shipCells.get(a.instanceId)!;
    for (let j = i + 1; j < shipOrder.length; j += 1) {
      const b = shipOrder[j]!;
      // Unordered pair key tie-break: only consider a < b by instanceId.
      if (a.instanceId >= b.instanceId) continue;
      // Bounding-circle broad-phase: skip the pair unless the two discs,
      // expanded for the contact distance, overlap. `ship.radius` is the grid
      // bounding radius, which provably encloses every alive cell.
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const centreDistSq = dx * dx + dy * dy;
      const reach = a.radius + b.radius + CELL_CONTACT_DISTANCE;
      if (centreDistSq > reach * reach) continue;
      // Narrow-phase: for each of A's cells, query the hash for B's nearby
      // cells and record the deepest disc contact for the pair. The query
      // returns entries from every ship (including A itself and unrelated
      // ships); filter to B. Duplicates are harmless — recordDeepest keeps the
      // maximum depth.
      for (const cell of aCells) {
        // No-alloc candidate walk: forEachCandidate invokes the callback per
        // entry rather than materialising a fresh array per cell per pair.
        hash.forEachCandidate(cell.wx, cell.wy, CELL_CONTACT_DISTANCE, (other) => {
          if (other.payload.ship !== b) return;
          recordDeepest(contacts, a, b, cell.wx, cell.wy, other.wx, other.wy);
        });
      }
    }
  }
  return contacts;
}

/**
 * Shared narrow-phase: refine each candidate by hull outline, apply the
 * restitution impulse and positional separation, and return the ordered contact
 * list for the kinetic-damage step. Candidates are sorted by pair key so the
 * impulse sequence is deterministic regardless of map iteration order.
 */
function resolveCandidateContacts(candidates: CandidateContacts): ShipContact[] {
  const ordered = [...candidates.values()].sort((x, y) =>
    pairKey(x.a, x.b) < pairKey(y.a, y.b) ? -1 : pairKey(x.a, x.b) > pairKey(y.a, y.b) ? 1 : 0,
  );
  const resolved: ShipContact[] = [];
  for (const contact of ordered) {
    // Polygon narrow-phase: the disc-based broad-phase above pairs cells whose
    // centres lie within a cell of each other, which is a generous proxy for
    // the true hull boundaries. Refine each candidate against the two ships'
    // world-space hull outlines: the chamfered shell, not the cell discs, is
    // the authoritative collision shape. When the polygons genuinely overlap we
    // use the polygon contact point and outward normal in place of the cell
    // midpoint; when they don't, the broad-phase was a false positive (the
    // discs touched but the hulls did not) and the pair is dropped. Either ship
    // lacking an outline (a bare-substrate hull or a legacy aggregated ship) has
    // no polygon to test, so the disc-based contact stands unchanged.
    const refined = refineContactByOutline(contact);
    if (refined === undefined) continue; // false positive: hulls do not overlap
    // Snapshot the approach velocity before the impulse reflects it, so the
    // kinetic-damage step sees the energy of the collision, not the rebound.
    refined.relVx = refined.b.velX - refined.a.velX;
    refined.relVy = refined.b.velY - refined.a.velY;
    resolveContact(refined.a, refined.b, refined.px, refined.py, refined.nx, refined.ny, refined.depth);
    resolved.push(refined);
  }
  return resolved;
}

/**
 * Ship-vs-ship collision resolution (production path). Builds the per-pair
 * candidate contacts via the OPTIMISED ship-pair broad-phase
 * ({@link generateCandidateContactsOptimised}), then runs the shared
 * narrow-phase (outline refine, impulse, positional separation). The reference
 * implementation ({@link resolveShipCollisionsReference}) is kept as an oracle
 * for the equivalence test.
 */
export function resolveShipCollisions(hash: SpatialHash<ShipCell>): ShipContact[] {
  return resolveCandidateContacts(generateCandidateContactsOptimised(hash));
}

/**
 * REFERENCE (oracle) ship-vs-ship collision resolution: the original per-cell
 * swept-segment scan, kept as a first-class implementation the equivalence test
 * compares against the optimised path. Not wired into production; production
 * runs {@link resolveShipCollisions}.
 */
export function resolveShipCollisionsReference(hash: SpatialHash<ShipCell>): ShipContact[] {
  return resolveCandidateContacts(generateCandidateContactsReference(hash));
}

/**
 * Refine a disc-based candidate contact against the two ships' world-space hull
 * outlines. Returns the contact with its point and normal replaced by the true
 * polygon contact when the hulls overlap, the original contact unchanged when
 * either ship has no outline to test, or `undefined` when the polygon test
 * rejects the pair as a broad-phase false positive. The penetration depth is
 * carried through from the disc contact: the disc overlap is a sound proxy for
 * the separation push, and the polygon test sharpens only where the contact
 * sits and which way it points.
 */
function refineContactByOutline(contact: ShipContact): ShipContact | undefined {
  const loopA = outerWorldLoop(contact.a);
  const loopB = outerWorldLoop(contact.b);
  if (loopA === undefined || loopB === undefined) return contact;
  const hit = polygonsContact(loopA, loopB);
  if (hit === null) return undefined;
  return {
    ...contact,
    px: hit.x,
    py: hit.y,
    nx: hit.nx,
    ny: hit.ny,
  };
}

/** Stable key for an unordered ship pair: the two instanceIds joined low-first,
 *  so the same pair always produces the same key regardless of argument order. */
function pairKey(a: SimShip, b: SimShip): string {
  return a.instanceId < b.instanceId
    ? `${a.instanceId}|${b.instanceId}`
    : `${b.instanceId}|${a.instanceId}`;
}

/**
 * Kinetic ship-ship collision damage (realism overhaul, Phase 4). For each
 * resolved contact this tick, convert a fraction of the pair's collision kinetic
 * energy into structural damage on both ships — Newton's third law: the rammer
 * and the rammed both suffer.
 *
 * The collision KE uses the relativistic form evaluated via the numerically
 * stable identity `KE = m_r · v² / (√(1−β²) · (1+√(1−β²)))`, where
 * `β² = |v_rel|² / c²` (clamped below 1) and the reduced mass is
 * `m_r = (m1 * m2) / (m1 + m2)`. This equals `(γ−1) · m_r · c²` but avoids
 * catastrophic cancellation when β ≪ 1, reducing to the Newtonian
 * `½ · m_r · |v_rel|²` at sub-light speeds to full floating-point precision.
 * `SIM.collisionDamageFraction` of that energy is dealt as damage,
 * split between the two ships in inverse proportion to mass (the lighter ship is
 * the one that decelerates harder, so it absorbs the larger share of the
 * energy). The damage strikes the contact-side modules — the cells nearest the
 * world-space contact point on each ship — by routing through `applyDamage`
 * aimed at that point, so shields and armour apply exactly as for a weapon hit.
 *
 * Runs over the contact list `resolveShipCollisions` returned (already in a
 * stable pair order), so the damage application is deterministic. A tick with no
 * contacts does nothing.
 */
export function applyCollisionDamage(contacts: readonly ShipContact[]): void {
  for (const c of contacts) {
    const ma = Math.max(c.a.mass, 1);
    const mb = Math.max(c.b.mass, 1);
    const reducedMass = (ma * mb) / (ma + mb);
    const relSpeedSq = c.relVx * c.relVx + c.relVy * c.relVy;
    if (relSpeedSq <= 0) continue;
    // Relativistic KE using the numerically stable identity:
    //   (γ − 1) · c² = v² / (√(1 − β²) · (1 + √(1 − β²)))
    // This avoids catastrophic cancellation in (γ − 1) when β ≪ 1, and
    // reduces to the Newtonian ½v² at sub-light speeds to full floating-point
    // precision. β² is clamped strictly below 1 to guard against rounding
    // overshoot — in practice sim speeds are many orders of magnitude below c.
    const cSq = SPEED_OF_LIGHT_M_PER_TICK * SPEED_OF_LIGHT_M_PER_TICK;
    const betaSq = Math.min(relSpeedSq / cSq, 1 - Number.EPSILON);
    const sqrtOneMinusBetaSq = Math.sqrt(1 - betaSq);
    const collisionKE = (reducedMass * relSpeedSq) / (sqrtOneMinusBetaSq * (1 + sqrtOneMinusBetaSq));
    const totalDamage = collisionKE * SIM.collisionDamageFraction;
    if (totalDamage <= 0) continue;
    // Split inversely to mass: the lighter ship takes the larger share. Shares
    // sum to 1, so the pair dissipates exactly `totalDamage` between them.
    const totalInvMass = 1 / ma + 1 / mb;
    const aShare = (1 / ma) / totalInvMass;
    const bShare = (1 / mb) / totalInvMass;
    // Strike the contact-side cells: aim each ship's hit at the shared world
    // contact point, so applyDamage's nearest-cell selection lands on the cells
    // closest to the point of contact on each hull.
    applyDamage(c.a, totalDamage * aShare, 0, 0, c.px, c.py);
    applyDamage(c.b, totalDamage * bShare, 0, 0, c.px, c.py);
  }
}

/**
 * Resolve a single ship-vs-ship contact: an elastic impulse along the normal
 * plus positional separation. `(px, py)` is the contact point in world space,
 * `(nx, ny)` the unit normal from `a` toward `b`, and `depth` the penetration.
 */
export function resolveContact(
  a: SimShip,
  b: SimShip,
  px: number,
  py: number,
  nx: number,
  ny: number,
  depth: number,
): void {
  const ma = Math.max(a.mass, 1);
  const mb = Math.max(b.mass, 1);

  // Lever arms from each ship's CoM to the contact point, in world space. The
  // CoM is stored in ship-local coordinates, so rotate it into world space and
  // add the ship position to get the world-space pivot.
  const aCom = localPointToWorld(a, a.comX, a.comY);
  const bCom = localPointToWorld(b, b.comX, b.comY);
  const rax = px - aCom.x;
  const ray = py - aCom.y;
  const rbx = px - bCom.x;
  const rby = py - bCom.y;

  // Velocity of each contact point = linear velocity + ω × r (2D: ω × r =
  // (-ω·ry, ω·rx)).
  const vax = a.velX - a.angVel * ray;
  const vay = a.velY + a.angVel * rax;
  const vbx = b.velX - b.angVel * rby;
  const vby = b.velY + b.angVel * rbx;

  // Relative velocity of b's contact point with respect to a's, projected
  // onto the normal. Negative means the points are approaching.
  const rvx = vbx - vax;
  const rvy = vby - vay;
  const approach = rvx * nx + rvy * ny;

  if (approach < 0) {
    // Elastic (restitution 1) impulse magnitude along the normal. The
    // rotational terms (r × n)²/I add the contact's resistance to spin into
    // the effective mass, so a glancing hit off-centre transfers less linear
    // momentum and more spin — consistent with the rigid-body model.
    const ia = a.momentOfInertia > 0 ? a.momentOfInertia : Infinity;
    const ib = b.momentOfInertia > 0 ? b.momentOfInertia : Infinity;
    const raCrossN = rax * ny - ray * nx;
    const rbCrossN = rbx * ny - rby * nx;
    const invEffectiveMass =
      1 / ma + 1 / mb + (raCrossN * raCrossN) / ia + (rbCrossN * rbCrossN) / ib;
    const restitution = 1;
    const j = (-(1 + restitution) * approach) / invEffectiveMass;
    // Equal and opposite impulses at the shared contact point. applyImpulse
    // wants the impulse in world coordinates and the application point in the
    // ship's local frame, so convert the world contact point per ship.
    const aLocal = worldToLocal(a, px, py);
    const bLocal = worldToLocal(b, px, py);
    if (aLocal !== undefined) applyImpulse(a, -j * nx, -j * ny, aLocal.x, aLocal.y);
    if (bLocal !== undefined) applyImpulse(b, j * nx, j * ny, bLocal.x, bLocal.y);
  }

  // Positional separation: push the ships apart along the normal by the
  // penetration depth, split inversely to mass so the lighter ship moves more.
  const totalInvMass = 1 / ma + 1 / mb;
  const aShare = (1 / ma) / totalInvMass;
  const bShare = (1 / mb) / totalInvMass;
  a.x -= nx * depth * aShare;
  a.y -= ny * depth * aShare;
  b.x += nx * depth * bShare;
  b.y += ny * depth * bShare;
}
