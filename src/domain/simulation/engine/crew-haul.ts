/**
 * Crew resource hauling: the power and ammo runs crew make between reactors /
 * magazines and the stations that need them, plus the hardwire-fed refill that
 * parallels physical hauling. Split from `crew.ts` so each file stays under the
 * file-length guard.
 */

import type { SimCrew } from "../types";

import { SIM } from "./config";
import { abandonHaul } from "./crew";
import { aliveCellMap, crewCellKey, findCrewPath, modulesBySlot } from "./crew-pathfinding";
import type { SimModule, SimShip } from "./types";

/**
 * Refill every power-drawing module that has a live power hardwire to an alive
 * reactor, to a full local buffer, regardless of distance. This is the explicit,
 * any-distance counterpart to the proximity wiring in `rechargeAndConsume`: each
 * link names one reactor, and the conduit is dead the moment that reactor (or the
 * sink) dies. A ship with no power hardwires never enters the loop body (every
 * module's `hardwireSinks` is omitted), so its charge state is unchanged.
 *
 * A reactor produces power every tick, so an output divided across several
 * hardwired sinks still tops each one to full — there is no finite store to
 * apportion the way ammo magazines need. Iterated in module (col, row) array
 * order; the result is order-independent (each sink is set, not accumulated), so
 * determinism holds.
 */
export function refillHardwiredPower(ship: SimShip): void {
  if (ship.modules === undefined) return;
  const bySlot = modulesBySlot(ship);
  for (const sink of ship.modules) {
    if (sink.powerDraw <= 0 || !sink.alive) continue;
    if (sink.hardwireSinks === undefined) continue;
    for (const link of sink.hardwireSinks) {
      if (link.resource !== "power") continue;
      const source = bySlot.get(link.sourceSlotId);
      if (source !== undefined && source.alive && source.effect.kind === "power") {
        sink.charge = SIM.chargeBufferMax;
        break;
      }
    }
  }
}

/**
 * The set of cell keys within `powerWiringRadius` walkable steps of any alive
 * reactor, by multi-source breadth-first search over the alive cells. Used to
 * decide which power-drawing modules are hard-wired (free charge) versus
 * crew-fed. Deterministic: BFS frontier order does not affect the resulting set,
 * and the set membership is all the caller reads.
 */
export function reactorWiringReach(ship: SimShip): Set<string> {
  const reach = new Set<string>();
  if (ship.modules === undefined) return reach;
  const cells = aliveCellMap(ship);
  // Seed the frontier with every alive reactor cell at distance 0.
  let frontier: { col: number; row: number }[] = [];
  for (const m of ship.modules) {
    if (m.alive && m.effect.kind === "power") {
      const k = crewCellKey(m.col, m.row);
      if (!reach.has(k)) {
        reach.add(k);
        frontier.push({ col: m.col, row: m.row });
      }
    }
  }
  for (let depth = 0; depth < SIM.powerWiringRadius && frontier.length > 0; depth += 1) {
    const next: { col: number; row: number }[] = [];
    for (const cell of frontier) {
      const neighbours = [
        { col: cell.col - 1, row: cell.row },
        { col: cell.col + 1, row: cell.row },
        { col: cell.col, row: cell.row - 1 },
        { col: cell.col, row: cell.row + 1 },
      ];
      for (const n of neighbours) {
        const k = crewCellKey(n.col, n.row);
        if (!cells.has(k) || reach.has(k)) continue;
        reach.add(k);
        next.push(n);
      }
    }
    frontier = next;
  }
  return reach;
}

/** Arrival handling for an ammo run: pick up rounds at the magazine, then
 *  deposit them at the dry weapon (clamped to capacity), conserving the amount
 *  carried end to end. */
