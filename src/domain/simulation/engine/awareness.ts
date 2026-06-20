/**
 * Awareness construction: per-observer contact computation, the comms-net
 * propagation, ghost-contact refresh, and the snapshot serialisation.
 */

import { segmentBlocked } from "@/domain/occluders";
import type { Disc } from "@/domain/occluders";
import type { AwarenessSnapshot, BattleAnomaly } from "@/schema/battle";

import { SIM } from "./config";
import { coverageShapes } from "./coverage";
import { emReceives } from "./em-reception";
import type { CommsLink, CommsUnit } from "./sensors";
import { aimDishes, commsUnitOperable, commsUnitsOf, contactThreat, linkForms } from "./sensors";
import type { Contact, GhostContact, SimShip } from "./types";

/**
 * Compute the live awareness for every ship this tick. Mutates each ship's
 * `ghosts` (refresh/decay/drop) and `awareness` (rebuilt) and each manned
 * dish's `dishAngle` in place, then returns the snapshot. See the phase header
 * for the determinism contract: zero rng draws, fixed iteration order, all ties
 * on stable ids.
 */
export function computeAwareness(
  ships: SimShip[],
  byId: Map<string, SimShip>,
  occluders: readonly Disc[],
  anomaly: BattleAnomaly,
): AwarenessSnapshot {
  // Alive ships in instanceId order — the canonical order for every pass.
  const alive = [...ships]
    .filter((s) => s.alive)
    .sort((p, q) => (p.instanceId < q.instanceId ? -1 : p.instanceId > q.instanceId ? 1 : 0));

  // (b) Per-ship direct detection. directContacts[observerId] = Contact[].
  //
  // Direct enemy iteration in instanceId order (the `alive` set is already
  // sorted), not a spatial-hash broad-phase: a sensor radius routinely spans a
  // large fraction of the arena, so the broad-phase bucket sweep would touch a
  // huge bucket block (radius/CELL_SIZE per axis) and is far slower than a plain
  // O(n^2) scan over the modest ship count. The result is identical and fully
  // deterministic.
  const directContacts = new Map<string, Contact[]>();
  const enemiesBySide = {
    attacker: alive.filter((s) => s.side === "defender"),
    defender: alive.filter((s) => s.side === "attacker"),
  };

  for (const observer of alive) {
    // Every ship is fog-gated through EM reception (Phase 9). A ship with no
    // sensor still receives an enemy's continuous emission out to its baseline
    // receiver's reach (the EM-grounded `SIM.visualLosRadius`); sensor cones add
    // gain that extends that reach to their `detectionRange` in the directions
    // they cover. There is no omniscient escape hatch — a sensorless ship is
    // genuinely myopic, modular or not. An occluder on the sight line blocks
    // reception regardless of strength or arc.
    const list: Contact[] = [];
    // enemiesBySide is keyed by the observer's own side and already sorted by
    // instanceId (it is a filter of the sorted `alive` set).
    const enemies =
      observer.side === "attacker" ? enemiesBySide.attacker : enemiesBySide.defender;
    for (const enemy of enemies) {
      if (segmentBlocked(observer.x, observer.y, enemy.x, enemy.y, occluders)) continue;
      if (!emReceives(observer, enemy, anomaly)) continue;
      list.push({
        enemyId: enemy.instanceId,
        x: enemy.x,
        y: enemy.y,
        facing: enemy.facing,
        threat: contactThreat(observer, enemy),
        origin: observer.instanceId,
      });
    }
    directContacts.set(observer.instanceId, list);
  }

  // (c) Per-side comms links. Gather comms units per side in (shipId, slotId)
  //     order, aim dishes, then form links over A.instanceId < B.instanceId
  //     unit pairs. A laser/dish needs manning (enforced in linkForms / aim).
  const links: CommsLink[] = [];
  const sides: ("attacker" | "defender")[] = ["attacker", "defender"];
  for (const side of sides) {
    const units: CommsUnit[] = [];
    for (const ship of alive) {
      if (ship.side !== side) continue;
      for (const unit of commsUnitsOf(ship)) units.push(unit);
    }
    // Sort by (shipId, slotId) for a deterministic aim + pairing order.
    units.sort((p, q) => {
      if (p.ship.instanceId !== q.ship.instanceId) {
        return p.ship.instanceId < q.ship.instanceId ? -1 : 1;
      }
      return p.module.slotId < q.module.slotId ? -1 : p.module.slotId > q.module.slotId ? 1 : 0;
    });
    aimDishes(units);

    // Pair units across distinct ships with A.instanceId < B.instanceId.
    // A laser/dish unit only counts as operable when manned; skip inoperable
    // units up front so they form no link.
    let pairBudget = SIM.maxCommsPairs;
    let cappedWarned = false;
    for (let i = 0; i < units.length; i++) {
      const ua = units[i];
      if (ua === undefined || !commsUnitOperable(ua)) continue;
      for (let j = i + 1; j < units.length; j++) {
        const ub = units[j];
        if (ub === undefined || !commsUnitOperable(ub)) continue;
        if (ua.ship.instanceId >= ub.ship.instanceId) continue; // A < B, distinct ships
        if (pairBudget <= 0) {
          if (!cappedWarned) {
            // One deterministic warning per run per side when the cap fires.
            console.warn(
              `computeAwareness: comms pair budget (${SIM.maxCommsPairs}) exceeded for ${side}; remaining pairs dropped`,
            );
            cappedWarned = true;
          }
          break;
        }
        pairBudget -= 1;
        if (linkForms(ua, ub, occluders)) {
          links.push({ side, a: ua, b: ub, type: ua.effect.commsType });
        }
      }
      if (pairBudget <= 0) break;
    }
  }

  // (e) Per-observer propagation: relay + bandwidth. Each ship gets its own
  //     pool seeded with its direct contacts; relays forward third-party
  //     contacts along links, bandwidth-capped, to a fixed point. There is NO
  //     side-wide union — two ships with no comms path share nothing.
  const liveByShip = propagateContacts(alive, directContacts, links);

  // (f) Per-ship awareness + ghost memory. The live pool drives ghost refresh;
  //     the merged awareness (live ∪ surviving ghosts) is what targeting reads.
  for (const ship of alive) {
    refreshGhostsAndAwareness(ship, liveByShip.get(ship.instanceId) ?? new Map(), byId);
  }
  // A ship that died is not in `alive`; its ghosts/awareness are irrelevant
  // (it never targets again) and its stale awareness map is harmless.

  return buildAwarenessSnapshot(alive, liveByShip, occluders, links);
}

