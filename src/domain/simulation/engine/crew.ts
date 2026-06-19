/**
 * The crew economy: per-tick advancement, power/ammo hauling, station
 * manning, and the hardwire-fed resource refill that parallels crew hauls.
 */

import type { SimCrew } from "../types";

import { SIM } from "./config";
import { ammoShortfall, chargeShortfall, chooseAmmoRun, choosePowerRun, hasLiveManningHardwire, reactorWiringReach, refillHardwiredPower, resolveAmmoArrival, resolvePowerArrival } from "./crew-haul";
import { aliveCellMap, compareByCell, crewCellKey, findCrewPath, refreshPathCache } from "./crew-pathfinding";
import type { SimModule, SimShip } from "./types";

/**
 * Advance one ship's crew by a single tick and recompute every module's
 * `manned` flag from the resulting positions. Runs after `recomputeAggregates`
 * (so `powered` is settled) and before break-apart. Deterministic throughout:
 * crew are processed in id order, candidate stations / sources are scanned in
 * `(col, row)` order, and the only tie-breaks are on those stable orders —
 * never RNG, never Map/Set insertion order.
 *
 * Step sequence (crew always iterated in id order):
 *  1. Crew whose current cell has died (shot away or severed) are removed.
 *  2. Crew that have arrived at their target resolve the arrival action: a
 *     manning member that reached its station holds; a hauler picks up at a
 *     source or deposits at a sink and frees up for the next job.
 *  3. Idle crew are assigned the highest-priority unmet need — first man an
 *     under-manned station, then run ammo to a dry weapon — reserving the
 *     target so two crew never chase the same one.
 *  4. Crew with a path walk one cell along it.
 *  5. Manning is recomputed from the final positions.
 */
export function updateCrew(ship: SimShip): void {
  if (ship.modules === undefined || ship.crew === undefined) return;

  // Refresh the per-ship path cache before any path lookup this tick: a module
  // destroyed by the just-run damage phase flips its `alive` flag, which may
  // sever a route the cache still holds. `refreshPathCache` compares the
  // alive-cell fingerprint to the cached one and clears the cache only when the
  // topology actually changed (the common no-change case is a fingerprint pass).
  refreshPathCache(ship);

  // Reuse the cached alive-cell index across ticks; it only changes when the
  // topology does (a module dies), at which point `refreshPathCache` cleared it.
  // Rebuilding it every tick was a per-ship Map allocation over every module.
  if (ship.aliveCells === undefined) {
    ship.aliveCells = aliveCellMap(ship);
  }
  const cells = ship.aliveCells;
  const bySlot = new Map<string, SimModule>();
  for (const m of ship.modules) bySlot.set(m.slotId, m);

  // 1. Remove crew standing on a cell that no longer exists.
  ship.crew = ship.crew.filter((c) => cells.has(crewCellKey(c.col, c.row)));

  // Stable id order for every per-crew pass below.
  const ordered = [...ship.crew].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  // 2. Resolve arrivals (pickup / deposit). A member with an empty path that is
  //    standing on its target acts on it; manning members simply hold.
  for (const c of ordered) {
    resolveArrival(ship, c, bySlot, cells);
  }

  // Reservation maps so assignment never over-subscribes a station or sends two
  // haulers to the same sink. Built from current (post-arrival) intents.
  const claimedStations = new Map<string, number>();
  const claimedWeapons = new Set<string>();
  const claimedSinks = new Set<string>();
  for (const c of ship.crew) {
    if (c.job === "manning" && c.targetSlotId !== undefined) {
      claimedStations.set(c.targetSlotId, (claimedStations.get(c.targetSlotId) ?? 0) + 1);
    } else if (c.job === "haulAmmo" && c.haulSinkSlotId !== undefined) {
      claimedWeapons.add(c.haulSinkSlotId);
    } else if (c.job === "haulPower" && c.haulSinkSlotId !== undefined) {
      claimedSinks.add(c.haulSinkSlotId);
    }
  }

  // Precompute the sorted candidate lists for each job priority ONCE per ship
  // per tick, rather than re-filtering and re-sorting the full module array on
  // every idle-crew assignment. The per-crew claim filters (stations under-
  // subscribed, weapons/sinks not already targeted) are applied inline against
  // the claim sets, which mutate as crew are assigned — so the result is
  // byte-identical to the old per-crew rebuild, without the allocation churn.
  const stations = ship.modules
    .filter((m) => m.alive && m.crewRequired > 0 && stationNeedsCrew(m))
    .slice()
    .sort(compareByCell);
  const dryWeapons = ship.modules
    .filter(
      (m) =>
        m.alive &&
        m.effect.kind === "weapon" &&
        m.effect.ammoCapacity !== undefined &&
        ammoShortfall(m) >= SIM.ammoRunAmount,
    )
    .slice()
    .sort(compareByCell);
  const magazines = ship.modules
    .filter((m) => m.alive && m.effect.kind === "magazine" && m.ammoStored > 0)
    .slice()
    .sort(compareByCell);
  const starvedSinks = ship.modules
    .filter((m) => m.alive && m.powerDraw > 0 && chargeShortfall(m) >= SIM.powerRunAmount)
    .slice()
    .sort(compareByCell);
  const reactors = ship.modules
    .filter((m) => m.alive && m.effect.kind === "power")
    .slice()
    .sort(compareByCell);

  // 3. Assign idle crew (id order) to the highest-priority unmet need.
  for (const c of ordered) {
    if (c.job !== "idle") continue;

    // Priority 1: man an under-manned station.
    const station = chooseStation(ship, c, stations, cells, claimedStations);
    if (station !== undefined) {
      c.job = "manning";
      c.targetSlotId = station.station.slotId;
      // Adopt the cached path by reference and step through it from index 1
      // (index 0 is the crew's current cell). The array is never mutated, so
      // sharing it across crew on the same route is safe.
      c.path = station.path;
      c.pathIndex = 1;
      claimedStations.set(
        station.station.slotId,
        (claimedStations.get(station.station.slotId) ?? 0) + 1,
      );
      continue;
    }

    // Priority 2: run ammo from a magazine to a dry weapon.
    const run = chooseAmmoRun(ship, c, dryWeapons, magazines, cells, claimedWeapons);
    if (run !== undefined) {
      c.job = "haulAmmo";
      c.carrying = undefined;
      // First leg: walk to the magazine. The final delivery sink is recorded on
      // the crew member so the second leg knows where to take the rounds.
      c.targetSlotId = run.source.slotId;
      c.haulSinkSlotId = run.sink.slotId;
      c.path = run.path;
      c.pathIndex = 1;
      claimedWeapons.add(run.sink.slotId);
      continue;
    }

    // Priority 3: run charge from a reactor to a starved power-drawing module.
    const power = choosePowerRun(ship, c, starvedSinks, reactors, cells, claimedSinks);
    if (power !== undefined) {
      c.job = "haulPower";
      c.carrying = undefined;
      c.carryAmount = undefined;
      c.targetSlotId = power.source.slotId;
      c.haulSinkSlotId = power.sink.slotId;
      c.path = power.path;
      c.pathIndex = 1;
      claimedSinks.add(power.sink.slotId);
      continue;
    }
  }

  // 4. Walk one cell along each crew member's path (id order for determinism).
  for (const c of ordered) {
    advanceCrew(c, cells);
  }

  // 5. Recompute manning from final positions, then refresh local charge:
  //    hard-wired modules near a reactor refill for free, then every operating
  //    module spends a tick of its buffer.
  recomputeManning(ship);
  rechargeAndConsume(ship);
}

