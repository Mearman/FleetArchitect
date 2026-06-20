/**
 * Ship-ship collision: the spatial-hash build, broad-phase pairing, and the
 * contact resolution that separates overlapping ships and applies impulse.
 */

import { CELL_SIZE } from "@/domain/grid";
import { SpatialHash, cellWorldPosition } from "@/domain/simulation/spatial-hash";

import { SIM, SPEED_OF_LIGHT_M_PER_TICK } from "./config";
import { applyDamage } from "./damage";
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

export function resolveShipCollisions(hash: SpatialHash<ShipCell>): ShipContact[] {
  // Deepest contact per unordered ship pair.
  const contacts = new Map<string, ShipContact>();

  for (const entry of hash.entries()) {
    const { ship: a, wx, wy } = entry.payload;
    // Swept anti-tunnelling: widen the candidate query radius by the ship's
    // per-tick displacement so a fast-approaching pair registers a contact
    // before they interpenetrate. The hash is built once at the start of
    // collision resolution using each cell's position at that instant;
    // without the sweep two ships passing at a relative speed above
    // CELL_SIZE per tick can have cell centres in non-adjacent buckets and
    // tunnel through each other. Querying with each ship's own speed is
    // sufficient: the unordered pair is resolved once (by instanceId tie-
    // break), so it is found when iterating whichever of the two ships is
    // moving faster. The static narrow-phase test below (unchanged) keeps
    // the contact depth consistent.
    const aSpeed = Math.hypot(a.velX, a.velY);
    for (const other of hash.candidates(wx, wy, CELL_CONTACT_DISTANCE + aSpeed)) {
      const b = other.payload.ship;
      if (a === b) continue;
      // Resolve each unordered pair once: only consider a < b by instanceId.
      if (a.instanceId >= b.instanceId) continue;
      const dx = other.wx - wx;
      const dy = other.wy - wy;
      const distSq = dx * dx + dy * dy;
      if (distSq >= CELL_CONTACT_DISTANCE * CELL_CONTACT_DISTANCE) continue;
      const dist = Math.sqrt(distSq);
      const depth = CELL_CONTACT_DISTANCE - dist;
      // Normal from a's cell toward b's cell. When two cells sit exactly on
      // top of each other, fall back to the line between ship centres so the
      // push is still well-defined.
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
      const key = `${a.instanceId}|${b.instanceId}`;
      const existing = contacts.get(key);
      if (existing === undefined || depth > existing.depth) {
        contacts.set(key, {
          a,
          b,
          px: (wx + other.wx) / 2,
          py: (wy + other.wy) / 2,
          nx,
          ny,
          depth,
          // Filled in just before the impulse step, from the pre-impulse
          // velocities (see the resolve loop below).
          relVx: 0,
          relVy: 0,
        });
      }
    }
  }

  // Resolve in a stable order (by the unordered pair's instanceId key) so the
  // sequence of impulses is deterministic regardless of hash iteration order,
  // and return the same ordered list for the kinetic-damage step.
  const resolved = [...contacts.values()].sort((x, y) =>
    pairKey(x.a, x.b) < pairKey(y.a, y.b) ? -1 : pairKey(x.a, x.b) > pairKey(y.a, y.b) ? 1 : 0,
  );
  for (const contact of resolved) {
    // Snapshot the approach velocity before the impulse reflects it, so the
    // kinetic-damage step sees the energy of the collision, not the rebound.
    contact.relVx = contact.b.velX - contact.a.velX;
    contact.relVy = contact.b.velY - contact.a.velY;
    resolveContact(contact.a, contact.b, contact.px, contact.py, contact.nx, contact.ny, contact.depth);
  }
  return resolved;
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