/**
 * Union-find over instanceIds for the cluster pass: groups same-side ships that
 * are transitively comms-linked. Deterministic — find/union touch only the maps,
 * never iteration order.
 */
export function clusterComponents(
  sideShips: readonly SimShip[],
  sideLinks: readonly CommsLink[],
): Map<string, string[]> {
  const parent = new Map<string, string>();
  for (const s of sideShips) parent.set(s.instanceId, s.instanceId);
  const find = (x: string): string => {
    let root = x;
    for (;;) {
      const p = parent.get(root);
      if (p === undefined || p === root) break;
      root = p;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // Union by id order so the chosen root is deterministic.
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  };
  for (const link of sideLinks) union(link.a.ship.instanceId, link.b.ship.instanceId);

  const groups = new Map<string, string[]>();
  for (const s of sideShips) {
    const root = find(s.instanceId);
    const g = groups.get(root);
    if (g === undefined) groups.set(root, [s.instanceId]);
    else g.push(s.instanceId);
  }
  return groups;
}

/**
 * Bounded per-observer flood of contacts along comms links. EACH ship has its
 * own pool seeded with its direct contacts. A ship is a relay iff at least two
 * of its comms units appear in some link; only relays forward third-party
 * contacts (a leaf forwards nothing). Each forward is sorted by (threat desc,
 * enemyId asc) and truncated to the link's min bandwidth, then merged into the
 * neighbour's pool (dedup by enemyId, keep higher threat; tie on enemyId).
 * Repeats in id order to a fixed point. Mutates each ship's awareness pool via
 * the returned-into maps; the caller reads the settled pools in (f).
 */
export function propagateContacts(
  alive: readonly SimShip[],
  directContacts: ReadonlyMap<string, Contact[]>,
  links: readonly CommsLink[],
): Map<string, Map<string, Contact>> {
  // Pools: each ship's accumulating contact set, keyed by enemyId.
  const pool = new Map<string, Map<string, Contact>>();
  // receivedThirdParty[shipId]: contacts that arrived from elsewhere (origin
  // != this ship), the only contacts a relay may forward onward.
  const received = new Map<string, Map<string, Contact>>();
  for (const ship of alive) {
    const p = new Map<string, Contact>();
    for (const c of directContacts.get(ship.instanceId) ?? []) p.set(c.enemyId, c);
    pool.set(ship.instanceId, p);
    received.set(ship.instanceId, new Map());
  }

  // relay[shipId]: a ship with >= 2 of its comms units appearing in any link.
  // Count distinct (slotId) per ship across both link endpoints.
  const linkedSlots = new Map<string, Set<string>>();
  const adjacency = new Map<string, { neighbour: string; bandwidth: number }[]>();
  for (const ship of alive) {
    linkedSlots.set(ship.instanceId, new Set());
    adjacency.set(ship.instanceId, []);
  }
  for (const link of links) {
    const aId = link.a.ship.instanceId;
    const bId = link.b.ship.instanceId;
    linkedSlots.get(aId)?.add(link.a.module.slotId);
    linkedSlots.get(bId)?.add(link.b.module.slotId);
    const bandwidth = Math.min(link.a.effect.bandwidth, link.b.effect.bandwidth);
    adjacency.get(aId)?.push({ neighbour: bId, bandwidth });
    adjacency.get(bId)?.push({ neighbour: aId, bandwidth });
  }
  const isRelay = new Map<string, boolean>();
  for (const ship of alive) {
    isRelay.set(ship.instanceId, (linkedSlots.get(ship.instanceId)?.size ?? 0) >= 2);
  }

  // Sort each ship's neighbours by id for a deterministic processing order.
  for (const list of adjacency.values()) {
    list.sort((p, q) => (p.neighbour < q.neighbour ? -1 : p.neighbour > q.neighbour ? 1 : 0));
  }

  // Bounded flood to a fixed point: at most `alive.length` rounds (any contact
  // can traverse at most that many hops before the pools stop growing).
  const ids = alive.map((s) => s.instanceId);
  for (let round = 0; round < ids.length; round++) {
    let changed = false;
    for (const shipId of ids) {
      const direct = directContacts.get(shipId) ?? [];
      const relay = isRelay.get(shipId) === true;
      // Outbound = own direct contacts, plus received third-party only if relay.
      const outboundMap = new Map<string, Contact>();
      for (const c of direct) outboundMap.set(c.enemyId, c);
      if (relay) {
        for (const [enemyId, c] of received.get(shipId) ?? []) {
          const existing = outboundMap.get(enemyId);
          if (existing === undefined || c.threat > existing.threat) {
            outboundMap.set(enemyId, c);
          }
        }
      }
      // Sort outbound by (threat desc, enemyId asc) for the bandwidth cut.
      const outbound = [...outboundMap.values()].sort((p, q) => {
        if (q.threat !== p.threat) return q.threat - p.threat;
        return p.enemyId < q.enemyId ? -1 : p.enemyId > q.enemyId ? 1 : 0;
      });
      for (const { neighbour, bandwidth } of adjacency.get(shipId) ?? []) {
        const forwarded = outbound.slice(0, bandwidth);
        const nPool = pool.get(neighbour);
        const nRecv = received.get(neighbour);
        if (nPool === undefined || nRecv === undefined) continue;
        for (const c of forwarded) {
          const existing = nPool.get(c.enemyId);
          if (existing === undefined || c.threat > existing.threat) {
            nPool.set(c.enemyId, c);
            changed = true;
          }
          // Mark as third-party at the neighbour when the contact did not
          // originate there, so the neighbour (if a relay) can forward it on.
          if (c.origin !== neighbour) {
            const existingR = nRecv.get(c.enemyId);
            if (existingR === undefined || c.threat > existingR.threat) {
              nRecv.set(c.enemyId, c);
            }
          }
        }
      }
    }
    if (!changed) break;
  }

  // Return the settled live pools; the caller merges in ghost memory before
  // writing the final awareness each ship's targeting reads.
  return pool;
}

/**
 * Refresh a ship's ghost memory and final awareness from its settled live pool.
 * Live contacts refresh (or create) ghosts at full life; ghosts not currently
 * live decay one tick; ghosts that expire or whose target died are dropped.
 * The final awareness is live contacts plus surviving ghost positions, live
 * overriding a ghost for the same enemy. `ship.ghosts` is kept sorted by enemyId.
 */
export function refreshGhostsAndAwareness(
  ship: SimShip,
  live: ReadonlyMap<string, Contact>,
  byId: ReadonlyMap<string, SimShip>,
): void {
  const ghostById = new Map<string, GhostContact>();
  for (const g of ship.ghosts) ghostById.set(g.enemyId, g);

  // Refresh ghosts for every live contact.
  for (const [enemyId, c] of live) {
    ghostById.set(enemyId, {
      enemyId,
      x: c.x,
      y: c.y,
      facing: c.facing,
      threat: c.threat,
      ticksLeft: SIM.ghostFadeTicks,
    });
  }
  // Decay ghosts that are not currently live; drop expired or dead-target ones.
  const surviving: GhostContact[] = [];
  for (const [enemyId, g] of ghostById) {
    const enemyAlive = byId.get(enemyId)?.alive === true;
    if (!enemyAlive) continue; // target dead — forget it
    if (live.has(enemyId)) {
      surviving.push(g); // refreshed above at full life
      continue;
    }
    const ticksLeft = g.ticksLeft - 1;
    if (ticksLeft <= 0) continue; // expired
    surviving.push({ ...g, ticksLeft });
  }
  surviving.sort((p, q) =>
    p.enemyId < q.enemyId ? -1 : p.enemyId > q.enemyId ? 1 : 0,
  );
  ship.ghosts = surviving;

  // Final awareness = live ∪ ghost last-known (live overrides ghost).
  const finalAwareness = new Map<string, Contact>();
  for (const g of surviving) {
    finalAwareness.set(g.enemyId, {
      enemyId: g.enemyId,
      x: g.x,
      y: g.y,
      facing: g.facing,
      threat: g.threat,
      origin: ship.instanceId,
    });
  }
  for (const [enemyId, c] of live) finalAwareness.set(enemyId, c);
  ship.awareness = finalAwareness;
}

/** Build the deterministic AwarenessSnapshot from the settled per-ship state.
 *  Every array is sorted by its canonical key. */
export function buildAwarenessSnapshot(
  alive: readonly SimShip[],
  liveByShip: ReadonlyMap<string, Map<string, Contact>>,
  occluders: readonly Disc[],
  links: readonly CommsLink[],
): AwarenessSnapshot {
  // Occluders: emit verbatim (computeOccluders already returns a fixed order).
  const snapOccluders = occluders.map((d) => ({ x: d.x, y: d.y, r: d.r }));

  // Clusters per side from the link union-find.
  const clusters: AwarenessSnapshot["clusters"] = [];
  const sides: ("attacker" | "defender")[] = ["attacker", "defender"];
  for (const side of sides) {
    const sideShips = alive.filter((s) => s.side === side);
    const sideLinks = links.filter((l) => l.side === side);
    const groups = clusterComponents(sideShips, sideLinks);
    const byInstance = new Map(sideShips.map((s) => [s.instanceId, s]));
    for (const memberIds of groups.values()) {
      const sortedMembers = [...memberIds].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));
      const id = `${side}|${sortedMembers.join(",")}`;
      const coverage = sortedMembers.flatMap((mid) => {
        // mid came from this side's union-find over sideShips, so the lookup
        // always resolves; the explicit guard documents that invariant.
        const member = byInstance.get(mid);
        if (member === undefined) {
          throw new Error(`cluster member ${mid} missing from side ${side}`);
        }
        return coverageShapes(member);
      });
      clusters.push({ id, side, memberIds: sortedMembers, coverage });
    }
  }
  clusters.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));

  // Contacts (live fixes only) + ghosts (surviving memories) per observer.
  const contacts: AwarenessSnapshot["contacts"] = [];
  const ghosts: AwarenessSnapshot["ghosts"] = [];
  for (const ship of alive) {
    const live = liveByShip.get(ship.instanceId) ?? new Map();
    for (const [enemyId, c] of live) {
      contacts.push({
        side: ship.side,
        observerId: ship.instanceId,
        enemyId,
        x: c.x,
        y: c.y,
      });
    }
    for (const g of ship.ghosts) {
      ghosts.push({
        side: ship.side,
        observerId: ship.instanceId,
        enemyId: g.enemyId,
        x: g.x,
        y: g.y,
        ticksLeft: g.ticksLeft,
      });
    }
  }
  contacts.sort(awarenessRowOrder);
  ghosts.sort(awarenessRowOrder);

  // Links, sorted by (side, aId, aSlot, bId, bSlot).
  const snapLinks: AwarenessSnapshot["links"] = links.map((l) => ({
    side: l.side,
    aId: l.a.ship.instanceId,
    aSlot: l.a.module.slotId,
    bId: l.b.ship.instanceId,
    bSlot: l.b.module.slotId,
    type: l.type,
  }));
  snapLinks.sort((p, q) => {
    if (p.side !== q.side) return p.side < q.side ? -1 : 1;
    if (p.aId !== q.aId) return p.aId < q.aId ? -1 : 1;
    if (p.aSlot !== q.aSlot) return p.aSlot < q.aSlot ? -1 : 1;
    if (p.bId !== q.bId) return p.bId < q.bId ? -1 : 1;
    return p.bSlot < q.bSlot ? -1 : p.bSlot > q.bSlot ? 1 : 0;
  });

  // Dish angles for every manned dish, sorted by (shipId, slotId).
  const dishAngles: AwarenessSnapshot["dishAngles"] = [];
  for (const ship of alive) {
    for (const unit of commsUnitsOf(ship)) {
      if (unit.effect.commsType !== "dish") continue;
      if (!unit.module.manned) continue;
      dishAngles.push({ shipId: ship.instanceId, slotId: unit.module.slotId, angle: unit.module.dishAngle });
    }
  }
  dishAngles.sort((p, q) => {
    if (p.shipId !== q.shipId) return p.shipId < q.shipId ? -1 : 1;
    return p.slotId < q.slotId ? -1 : p.slotId > q.slotId ? 1 : 0;
  });

  return { occluders: snapOccluders, clusters, contacts, ghosts, links: snapLinks, dishAngles };
}

/** Canonical row order for contacts/ghosts: (side, observerId, enemyId). */
export function awarenessRowOrder(
  p: { side: string; observerId: string; enemyId: string },
  q: { side: string; observerId: string; enemyId: string },
): number {
  if (p.side !== q.side) return p.side < q.side ? -1 : 1;
  if (p.observerId !== q.observerId) return p.observerId < q.observerId ? -1 : 1;
  return p.enemyId < q.enemyId ? -1 : p.enemyId > q.enemyId ? 1 : 0;
}