/**
 * Update every power-drawing module's local charge buffer for the tick:
 *  1. Passive wiring — a module within `powerWiringRadius` walkable cells of an
 *     alive reactor is hard-wired and refills to full for free.
 *  2. Consumption — a module that is operating this tick (alive, powered within
 *     the brownout ceiling, and manned, with charge to spend) draws `powerDraw`
 *     from its buffer, floored at zero.
 * Modules off the wiring grid get no free refill, so they drain and starve
 * unless crew haul charge to them; that crew-fed top-up has already happened in
 * the arrival step before this runs. Reactors draw no power and keep no buffer.
 */
export function rechargeAndConsume(ship: SimShip): void {
  if (ship.modules === undefined) return;

  // A ship with no crew has no hauling economy: it runs the pre-crew abstract
  // power grid, so every powered module is hard-wired and never starves. The
  // local-charge logistics only engages once a design commits to crew. This
  // keeps charge as a pure refinement layered on top of the existing brownout
  // for crewed ships, leaving crewless designs on the original power model.
  const hasCrew = ship.crew !== undefined && ship.crew.length > 0;
  if (!hasCrew) {
    for (const m of ship.modules) {
      if (m.alive && m.powerDraw > 0) m.charge = SIM.chargeBufferMax;
    }
    return;
  }

  // 1. Cells within the wiring radius of any alive reactor (multi-source BFS
  //    over alive cells). A module on one of these cells is hard-wired. The BFS
  //    depends only on the alive-cell graph and reactor positions, so it is
  //    cached on the ship and reused across ticks until the topology changes
  //    (`refreshPathCache` clears `wiringReach` on a fingerprint change).
  if (ship.wiringReach === undefined) {
    ship.wiringReach = reactorWiringReach(ship);
  }
  const wired = ship.wiringReach;
  for (const m of ship.modules) {
    if (m.powerDraw <= 0 || !m.alive) continue;
    if (wired.has(crewCellKey(m.col, m.row))) m.charge = SIM.chargeBufferMax;
  }

  // 1b. Explicit power conduits: a power-drawing module with a live power
  //     hardwire to an alive reactor refills to full regardless of distance —
  //     the any-distance generalisation of the proximity wiring above, tied to a
  //     specific reactor instead of any reactor in reach. A severed link (the
  //     named reactor dead) refills nothing, so the module drops back onto
  //     proximity wiring / crew hauling. Skipped entirely on designs with no
  //     power hardwires (`hardwireSinks` omitted), keeping them byte-identical.
  refillHardwiredPower(ship);

  // 2. Spend a tick of charge from operating modules.
  for (const m of ship.modules) {
    if (m.powerDraw <= 0) continue;
    if (!m.alive || !m.powered || !m.manned || m.charge <= 0) continue;
    m.charge = Math.max(0, m.charge - m.powerDraw);
  }
}