export function resolveAmmoArrival(
  ship: SimShip,
  crew: SimCrew,
  bySlot: ReadonlyMap<string, SimModule>,
  cells: ReadonlyMap<string, SimModule>,
): void {
  if (crew.carrying === undefined) {
    const source = crew.targetSlotId !== undefined ? bySlot.get(crew.targetSlotId) : undefined;
    const sink = crew.haulSinkSlotId !== undefined ? bySlot.get(crew.haulSinkSlotId) : undefined;
    if (
      source === undefined ||
      source.ammoStored <= 0 ||
      sink === undefined ||
      !sink.alive ||
      sink.effect.kind !== "weapon"
    ) {
      abandonHaul(crew);
      return;
    }
    const carried = Math.min(SIM.ammoRunAmount, source.ammoStored, ammoShortfall(sink));
    if (carried <= 0) {
      abandonHaul(crew);
      return;
    }
    source.ammoStored -= carried;
    crew.carrying = "ammo";
    crew.carryAmount = carried;
    const path = findCrewPath(ship, cells, { col: crew.col, row: crew.row }, { col: sink.col, row: sink.row });
    if (path === undefined) {
      // Route severed after pickup: drop the rounds back and give up.
      source.ammoStored += carried;
      abandonHaul(crew);
      return;
    }
    crew.targetSlotId = sink.slotId;
    crew.path = path;
    crew.pathIndex = 1;
    return;
  }

  // At the sink weapon, carrying rounds: deposit exactly what was carried,
  // clamped to capacity. The pickup never takes more than the weapon was short
  // of and the weapon can only have fired since, so the clamp never discards.
  const sink = crew.targetSlotId !== undefined ? bySlot.get(crew.targetSlotId) : undefined;
  const carried = crew.carryAmount; // set with carrying at pickup, so defined here
  if (carried !== undefined && sink !== undefined && sink.alive && sink.effect.kind === "weapon") {
    const cap = sink.effect.ammoCapacity;
    if (cap !== undefined) sink.ammo = Math.min(cap, sink.ammo + carried);
  }
  abandonHaul(crew);
}

/** Arrival handling for a power run: pick up a charge packet at the reactor,
 *  then deposit it into the starved module's local buffer (clamped to the buffer
 *  ceiling), conserving the amount carried. */
export function resolvePowerArrival(
  ship: SimShip,
  crew: SimCrew,
  bySlot: ReadonlyMap<string, SimModule>,
  cells: ReadonlyMap<string, SimModule>,
): void {
  if (crew.carrying === undefined) {
    const source = crew.targetSlotId !== undefined ? bySlot.get(crew.targetSlotId) : undefined;
    const sink = crew.haulSinkSlotId !== undefined ? bySlot.get(crew.haulSinkSlotId) : undefined;
    if (
      source === undefined ||
      source.effect.kind !== "power" ||
      sink === undefined ||
      !sink.alive ||
      sink.powerDraw <= 0
    ) {
      abandonHaul(crew);
      return;
    }
    // A reactor is an unlimited charge source — it produces power every tick —
    // so the packet is bounded only by the buffer headroom and the run amount.
    const carried = Math.min(SIM.powerRunAmount, chargeShortfall(sink));
    if (carried <= 0) {
      abandonHaul(crew);
      return;
    }
    crew.carrying = "power";
    crew.carryAmount = carried;
    const path = findCrewPath(ship, cells, { col: crew.col, row: crew.row }, { col: sink.col, row: sink.row });
    if (path === undefined) {
      abandonHaul(crew);
      return;
    }
    crew.targetSlotId = sink.slotId;
    crew.path = path;
    crew.pathIndex = 1;
    return;
  }

  // At the sink module, carrying charge: refill its buffer, clamped to the
  // ceiling, then free the member.
  const sink = crew.targetSlotId !== undefined ? bySlot.get(crew.targetSlotId) : undefined;
  const carried = crew.carryAmount; // set with carrying at pickup, so defined here
  if (carried !== undefined && sink !== undefined && sink.alive && sink.powerDraw > 0) {
    sink.charge = Math.min(SIM.chargeBufferMax, sink.charge + carried);
  }
  abandonHaul(crew);
}

/** Rounds a weapon is short of its local magazine capacity. Zero for an
 *  unlimited weapon (no `ammoCapacity`) — those are never resupplied. */
export function ammoShortfall(weapon: SimModule): number {
  if (weapon.effect.kind !== "weapon") return 0;
  const cap = weapon.effect.ammoCapacity;
  if (cap === undefined) return 0;
  return Math.max(0, cap - weapon.ammo);
}

/**
 * Whether a finite-ammo weapon is fed by a live ammo conduit: it has at least
 * one ammo link whose named source is a magazine that is still alive and still
 * holds rounds. A magazine that has died or run dry severs the conduit, dropping
 * the weapon back onto the crew-haul economy. A weapon with no ammo capacity
 * (unlimited) is never resupplied, so it is never considered conduit-fed.
 */
