/**
 * Awareness construction: per-observer contact computation, the comms-net
 * propagation, ghost-contact refresh, and the snapshot serialisation.
 */

import { segmentBlocked } from "@/domain/occluders";
import type { Disc } from "@/domain/occluders";
import type { AwarenessSnapshot, BattleAnomalyKind } from "@/schema/battle";

import { SIM } from "./config";
import { fastHypot } from "./hypot";
import { coverageShapes } from "./coverage";
import { mediumDazzleContribution, mediumReceives } from "./em-reception";
import { SATURATION_DECAY_FACTOR } from "./em-anchors";
import { collectMediumEmissions } from "./medium-emissions";
import type { Emission } from "./emissions";
import type { ArenaMedium } from "./medium-setup";
import type { CommsLink, CommsUnit, SensorUnit } from "./sensors";
import { aimDishes, commsUnitOperable, commsUnitsOf, fillSensorUnits, linkForms } from "./sensors";
import type { Contact, GhostContact, SimShip } from "./types";
import { buildDirectContacts } from "./awareness-direct";

/** Reusable scratch for the whole awareness phase, held on
 *  `EngineState.awarenessScratch`: every per-tick Map/array is cleared-and-reused
 *  across ticks. Per-ship inner structures are reused by instanceId (get-or-
 *  create + clear); a dead ship's entry is left stale (never read — only alive
 *  ships are iterated — and bounded by the battle's ship count). Each buffer is
 *  cleared and refilled each tick IN THE SAME insertion order as the one-tick
 *  allocation it replaces, so Map iteration order stays byte-identical. Not
 *  captured on the checkpoint (a resume re-derives awareness on its first tick). */
export interface AwarenessScratch {
  poolByShip: Map<string, Map<string, Contact>>;
  receivedByShip: Map<string, Map<string, Contact>>;
  linkedSlotsByShip: Map<string, Set<string>>;
  adjacencyByShip: Map<string, { neighbour: string; bandwidth: number }[]>;
  isRelay: Map<string, boolean>;
  outboundMap: Map<string, Contact>;
  outbound: Contact[];
  forwarded: Contact[];
  ids: string[];
  // computeAwareness-level buffers (see interface doc above).
  alive: SimShip[];
  enemiesBySide: { attacker: SimShip[]; defender: SimShip[] };
  dazzleAccum: Map<string, number>;
  directContacts: Map<string, Contact[]>;
  directContactLists: Map<string, Contact[]>;
  ghostById: Map<string, GhostContact>;
  sideByObserver: Map<string, "attacker" | "defender">;
  clusterParent: Map<string, string>;
  clusterGroups: Map<string, string[]>;
  // Per-observer sensor units, built once per tick, shared by the direct and
  // medium passes (each previously called `sensorUnitsOf` independently).
  sensorsByShip: Map<string, SensorUnit[]>;
  // Per-ship final-awareness Map, cleared-and-reused each tick (replaces a
  // fresh `new Map` per ship per tick in refreshGhostsAndAwareness).
  awarenessByShip: Map<string, Map<string, Contact>>;
}

export function freshAwarenessScratch(): AwarenessScratch {
  return {
    poolByShip: new Map(),
    receivedByShip: new Map(),
    linkedSlotsByShip: new Map(),
    adjacencyByShip: new Map(),
    isRelay: new Map(),
    outboundMap: new Map(),
    outbound: [],
    forwarded: [],
    ids: [],
    alive: [],
    enemiesBySide: { attacker: [], defender: [] },
    dazzleAccum: new Map(),
    directContacts: new Map(),
    directContactLists: new Map(),
    ghostById: new Map(),
    sideByObserver: new Map(),
    clusterParent: new Map(),
    clusterGroups: new Map(),
    sensorsByShip: new Map(),
    awarenessByShip: new Map(),
  };
}