/**
 * Whether a module has the local charge to operate this tick. A module that
 * draws no power needs no charge and is always charged; a power-drawing module
 * operates only while its local buffer is above zero. Composed with `powered`
 * (the whole-ship brownout ceiling) and `manned` to decide whether a module
 * actually functions: `alive && powered && manned && isCharged(m)`.
 */
export function isCharged(m: SimModule): boolean {
  return m.powerDraw <= 0 || m.charge > 0;
}

/**
 * Whether a crew member has finished its current leg: it has no steps left on
 * its path and is standing on the cell of its current `targetSlotId`. A member
 * still walking (`pathIndex < path.length`) or with no target has not arrived.
 * Whether a module is fully functional this tick: alive, within the brownout
 * ceiling (`powered`), manned, and locally charged. The same gate the firing
 * loop and the aggregate thrust total apply, factored out so the tech step can
 * ask the question without repeating the four-way conjunction.
 */
export function isOperational(m: SimModule): boolean {
  return m.alive && m.powered && m.manned && isCharged(m);
}

/**
 * Whether a crew member has finished its current leg: its path is empty and it
 * is standing on the cell of its current `targetSlotId`. A member still walking
 * (non-empty path) or with no target has not arrived.
 */
export function hasArrived(crew: SimCrew, bySlot: ReadonlyMap<string, SimModule>): boolean {
  if (crew.path.length - crew.pathIndex > 0 || crew.targetSlotId === undefined) return false;
  const target = bySlot.get(crew.targetSlotId);
  if (target === undefined) return false;
  return target.col === crew.col && target.row === crew.row;
}

/**
 * Resolve a crew member that has reached its current target. Manning members
 * simply hold their station — `recomputeManning` reads their position. A hauler
 * picks up at the source on the first leg, then deposits at the sink on the
 * second; ammo and power runs share the same two-leg shape and differ only in
 * what is moved. Any run whose source is empty, sink is gone, or route is
 * severed abandons and frees the member.
 */
export function resolveArrival(
  ship: SimShip,
  crew: SimCrew,
  bySlot: ReadonlyMap<string, SimModule>,
  cells: ReadonlyMap<string, SimModule>,
): void {
  if (!hasArrived(crew, bySlot)) return;
  if (crew.job === "haulAmmo") resolveAmmoArrival(ship, crew, bySlot, cells);
  else if (crew.job === "haulPower") resolvePowerArrival(ship, crew, bySlot, cells);
  // Manning members hold their station; nothing to do on arrival.
}

/**
 * Reset a crew member's task after a break-apart so it re-plans within its new
 * fragment next tick. A member's target or haul route may now live on a
 * different fragment, so the safe, deterministic move is to clear the
 * assignment and let the next updateCrew re-derive it from the fragment's own
 * topology. Position is untouched, so a member standing on a station still mans
 * it (manning is position-based) and is simply re-assigned to it next tick.
 */
export function resetCrewForFragment(crew: SimCrew): void {
  crew.job = "idle";
  crew.targetSlotId = undefined;
  crew.haulSinkSlotId = undefined;
  crew.carrying = undefined;
  crew.carryAmount = undefined;
  crew.path = [];
  crew.pathIndex = 0;
}

/** Release a crew member from any haul assignment, returning it to idle. Any
 *  rounds still in hand are dropped — only happens when a sink or route has been
 *  destroyed, so the loss models cargo lost with the wreckage. */
export function abandonHaul(crew: SimCrew): void {
  crew.job = "idle";
  crew.targetSlotId = undefined;
  crew.haulSinkSlotId = undefined;
  crew.carrying = undefined;
  crew.carryAmount = undefined;
  crew.path = [];
  crew.pathIndex = 0;
}

/**
 * Whether a station kind is one the manning gate governs. Weapons, engines,
 * shields, point-defence, power and magazines must be crewed to function; pure
 * structure (hull) and passive bays (armour, crew quarters, repair) carry no
 * manning requirement of their own, so a non-zero `crewRequired` on them is
 * still honoured but they are not treated as combat stations to chase. We gate
 * exactly the kinds whose `crewRequired` matters to output.
 */