export function hasLiveAmmoHardwire(
  weapon: SimModule,
  bySlot: ReadonlyMap<string, SimModule>,
): boolean {
  if (weapon.hardwireSinks === undefined) return false;
  if (weapon.effect.kind !== "weapon" || weapon.effect.ammoCapacity === undefined) {
    return false;
  }
  for (const link of weapon.hardwireSinks) {
    if (link.resource !== "ammo") continue;
    const source = bySlot.get(link.sourceSlotId);
    if (
      source !== undefined &&
      source.alive &&
      source.effect.kind === "magazine" &&
      source.ammoStored > 0
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Refill every finite-ammo weapon fed by a live ammo conduit, drawing directly
 * from its magazine's `ammoStored` each tick with no crew haul. A magazine's
 * remaining store is divided across its hardwired sinks deterministically: sinks
 * are served in module (col, row) array order, each taking up to an even share of
 * the magazine's current store (and no more than it is short of capacity), so the
 * apportionment is a pure function of the alive set and never depends on Map or
 * Set iteration order. A severed link (the magazine dead or empty) refills
 * nothing — `hasLiveAmmoHardwire` already excludes it, and the share is floored
 * at the store actually present.
 *
 * Skipped entirely on designs with no ammo hardwires (every weapon's
 * `hardwireSinks` is omitted), so their ammo state is byte-identical to before.
 */
export function refillHardwiredAmmo(ship: SimShip): void {
  if (ship.modules === undefined) return;
  const bySlot = modulesBySlot(ship);

  // Group conduit-fed sinks by their feeding magazine so a magazine's store is
  // shared fairly across the weapons it serves. A weapon may name more than one
  // magazine; it is assigned to the first live one in its link order, matching
  // the single-source-per-link conduit model (no dynamic reallocation).
  const sinksByMagazine = new Map<string, SimModule[]>();
  for (const sink of ship.modules) {
    if (!sink.alive || sink.hardwireSinks === undefined) continue;
    if (sink.effect.kind !== "weapon" || sink.effect.ammoCapacity === undefined) continue;
    for (const link of sink.hardwireSinks) {
      if (link.resource !== "ammo") continue;
      const source = bySlot.get(link.sourceSlotId);
      if (
        source === undefined ||
        !source.alive ||
        source.effect.kind !== "magazine" ||
        source.ammoStored <= 0
      ) {
        continue;
      }
      const existing = sinksByMagazine.get(source.slotId);
      if (existing === undefined) {
        sinksByMagazine.set(source.slotId, [sink]);
      } else {
        existing.push(sink);
      }
      break;
    }
  }

  // Iterate magazines in module (col, row) array order for a stable share order.
  for (const source of ship.modules) {
    if (source.effect.kind !== "magazine") continue;
    const sinks = sinksByMagazine.get(source.slotId);
    if (sinks === undefined || sinks.length === 0) continue;
    // Sinks are collected in module array order above, which is (col, row) order
    // because `ship.modules` is built in that order by the resolver.
    let remaining = sinks.length;
    for (const sink of sinks) {
      if (source.ammoStored <= 0) break;
      // Even share of the store still in the magazine across the sinks not yet
      // served, so the division is balanced and integer-stable: the last sink
      // gets whatever rounds the earlier shares left behind.
      const share = Math.floor(source.ammoStored / remaining);
      remaining -= 1;
      if (sink.effect.kind !== "weapon") continue;
      const cap = sink.effect.ammoCapacity;
      if (cap === undefined) continue;
      const transfer = Math.min(share, Math.max(0, cap - sink.ammo));
      if (transfer <= 0) continue;
      sink.ammo += transfer;
      source.ammoStored -= transfer;
    }
  }
}

/**
 * Pick an ammo run for an idle crew member: the first dry weapon (in (col, row)
 * order) with a finite `ammoCapacity` it is short of, that is not already being
 * resupplied, paired with the nearest reachable magazine that still has store.
 * Returns the source magazine, the sink weapon, and the path to the source, or
 * undefined when no run is both needed and reachable.
 *
 * The dry-weapon and magazine candidate lists are precomputed once per ship per
 * tick by the caller (`updateCrew`) and passed in already sorted by `(col, row)`;
 * entry to the pathfinding loop is guarded by an existence check rather than
 * rebuilding the candidate set. This is byte-identical to the old per-crew
 * rebuild, without the filter+sort allocation churn on every idle-crew
 * assignment.
 *
 * "Dry" is a weapon below a top-up threshold so crew restock proactively rather
 * than only at exactly zero — a magazine run takes several ticks to walk, so a
 * weapon that waited for a literal empty would always be caught mid-salvo with
 * no rounds. The threshold is the run amount: once a weapon could accept a full
 * run, a hauler is dispatched.
 */
export function chooseAmmoRun(
  ship: SimShip,
  crew: SimCrew,
  dryWeapons: readonly SimModule[],
  magazines: readonly SimModule[],
  cells: ReadonlyMap<string, SimModule>,
  claimedWeapons: ReadonlySet<string>,
): { source: SimModule; sink: SimModule; path: { col: number; row: number }[] } | undefined {
  if (dryWeapons.length === 0 || magazines.length === 0) return undefined;
  if (ship.modules === undefined) return undefined;
  const bySlot = modulesBySlot(ship);
  // Short-circuit: bail unless some dry weapon is both unclaimed and not fed by
  // a live ammo conduit. Both terms are load-bearing — a claimed non-conduit
  // dry weapon alongside an earlier unclaimed conduit-fed one means only the
  // combined check correctly reports no candidate, matching the precomputed
  // per-ship candidate set the loop below selects from.
  const anyCandidate = dryWeapons.some(
    (m) => !claimedWeapons.has(m.slotId) && !hasLiveAmmoHardwire(m, bySlot),
  );
  if (!anyCandidate) return undefined;

  for (const sink of dryWeapons) {
    if (claimedWeapons.has(sink.slotId)) continue;
    for (const source of magazines) {
      const path = findCrewPath(
        ship,
        cells,
        { col: crew.col, row: crew.row },
        { col: source.col, row: source.row },
      );
      if (path === undefined) continue;
      // Confirm the second leg (magazine -> weapon) is also walkable before
      // committing, so a crew member never picks up rounds it cannot deliver.
      const delivery = findCrewPath(
        ship,
        cells,
        { col: source.col, row: source.row },
        { col: sink.col, row: sink.row },
      );
      if (delivery === undefined) continue;
      return { source, sink, path };
    }
  }
  return undefined;
}

/** Charge a power-drawing module is short of a full local buffer. Zero for a
 *  module that draws no power. */
export function chargeShortfall(m: SimModule): number {
  if (m.powerDraw <= 0) return 0;
  return Math.max(0, SIM.chargeBufferMax - m.charge);
}

/**
 * Pick a power run for an idle crew member: the first power-drawing module (in
 * (col, row) order) whose local charge buffer has fallen a full run-amount short,
 * that is not already being fed, paired with the nearest reachable reactor.
 * Returns the source reactor, the sink module, and the path to the source, or
 * undefined when no run is both needed and reachable.
 *
 * The starved-sink and reactor candidate lists are precomputed once per ship per
 * tick by the caller (`updateCrew`) and passed in already sorted by `(col, row)`;
 * only the per-crew claim filter (skip sinks already being fed) is applied
 * inline. This is byte-identical to the old per-crew rebuild, without the
 * filter+sort allocation churn on every idle-crew assignment.
 *
 * As with ammo, the starvation threshold is the run amount so crew restock
 * proactively: a module that could accept a full charge packet gets a hauler
 * before its buffer empties and the station drops offline mid-fight.
 */
export function choosePowerRun(
  ship: SimShip,
  crew: SimCrew,
  starvedSinks: readonly SimModule[],
  reactors: readonly SimModule[],
  cells: ReadonlyMap<string, SimModule>,
  claimedSinks: ReadonlySet<string>,
): { source: SimModule; sink: SimModule; path: { col: number; row: number }[] } | undefined {
  if (starvedSinks.length === 0 || reactors.length === 0) return undefined;

  for (const sink of starvedSinks) {
    if (claimedSinks.has(sink.slotId)) continue;
    for (const source of reactors) {
      const path = findCrewPath(ship, cells, { col: crew.col, row: crew.row }, { col: source.col, row: source.row });
      if (path === undefined) continue;
      const delivery = findCrewPath(
        ship,
        cells,
        { col: source.col, row: source.row },
        { col: sink.col, row: sink.row },
      );
      if (delivery === undefined) continue;
      return { source, sink, path };
    }
  }
  return undefined;
}

/**
 * Whether a sink module is manned through a live manning hardwire: it has at
 * least one manning link whose named source module is still alive. A dead source
 * severs the link, so a sink fed only by dead sources falls back to needing crew.
 */
export function hasLiveManningHardwire(
  sink: SimModule,
  bySlot: ReadonlyMap<string, SimModule>,
): boolean {
  if (sink.hardwireSinks === undefined) return false;
  for (const link of sink.hardwireSinks) {
    if (link.resource !== "manning") continue;
    const source = bySlot.get(link.sourceSlotId);
    if (source !== undefined && source.alive) return true;
  }
  return false;
}
