/**
 * The crew economy: per-tick advancement, power/ammo hauling, station
 * manning, and the hardwire-fed resource refill that parallels crew hauls.
 */

import type { SimCrew } from "../types";

import { SIM } from "./config";
import { TICK_DURATION_SECONDS } from "./power";
import { crewTaskOrder, type CrewTaskKind } from "./crew-priority";
import { ammoShortfall, chargeShortfall, chooseAmmoRun, choosePowerRun, hasLiveManningHardwire, reactorWiringReach, refillHardwiredPower, resolveAmmoArrival, resolvePowerArrival } from "./crew-haul";
import { aliveCellMap, compareByCell, crewCellKey, findCrewPath, modulesBySlot, refreshPathCache } from "./crew-pathfinding";
import { edgeDirection } from "@/domain/grid";
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
 *  3. Idle crew are assigned the highest-priority unmet need, in the order
 *     `crewTaskOrder` returns for the ship's `crewPriority` mode (combat:
 *     manning, ammo, power; damageControl: repair-elevated when critical;
 *     resupply: ammo and power first). `repair` is a doctrine signal only —
 *     repair bays heal modules directly in the tick loop's repair step, so
 *     it produces no idle-crew assignment and crew fall through to the next
 *     kind. The target is reserved so two crew never chase the same one.
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
  const bySlot = modulesBySlot(ship);

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

  // 3. Assign idle crew (id order) to the highest-priority unmet need, in the
  //    order the ship's `crewPriority` mode dictates (combat: manning, ammo,
  //    power; damageControl: repair-elevated when structure is critical;
  //    resupply: ammo and power first). The candidate lists are already built
  //    above; this loop only chooses the order to try them in. `repair` is a
  //    doctrine signal — repair bays heal modules directly in the tick loop's
  //    repair step, so it produces no idle-crew assignment here and crew fall
  //    through to the next kind. The order is computed once per ship (a pure
  //    function of priority + structure ratio); crew iteration stays in id
  //    order, so determinism is preserved.
  // Live AI override (Phase 7 wiring): a `prioritiseRepair` rule that fired this
  // tick asks the crew to favour repair, so the scheduler runs under the
  // `damageControl` doctrine (which orders repair ahead of the hauls — and ahead
  // of everything once structure is critical) regardless of the ship's static
  // `crewPriority`. Without the rule (`aiPrioritiseRepair` false, the default for
  // every rule-less ship) the static priority stands and the order is unchanged.
  const priority = ship.aiPrioritiseRepair
    ? "damageControl"
    : (ship.doctrine.base.crew ?? "combat");
  const taskOrder = crewTaskOrder(priority, {
    structure: ship.structure,
    maxStructure: ship.maxStructure,
  });
  for (const c of ordered) {
    if (c.job !== "idle") continue;
    for (const kind of taskOrder) {
      if (assignIdleCrewToTask(kind, ship, c, cells, stations, dryWeapons, magazines, starvedSinks, reactors, claimedStations, claimedWeapons, claimedSinks)) {
        break;
      }
    }
  }

  // 4. Walk one cell along each crew member's path (id order for determinism).
  //    Pass the ship's proper-time dilation factor so a fast-moving ship's crew
  //    advance at the same dilated rate as its weapon cooldowns.
  for (const c of ordered) {
    advanceCrew(c, cells, ship.dilationFactor);
  }

  // 4b. Door close rule: after all crew have moved, close every door whose two
  //     adjacent cells are both crew-free. A door stays open only as long as at
  //     least one crew member occupies one of its two bordering cells.
  //     Cells are scanned in (col, row) order; the east/south edges only (to
  //     avoid double-processing each door) drive the closing decision.
  const crewOccupied = new Set<string>();
  for (const c of ship.crew) crewOccupied.add(crewCellKey(c.col, c.row));
  for (const m of ship.modules) {
    if (!m.alive) continue;
    const here = crewCellKey(m.col, m.row);
    for (const dir of (["e", "s"] satisfies Array<"e" | "s">)) {
      if (m.edges[dir] !== "door") continue;
      if (m.edges.doorStates[dir] !== "open") continue;
      const neighborCol = dir === "e" ? m.col + 1 : m.col;
      const neighborRow = dir === "s" ? m.row + 1 : m.row;
      const there = crewCellKey(neighborCol, neighborRow);
      if (!crewOccupied.has(here) && !crewOccupied.has(there)) {
        m.edges.doorStates[dir] = "closed";
        const neighbor = cells.get(there);
        const reverseDir = dir === "e" ? "w" : "n";
        if (neighbor !== undefined && neighbor.edges[reverseDir] === "door") {
          neighbor.edges.doorStates[reverseDir] = "closed";
        }
      }
    }
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

  // 2. Spend a tick of charge from operating modules. `charge` is a joule
  //    buffer and `powerDraw` is watts, so one tick draws `powerDraw × dt`
  //    joules (the watts → joules-per-tick boundary), not the raw wattage —
  //    spending the wattage directly would drain a real-watt buffer ~30× too
  //    fast.
  for (const m of ship.modules) {
    if (m.powerDraw <= 0) continue;
    if (!m.alive || !m.powered || !m.manned || m.charge <= 0) continue;
    m.charge = Math.max(0, m.charge - m.powerDraw * TICK_DURATION_SECONDS);
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
 * ceiling (`powered`), not shed by the energy-buffer brownout (`powerCut`),
 * manned, and locally charged. The same gate the firing loop and the aggregate
 * thrust total apply, factored out so the tech step can ask the question without
 * repeating the conjunction. `powerCut` is the Phase 12 capacitor-bank brownout
 * (`resourceStep`); a module the grid shed is non-functional exactly as an
 * unpowered one is.
 */
export function isOperational(m: SimModule): boolean {
  return m.alive && m.powered && !m.powerCut && m.manned && isCharged(m);
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
    case "deflector":
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
 *
 * `dilationFactor` (0–1) is the ship's proper-time dilation this tick. It is
 * accumulated in `crew.moveAccumulator`; a cell step fires only once the
 * accumulator reaches 1. At real time (factor 1) the accumulator hits 1 every
 * tick and behaviour is byte-identical to the pre-dilation path.
 */
export function advanceCrew(crew: SimCrew, cells: ReadonlyMap<string, SimModule>, dilationFactor: number): void {
  crew.moveAccumulator += dilationFactor;
  if (crew.moveAccumulator < 1) {
    // Not enough proper time has elapsed for a cell step this tick.
    crew.ox = 0;
    crew.oy = 0;
    return;
  }
  crew.moveAccumulator -= 1;

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
  // If the path crosses a door edge, check its current state.
  // Open doors are crossed freely; a door that closed since the path was cached
  // blocks the step — abandon so the crew re-plans through (or around) it next tick.
  const fromMod = cells.get(crewCellKey(crew.col, crew.row));
  const dir = fromMod !== undefined ? edgeDirection(crew, next) : undefined;
  if (dir !== undefined && fromMod !== undefined && fromMod.edges[dir] === "door") {
    if (fromMod.edges.doorStates[dir] !== "open") {
      // Door closed under a stale cached path — abandon and re-plan.
      abandonHaul(crew);
      return;
    }
  }
  // Open the door if this step crosses one — both sides of the shared edge.
  if (dir !== undefined && fromMod !== undefined && fromMod.edges[dir] === "door") {
    fromMod.edges.doorStates[dir] = "open";
    const toMod = cells.get(crewCellKey(next.col, next.row));
    const reverseDir = dir === "n" ? "s" : dir === "s" ? "n" : dir === "e" ? "w" : "e";
    if (toMod !== undefined && toMod.edges[reverseDir] === "door") {
      toMod.edges.doorStates[reverseDir] = "open";
    }
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
  const bySlot = modulesBySlot(ship);
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

/**
 * Try to assign one idle crew member to a task of the given `kind`. Returns
 * true when the crew member was assigned (so the caller stops trying further
 * kinds for this crew); false when the kind has no unmet need the crew member
 * can reach (so the caller tries the next kind in the priority order).
 *
 * `repair` is a doctrine signal only: repair bays heal modules directly in
 * the tick loop's repair step (a station-to-module effect, not a crew walk),
 * so there is no idle-crew assignment for it and this returns false. The
 * `repair` kind still occupies a slot in the priority order so a
 * damage-control ship's crew fall through to manning/ammo/power after the
 * (empty) repair pass, rather than all rushing to manning.
 *
 * Each kind's assignment is the same logic the old fixed if-chain held: claim
 * the target on the matching claim set so later crew on the same tick don't
 * over-subscribe it. The candidate lists are passed in already sorted
 * (`(col, row)` order) and filtered to unmet need, so the only per-crew work
 * is the path lookup and the claim check.
 */
function assignIdleCrewToTask(
  kind: CrewTaskKind,
  ship: SimShip,
  crew: SimCrew,
  cells: ReadonlyMap<string, SimModule>,
  stations: readonly SimModule[],
  dryWeapons: readonly SimModule[],
  magazines: readonly SimModule[],
  starvedSinks: readonly SimModule[],
  reactors: readonly SimModule[],
  claimedStations: Map<string, number>,
  claimedWeapons: Set<string>,
  claimedSinks: Set<string>,
): boolean {
  switch (kind) {
    case "manning": {
      const station = chooseStation(ship, crew, stations, cells, claimedStations);
      if (station === undefined) return false;
      crew.job = "manning";
      crew.targetSlotId = station.station.slotId;
      // Adopt the cached path by reference and step through it from index 1
      // (index 0 is the crew's current cell). The array is never mutated, so
      // sharing it across crew on the same route is safe.
      crew.path = station.path;
      crew.pathIndex = 1;
      claimedStations.set(
        station.station.slotId,
        (claimedStations.get(station.station.slotId) ?? 0) + 1,
      );
      return true;
    }
    case "haulAmmo": {
      const run = chooseAmmoRun(ship, crew, dryWeapons, magazines, cells, claimedWeapons);
      if (run === undefined) return false;
      crew.job = "haulAmmo";
      crew.carrying = undefined;
      // First leg: walk to the magazine. The final delivery sink is recorded on
      // the crew member so the second leg knows where to take the rounds.
      crew.targetSlotId = run.source.slotId;
      crew.haulSinkSlotId = run.sink.slotId;
      crew.path = run.path;
      crew.pathIndex = 1;
      claimedWeapons.add(run.sink.slotId);
      return true;
    }
    case "haulPower": {
      const power = choosePowerRun(ship, crew, starvedSinks, reactors, cells, claimedSinks);
      if (power === undefined) return false;
      crew.job = "haulPower";
      crew.carrying = undefined;
      crew.carryAmount = undefined;
      crew.targetSlotId = power.source.slotId;
      crew.haulSinkSlotId = power.sink.slotId;
      crew.path = power.path;
      crew.pathIndex = 1;
      claimedSinks.add(power.sink.slotId);
      return true;
    }
    case "repair":
      // Doctrine signal only — repair bays heal modules directly in the tick
      // loop's repair step; no idle-crew assignment.
      return false;
  }
}