export function stationNeedsCrew(m: SimModule): boolean {
  // A crewed sensor array only contributes its detection range when manned, and
  // a crewed comms unit (a manned dish or laser relay) only forms links when
  // manned — so both are crew stations alongside weapons, engines, etc. The
  // caller already gates on crewRequired > 0, so a crewless sensor/comms unit
  // (always manned) never reaches here.
  switch (m.effect.kind) {
    case "weapon":
    case "engine":
    case "shield":
    case "pointDefense":
    case "power":
    case "magazine":
    case "sensor":
    case "comms":
      return true;
    case "crew":
    case "repair":
    case "hull":
    case "rcs":
    case "reactionWheel":
    case "blink": // tech modules (factions update): inert dispatch here; crewRequired still gates manning, active behaviour added in later phases
    case "afterburner":
    case "overcharge":
    case "cloak":
    case "signature":
    case "ecm":
    case "eccm":
    case "decoy":
    case "commandAura":
    case "hangar":
    case "mineLayer":
    case "boarding":
      return false;
  }
}

/**
 * Pick the highest-priority station an idle crew member should man: the first
 * (in `(col, row)` order) under-subscribed station that the crew member can
 * actually reach. "Under-subscribed" means fewer crew are already assigned to it
 * than it requires. Returns the station and the path to it, or undefined when
 * nothing is both needed and reachable (the crew member then stays idle).
 */
export function chooseStation(
  ship: SimShip,
  crew: SimCrew,
  stations: readonly SimModule[],
  cells: ReadonlyMap<string, SimModule>,
  claimed: ReadonlyMap<string, number>,
): { station: SimModule; path: { col: number; row: number }[] } | undefined {
  for (const station of stations) {
    if ((claimed.get(station.slotId) ?? 0) >= station.crewRequired) continue;
    const path = findCrewPath(ship, cells, { col: crew.col, row: crew.row }, { col: station.col, row: station.row });
    if (path === undefined) continue;
    return { station, path };
  }
  return undefined;
}

/**
 * Walk a crew member one cell along its path, updating its integer cell and
 * clearing the within-cell render offset. When no steps remain (`pathIndex` at
 * the end) the crew member has arrived; an idle member with no path simply holds
 * position. The fractional offset is reset to 0 on each step — render smoothing
 * is purely a UI concern and never feeds back into a gameplay decision.
 *
 * Steps are consumed by advancing `pathIndex`, not by slicing the array, so the
 * cached path is never mutated and can be shared by reference across crew on the
 * same route.
 */
export function advanceCrew(crew: SimCrew, cells: ReadonlyMap<string, SimModule>): void {
  const next = crew.path[crew.pathIndex];
  if (next === undefined) {
    crew.ox = 0;
    crew.oy = 0;
    return;
  }
  // If the next step is no longer walkable (its cell died this tick), abandon
  // the route and drop the job; the crew member re-plans next tick from where it
  // stands. A dropped ammo run forgets its sink reservation too.
  if (!cells.has(crewCellKey(next.col, next.row))) {
    abandonHaul(crew);
    return;
  }
  crew.col = next.col;
  crew.row = next.row;
  crew.pathIndex += 1;
  crew.ox = 0;
  crew.oy = 0;
}

/**
 * Recompute every module's `manned` flag from the crew now standing on each
 * cell. A module that needs no crew is always manned; otherwise it is manned
 * when at least `crewRequired` crew occupy its cell. Crew standing on a cell
 * count toward manning regardless of their job label, so a member that has just
 * arrived mans the station the same tick.
 *
 * Manning conduit: a station with a live manning hardwire — a link whose named
 * source module is still alive — counts as manned without crew, modelling a
 * fixed control run from a command/quarters source straight into the station.
 * The link is severed (and the station reverts to needing crew) the moment its
 * source module dies. Crewless designs and designs with no manning hardwires
 * never enter this branch (`hardwireSinks` is omitted), so their manning is
 * derived exactly as before and the snapshots stay byte-identical.
 */
export function recomputeManning(ship: SimShip): void {
  if (ship.modules === undefined || ship.crew === undefined) return;
  const bySlot = new Map(ship.modules.map((m) => [m.slotId, m]));
  const counts = new Map<string, number>();
  for (const c of ship.crew) {
    const k = crewCellKey(c.col, c.row);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const m of ship.modules) {
    if (m.crewRequired <= 0) {
      m.manned = true;
      continue;
    }
    const present = counts.get(crewCellKey(m.col, m.row)) ?? 0;
    if (present >= m.crewRequired) {
      m.manned = true;
      continue;
    }
    m.manned = hasLiveManningHardwire(m, bySlot);
  }
}