/**
 * Compute the live awareness for every ship this tick. Mutates each ship's
 * `ghosts` (refresh/decay/drop) and `awareness` (rebuilt) and each manned
 * dish's `dishAngle` in place, then returns the snapshot. See the phase header
 * for the determinism contract: zero rng draws, fixed iteration order, all ties
 * on stable ids.
 *
 * Medium-cell radiation (battlefield-medium phase 4): when `medium` and `tick`
 * are supplied, a continuous inverse-square reception pass runs after the
 * ship-ship pass. The contacts it forms are TRANSIENT — recorded in the
 * snapshot's `contacts` so the renderer/AI can show the EM event, but kept OUT
 * of the ship-targeting `directContacts` set and ghost memory. A medium
 * contact's `enemyId` is the cell's synthetic id (`medium#<col>_<row>`, never a
 * real ship), so targeting's `visibleEnemyViews` (which resolves `enemyId`
 * against the real-ship map) simply skips it — detecting a burn does not give a
 * weapons lock on a hull that is not there. That is the honest physics: the
 * radiation is detectable, the hull is not. Iteration is observer (instanceId)
 * outer, emission (row-major) inner, for deterministic contact order.
 */
export function computeAwareness(
  ships: SimShip[],
  byId: Map<string, SimShip>,
  occluders: readonly Disc[],
  anomalies: readonly BattleAnomalyKind[],
  medium?: ArenaMedium,
  tick?: number,
  /**
   * The medium-cell emissions for this tick, when the caller has already
   * computed them (the tick loop calls {@link collectMediumEmissions} once and
   * shares the result with `rebuildEmissions`). When omitted, this function
   * collects its own copy via {@link collectMediumContacts} — so it still works
   * standalone. Same array, same row-major order, byte-identical contacts.
   */
  precomputedEmissions?: readonly Emission[],
  /**
   * Reusable propagation scratch (the per-ship pool/received/linkedSlots/
   * adjacency Maps and the inner-loop buffers), held on `EngineState` so they
   * are cleared-and-reused across ticks. When omitted a fresh one is allocated
   * (tests); production passes `state.awarenessScratch`.
   */
  scratch?: AwarenessScratch,
): AwarenessSnapshot {
  // Normalise the reusable scratch: production passes state.awarenessScratch
  // (cleared + refilled each tick); a standalone/test call gets a fresh one.
  const scr = scratch ?? freshAwarenessScratch();

  // Alive ships in instanceId order — the canonical order for every pass.
  // Cleared + refilled each tick; the instanceId sort is total (ids unique), so
  // byte-identical to the discarded spread+filter without the per-tick churn.
  const alive = scr.alive;
  alive.length = 0;
  for (const s of ships) if (s.alive) alive.push(s);
  alive.sort((p, q) => (p.instanceId < q.instanceId ? -1 : p.instanceId > q.instanceId ? 1 : 0));

  // (a) Decay every alive ship's carried sensor saturation ONCE, before any
  //     floor is read this tick (battlefield-medium phase 5 dazzle). The
  //     saturation accumulated during tick T-1's reception pass is what raises
  //     the floor on THIS tick; decaying it here applies the recovery timescale
  //     ({@link SATURATION_DECAY_FACTOR}) uniformly. Order-independent (each
  //     ship decays from its own carried value), but done in the canonical
  //     instanceId order for consistency with the rest of the phase.
  // Per-observer sensor units, built once this tick and shared between the
  // direct (b) and medium (g) passes (each previously called `sensorUnitsOf`
  // independently with identical results). Inner array pooled by instanceId via
  // `fillSensorUnits`, mirroring `directContactLists`; lossless, halves the scan.
  const sensorsByShip = scr.sensorsByShip;
  sensorsByShip.clear();
  for (const ship of alive) {
    ship.sensorSaturation *= SATURATION_DECAY_FACTOR;
    let pooled = sensorsByShip.get(ship.instanceId);
    if (pooled === undefined) {
      pooled = [];
      sensorsByShip.set(ship.instanceId, pooled);
    }
    fillSensorUnits(ship, pooled);
  }
  // Per-observer dazzle accumulator: the total boost this tick's received
  // emissions contribute, added to the (already-decayed) saturation AFTER the
  // reception passes so it raises the floor on subsequent ticks. Built in
  // instanceId (observer) order, then emission order inside — deterministic.
  const dazzleAccum = scr.dazzleAccum;
  dazzleAccum.clear();
  for (const ship of alive) dazzleAccum.set(ship.instanceId, 0);

  // (b) Per-ship direct detection. directContacts[observerId] = Contact[].
  //
  // Direct enemy iteration in instanceId order (the `alive` set is already
  // sorted), not a spatial-hash broad-phase: a sensor radius routinely spans a
  // large fraction of the arena, so the broad-phase bucket sweep would touch a
  // large bucket block (radius/WORLD_BUCKET_M per axis) and is far slower than a plain
  // O(n^2) scan over the modest ship count. The result is identical and fully
  // deterministic.
  // Enemy-side arrays refilled in `alive` order each tick (attacker faces
  // defenders, defender faces attackers), matching the discarded filter order.
  const enemiesBySide = scr.enemiesBySide;
  enemiesBySide.attacker.length = 0;
  enemiesBySide.defender.length = 0;
  for (const s of alive) {
    if (s.side === "defender") enemiesBySide.attacker.push(s);
    else enemiesBySide.defender.push(s);
  }
  // (b) Per-observer direct detection (see `awareness-direct.ts`). Each alive
  //     observer scans its enemy side, accumulates sensor dazzle for every
  //     non-occluded enemy, and forms a contact for every enemy it receives.
  //     An anomaly-free strict-upper-bound early-out skips the full reception
  //     path for pairs provably below every downstream floor (far-apart pairs
  //     early in a battle) — lossless. `directContacts` and the per-observer
  //     inner Contact[] pool are cleared-and-reused entries on `scr`.
  const directContacts = buildDirectContacts(
    alive,
    occluders,
    anomalies,
    dazzleAccum,
    enemiesBySide,
    scr,
  );

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
  const liveByShip = propagateContacts(alive, directContacts, links, scr);

  // (f) Per-ship awareness + ghost memory. The live pool drives ghost refresh;
  //     the merged awareness (live ∪ surviving ghosts) is what targeting reads.
  for (const ship of alive) {
    refreshGhostsAndAwareness(
      ship,
      liveByShip.get(ship.instanceId) ?? new Map<string, Contact>(),
      byId,
      scr.ghostById,
      scr.awarenessByShip,
    );
  }
  // A ship that died is not in `alive`; its ghosts/awareness are irrelevant
  // (it never targets again) and its stale awareness map is harmless.

  // (g) Continuous inverse-square medium-cell reception (phase 4). TRANSIENT
  //     contacts only (snapshot, not `directContacts`/ghosts): a medium
  //     contact's synthetic enemyId never resolves to a real ship, so targeting
  //     skips it. Observer order is instanceId, emission order is row-major;
  //     occluders block as in the ship-ship pass. Skipped when no medium. See
  //     the phase header and {@link collectMediumContacts} for the full physics.
  const mediumContacts = collectMediumContacts(
    alive,
    medium,
    tick,
    occluders,
    anomalies,
    dazzleAccum,
    sensorsByShip,
    precomputedEmissions,
  );

  // (h) Write the per-observer dazzle boost into the carried saturation AFTER
  //     both reception passes (phase 5). This tick's floor already used the
  //     decayed saturation; the boost raises the floor on subsequent ticks.
  //     instanceId order so two same-seed runs reach byte-identical state.
  for (const ship of alive) {
    const boost = dazzleAccum.get(ship.instanceId) ?? 0;
    ship.sensorSaturation += boost;
  }

  return buildAwarenessSnapshot(alive, liveByShip, occluders, links, mediumContacts, scr);
}

/**
 * The continuous inverse-square medium-cell reception pass. For each observer
 * (instanceId order) test each medium-cell emission (row-major) via
 * {@link mediumReceives}; an occluder on the observer→cell segment blocks
 * reception. Returns contacts sorted by (observerId, enemyId); empty when no
 * medium/tick/emissions. Contacts carry the cell's synthetic `medium#<col>_<row>`
 * enemyId and world position, are snapshot-only (never `directContacts`/ghosts),
 * so targeting and ghost refresh are undisturbed. See the phase header for the
 * full transient-contact physics.
 */
function collectMediumContacts(
  alive: readonly SimShip[],
  medium: ArenaMedium | undefined,
  tick: number | undefined,
  occluders: readonly Disc[],
  anomalies: readonly BattleAnomalyKind[],
  dazzleAccum: Map<string, number>,
  /** Per-observer sensor units precomputed by {@link computeAwareness} and
   *  shared with the direct-detection pass. Each observer in `alive` has an
   *  entry; contents/order match `sensorUnitsOf`. */
  sensorsByShip: ReadonlyMap<string, SensorUnit[]>,
  precomputedEmissions?: readonly Emission[],
): Contact[] {
  if (medium === undefined || tick === undefined) return [];
  const mediumEmissions = precomputedEmissions ?? collectMediumEmissions(medium);
  if (mediumEmissions.length === 0) return [];
  const out: Contact[] = [];
  for (const observer of alive) {
    // Precomputed per observer this tick; `observer` ∈ `alive` and
    // `sensorsByShip` is built from that set, so the entry is always present.
    const observerSensors = sensorsByShip.get(observer.instanceId)!;
    // Hoist the dazzle accumulator into a local scalar: identical emission
    // (row-major) iteration keeps the FP sum byte-identical, and the Map is
    // written once after the loop. Seeded to 0 for every alive ship and only
    // set (never deleted), so the read is always defined.
    let observerDazzle = dazzleAccum.get(observer.instanceId)!;
    for (const emission of mediumEmissions) {
      // An occluder between the observer and the radiating cell blocks the
      // light path, exactly as it blocks continuous ship-ship reception.
      if (segmentBlocked(observer.x, observer.y, emission.x, emission.y, occluders)) continue;
      // Sensor dazzle (phase 5): a bright medium-cell emission raises the
      // observer's saturation, source-agnostic. This pass only ADDS to entries
      // the main loop already seeded.
      observerDazzle += mediumDazzleContribution(observer, emission);
      if (mediumReceives(observer, emission, tick, anomalies, observerSensors) === undefined) continue;
      out.push({
        // Synthetic cell id; never matches a real ship instanceId, so
        // targeting's visibleEnemyViews skips it (no hull to lock).
        enemyId: emission.sourceId,
        // The fix is the cell's world position (a cell is stationary, so no
        // light-lag offset applies).
        x: emission.x,
        y: emission.y,
        // A radiating cell has no facing; neutral 0 keeps the snapshot shape
        // uniform with ship contacts.
        facing: 0,
        // Distance-dominated; with no underlying ship cost the score is just
        // `-dist` (nearer cells score higher), keeping row order consistent.
        threat: -fastHypot(emission.x - observer.x, emission.y - observer.y),
        origin: observer.instanceId,
      });
    }
    dazzleAccum.set(observer.instanceId, observerDazzle);
  }
  out.sort((p, q) => {
    if (p.origin !== q.origin) return p.origin < q.origin ? -1 : 1;
    return p.enemyId < q.enemyId ? -1 : p.enemyId > q.enemyId ? 1 : 0;
  });
  return out;
}

/** Union-find over instanceIds for the cluster pass: groups same-side ships
 *  that are transitively comms-linked. Deterministic — find/union touch only the
 *  maps, never iteration order. */
export function clusterComponents(
  sideShips: readonly SimShip[],
  sideLinks: readonly CommsLink[],
  /**
   * Reusable scratch for the union-find Maps (held on
   * `EngineState.awarenessScratch`), cleared and rebuilt per side per tick.
   * Omitted → fresh allocation (standalone/test).
   */
  scratch?: AwarenessScratch,
): Map<string, string[]> {
  const parent = scratch?.clusterParent ?? new Map<string, string>();
  parent.clear();
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

  const groups = scratch?.clusterGroups ?? new Map<string, string[]>();
  groups.clear();
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
 * contacts. Each forward is sorted by (threat desc, enemyId asc) and truncated
 * to the link's min bandwidth, then merged into the neighbour's pool (dedup by
 * enemyId, keep higher threat; tie on enemyId). Repeats in id order to a fixed
 * point; the caller reads the settled pools in (f).
 */
export function propagateContacts(
  alive: readonly SimShip[],
  directContacts: ReadonlyMap<string, Contact[]>,
  links: readonly CommsLink[],
  scratch?: AwarenessScratch,
): Map<string, Map<string, Contact>> {
  // Per-ship structures are reused across ticks when a scratch is supplied
  // (get-or-create + clear); otherwise allocated fresh (the standalone/test
  // path). The returned `pool` is read within the same tick and discarded, so
  // reusing its buffers is safe.
  const pool = scratch?.poolByShip ?? new Map<string, Map<string, Contact>>();
  // receivedThirdParty[shipId]: contacts that arrived from elsewhere (origin
  // != this ship), the only contacts a relay may forward onward.
  const received = scratch?.receivedByShip ?? new Map<string, Map<string, Contact>>();
  for (const ship of alive) {
    let p = pool.get(ship.instanceId);
    if (p === undefined) {
      p = new Map();
      pool.set(ship.instanceId, p);
    } else {
      p.clear();
    }
    for (const c of directContacts.get(ship.instanceId) ?? []) p.set(c.enemyId, c);
    let r = received.get(ship.instanceId);
    if (r === undefined) {
      r = new Map();
      received.set(ship.instanceId, r);
    } else {
      r.clear();
    }
  }

  // relay[shipId]: a ship with >= 2 of its comms units appearing in any link.
  const linkedSlots = scratch?.linkedSlotsByShip ?? new Map<string, Set<string>>();
  const adjacency = scratch?.adjacencyByShip ?? new Map<string, { neighbour: string; bandwidth: number }[]>();
  for (const ship of alive) {
    let ls = linkedSlots.get(ship.instanceId);
    if (ls === undefined) {
      ls = new Set();
      linkedSlots.set(ship.instanceId, ls);
    } else {
      ls.clear();
    }
    let adj = adjacency.get(ship.instanceId);
    if (adj === undefined) {
      adj = [];
      adjacency.set(ship.instanceId, adj);
    } else {
      adj.length = 0;
    }
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
  const isRelay = scratch?.isRelay ?? new Map<string, boolean>();
  isRelay.clear();
  for (const ship of alive) {
    isRelay.set(ship.instanceId, (linkedSlots.get(ship.instanceId)?.size ?? 0) >= 2);
  }

  // Sort each ship's neighbours by id for a deterministic processing order.
  for (const list of adjacency.values()) {
    list.sort((p, q) => (p.neighbour < q.neighbour ? -1 : p.neighbour > q.neighbour ? 1 : 0));
  }

  // Bounded flood to a fixed point: at most `alive.length` rounds (any contact
  // can traverse at most that many hops before the pools stop growing).
  const ids = scratch?.ids ?? [];
  ids.length = 0;
  for (const s of alive) ids.push(s.instanceId);
  // Inner-loop buffers, reused across every ship/round iteration when pooled.
  const outboundMap = scratch?.outboundMap ?? new Map<string, Contact>();
  const outbound = scratch?.outbound ?? [];
  const forwarded = scratch?.forwarded ?? [];
  for (let round = 0; round < ids.length; round++) {
    let changed = false;
    for (const shipId of ids) {
      const direct = directContacts.get(shipId) ?? [];
      const relay = isRelay.get(shipId) === true;
      // Outbound = own direct contacts, plus received third-party only if relay.
      outboundMap.clear();
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
      outbound.length = 0;
      for (const c of outboundMap.values()) outbound.push(c);
      outbound.sort((p, q) => {
        if (q.threat !== p.threat) return q.threat - p.threat;
        return p.enemyId < q.enemyId ? -1 : p.enemyId > q.enemyId ? 1 : 0;
      });
      for (const { neighbour, bandwidth } of adjacency.get(shipId) ?? []) {
        forwarded.length = 0;
        for (let i = 0; i < bandwidth && i < outbound.length; i += 1) {
          forwarded.push(outbound[i]!);
        }
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

  return pool;
}

/**
 * Refresh a ship's ghost memory and final awareness from its settled live pool.
 * Live contacts refresh (or create) ghosts at full life; non-live ghosts decay
 * one tick; expired or dead-target ghosts are dropped. Final awareness is live
 * contacts plus surviving ghost positions (live overrides ghost for the same
 * enemy). `ship.ghosts` is kept sorted by enemyId.
 */
export function refreshGhostsAndAwareness(
  ship: SimShip,
  live: ReadonlyMap<string, Contact>,
  byId: ReadonlyMap<string, SimShip>,
  /**
   * Reusable per-ship ghost-by-id Map (held on `EngineState.awarenessScratch`),
   * cleared and rebuilt per ship in the same insertion order as the discarded
   * one-call Map. Omitted → fresh allocation (standalone/test).
   */
  ghostByIdScratch?: Map<string, GhostContact>,
  /** Reusable per-ship final-awareness Map (on
   *  `EngineState.awarenessScratch.awarenessByShip`), cleared and refilled each
   *  tick in the same insertion order (surviving ghosts by enemyId, then live
   *  contacts) as the discarded `new Map`, then assigned back onto
   *  `ship.awareness`. Omitted → fresh allocation (standalone/test). */
  awarenessByShipScratch?: Map<string, Map<string, Contact>>,
): void {
  const ghostById = ghostByIdScratch ?? new Map<string, GhostContact>();
  ghostById.clear();
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

  // Final awareness = live ∪ ghost last-known (live overrides ghost). The Map
  // is pooled per ship, cleared+refilled each tick in the same insertion order
  // (surviving ghosts by enemyId, then live contacts) so iteration order is
  // byte-identical to the discarded fresh Map; the same instance is assigned
  // back onto `ship.awareness`.
  let finalAwareness = awarenessByShipScratch?.get(ship.instanceId);
  if (finalAwareness === undefined) {
    finalAwareness = new Map<string, Contact>();
    if (awarenessByShipScratch !== undefined) {
      awarenessByShipScratch.set(ship.instanceId, finalAwareness);
    }
  } else {
    finalAwareness.clear();
  }
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
 *  Every array is sorted by its canonical key. The optional `mediumContacts`
 *  (transient phase-4 detections of radiating cells) are appended to the
 *  snapshot's `contacts` with the observer's side resolved from the live set. */
export function buildAwarenessSnapshot(
  alive: readonly SimShip[],
  liveByShip: ReadonlyMap<string, Map<string, Contact>>,
  occluders: readonly Disc[],
  links: readonly CommsLink[],
  mediumContacts: readonly Contact[] = [],
  /**
   * Reusable scratch (held on `EngineState.awarenessScratch`) carrying the
   * snapshot's transient observer→side Map and the cluster union-find Maps,
   * cleared and refilled each tick. Omitted → fresh allocation (standalone/test).
   * The snapshot's RETURNED arrays are retained by the caller and are NOT pooled.
   */
  scratch?: AwarenessScratch,
): AwarenessSnapshot {
  // Occluders: emit verbatim (computeOccluders already returns a fixed order).
  const snapOccluders = occluders.map((d) => ({ x: d.x, y: d.y, r: d.r }));

  // Same-side partitions of `alive` and `links`, each built once in a single
  // pass instead of a `.filter` per side. Push-partitioning retains original
  // order (identical to `.filter`), so union-find and byInstance orders match.
  const attackerShips: SimShip[] = [];
  const defenderShips: SimShip[] = [];
  const attackerLinks: CommsLink[] = [];
  const defenderLinks: CommsLink[] = [];
  for (const s of alive) {
    (s.side === "attacker" ? attackerShips : defenderShips).push(s);
  }
  for (const l of links) {
    (l.side === "attacker" ? attackerLinks : defenderLinks).push(l);
  }
  // Clusters per side from the link union-find.
  const clusters: AwarenessSnapshot["clusters"] = [];
  const sides: ("attacker" | "defender")[] = ["attacker", "defender"];
  for (const side of sides) {
    const sideShips = side === "attacker" ? attackerShips : defenderShips;
    const sideLinks = side === "attacker" ? attackerLinks : defenderLinks;
    const groups = clusterComponents(sideShips, sideLinks, scratch);
    const byInstance = new Map<string, SimShip>();
    for (const s of sideShips) byInstance.set(s.instanceId, s);
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
  // Observer → side lookup, so the transient medium contacts below can carry
  // their observer's side without a second pass over the live set. Cleared +
  // re-seeded in `alive` order each tick (matches the discarded one-tick Map).
  const sideByObserver = scratch?.sideByObserver ?? new Map<string, "attacker" | "defender">();
  sideByObserver.clear();
  for (const ship of alive) {
    const live = liveByShip.get(ship.instanceId) ?? new Map<string, Contact>();
    sideByObserver.set(ship.instanceId, ship.side);
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
  // Transient medium-cell contacts (phase 4): light-lagged detections of
  // radiating cells. Appended after the ship-ship contacts; a single sort by
  // (side, observerId, enemyId) folds them into canonical row order alongside
  // the ship contacts. An observer that died this tick is absent from
  // `sideByObserver`, so its medium contacts (if any were collected before death
  // — they cannot be, `collectMediumContacts` iterates only `alive`) are dropped.
  for (const c of mediumContacts) {
    const side = sideByObserver.get(c.origin);
    if (side === undefined) continue;
    contacts.push({
      side,
      observerId: c.origin,
      enemyId: c.enemyId,
      x: c.x,
      y: c.y,
    });
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
