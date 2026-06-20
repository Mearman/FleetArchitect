/**
 * The per-tick resource step (Phase 12 wiring, minimal). Advances the
 * use-deferred transport-field substances — thermal, propellant, atmosphere —
 * and the power energy buffer for each ship, so the honest underlying
 * simulation runs every tick underneath the gameplay layer.
 *
 * VALUES are computed and exposed on the ship's `resource` field; CONSEQUENCES
 * are NOT enforced (no overheat shutdown, no brownout, no asphyxiation, no
 * dry-tank derelict). The step is pure and deterministic: the transport graph
 * is rebuilt only on a topology change (cached on the ship alongside the path
 * cache and cleared by `refreshPathCache`), the substance configs are rebuilt
 * each tick from the live module state in module array order, and the field
 * integrator is the existing pure `stepTransportField`.
 *
 * Cell indexing. The transport field needs a dense `phi[]` over the ship's
 * cells. We use the rectangular builder over the module bounding box
 * (`cols = maxCol − minCol + 1`, `rows = maxRow − minRow + 1`), with cell index
 * `i = (row − minRow) · cols + (col − minCol)`. Cells with no module are
 * isolated nodes (every face closed) — they carry a φ value that never
 * exchanges, so they are effectively absent from the transport. A v1
 * simplification (the plan allows it for the use-deferred pass): only the
 * rectangle's perimeter carries boundary faces, so interior cells cannot
 * radiate or vent even if the real hull boundary is irregular. Correct for the
 * simulation's current fidelity; revisited when the damage model exposes real
 * breaches.
 */

import {
  CABIN_TEMPERATURE_K,
  makeAtmosphereSubstance,
  STANDARD_CELL_GAS_MASS_KG,
} from "@/domain/simulation/engine/lifesupport";
import {
  EXHAUST_VELOCITY_M_PER_S,
  makePropellantSubstance,
} from "@/domain/simulation/engine/propellant";
import {
  buildRectangularGraph,
  type RectangularTransportGraph,
} from "@/domain/simulation/engine/transport-graph";
import {
  stepTransportField,
  type TransportField,
} from "@/domain/simulation/engine/transport-field";
import {
  makeThermalSubstance,
} from "@/domain/simulation/engine/thermal";
import {
  type EnergyBuffer,
  type PowerTerminal,
  netPower,
  stepEnergyBuffer,
} from "@/domain/simulation/engine/power";
import type { ResourceState, SimModule, SimShip } from "@/domain/simulation/engine/types";

/**
 * Target Δv budget for a freshly fuelled warship, m·s⁻¹. The Δv a ship's
 * propellant load can deliver, via the inverted Tsiolkovsky rocket equation —
 * the quantity that sets the initial fuel mass from the dry mass. 3 000 m·s⁻¹
 * is an Earth–Moon manoeuvring class reserve (the Apollo CSM had ~2.8 km/s;
 * orbital rendezvous and plane changes sit in this band). The fuel load it
 * implies is the initial φ for the propellant field; consumption during the
 * battle drains it (feeding the deferred mass→integrator path).
 */
const TARGET_DELTA_V_M_PER_S = 3_000;

/**
 * Power-buffer reserve, seconds. The capacitor bank's capacity is derived from
 * the ship's total reactor output times this duration: a one-second ride-through
 * that lets the buffer absorb a transient draw spike. A documented design point
 * (the rate/epsilon category) — the physical anchor is "enough stored energy to
 * keep the grid alive for one second of peak demand".
 */
const POWER_BUFFER_RESERVE_S = 1;

/** The cell-index mapping bounds: enough to map a module's `(col, row)` onto
 *  the dense φ array. A subset of {@link ResourceState} used by `cellIndex` so
 *  the initialiser can compute indices before the full state exists. */
interface CellBounds {
  cols: number;
  rows: number;
  minCol: number;
  minRow: number;
}

/** Map a module's `(col, row)` to its dense transport-field index. Pure. */
function cellIndex(bounds: CellBounds, col: number, row: number): number {
  return (row - bounds.minRow) * bounds.cols + (col - bounds.minCol);
}

/** Whether a module cell is a deck (crew-walkable, atmosphere-retaining). */
function isDeck(m: SimModule): boolean {
  return m.surface === "deck";
}

/**
 * Build the initial ResourceState for a ship. The modules' bounding box sets
 * the cell grid; the three φ arrays are seeded at their physically-meaningful
 * equilibria (hull at cabin temperature, deck cells at standard gas mass,
 * engine cells with the fuel load implied by the target Δv against the ship's
 * dry mass); the power buffer starts full.
 */
export function makeResourceState(ship: SimShip): ResourceState | undefined {
  if (ship.modules === undefined || ship.modules.length === 0) return undefined;
  let minCol = Infinity;
  let minRow = Infinity;
  let maxCol = -Infinity;
  let maxRow = -Infinity;
  for (const m of ship.modules) {
    if (m.col < minCol) minCol = m.col;
    if (m.row < minRow) minRow = m.row;
    if (m.col > maxCol) maxCol = m.col;
    if (m.row > maxRow) maxRow = m.row;
  }
  const cols = maxCol - minCol + 1;
  const rows = maxRow - minRow + 1;
  const n = cols * rows;
  const bounds: CellBounds = { cols, rows, minCol, minRow };

  // Thermal: every cell starts at cabin temperature — the hull is in thermal
  // equilibrium with the habitable interior at deployment.
  const thermal = new Array<number>(n).fill(CABIN_TEMPERATURE_K);

  // Atmosphere: deck cells hold a standard cell's worth of gas; everything
  // else (armor, bare scaffold) is vacuum.
  const atmosphere = new Array<number>(n).fill(0);
  for (const m of ship.modules) {
    if (isDeck(m)) atmosphere[cellIndex(bounds, m.col, m.row)] = STANDARD_CELL_GAS_MASS_KG;
  }

  // Propellant: total fuel mass from the inverted rocket equation against the
  // ship's dry mass, distributed across engine cells (the tanks feed the
  // engines; v1 models the whole fuel load as sitting at the engine cells).
  const propellant = new Array<number>(n).fill(0);
  const engineCells = ship.modules.filter((m) => m.effect.kind === "engine");
  if (engineCells.length > 0 && ship.mass > 0) {
    const fuelMass = ship.mass * (Math.exp(TARGET_DELTA_V_M_PER_S / EXHAUST_VELOCITY_M_PER_S) - 1);
    const perEngine = fuelMass / engineCells.length;
    for (const m of engineCells) {
      propellant[cellIndex(bounds, m.col, m.row)] = perEngine;
    }
  }

  // Power buffer: capacity = total reactor output × reserve duration; starts
  // full (a freshly deployed ship has a charged capacitor bank).
  let reactorWatts = 0;
  for (const m of ship.modules) {
    if (m.alive && m.effect.kind === "power") {
      reactorWatts += m.effect.output;
    }
  }
  const capacityJoules = reactorWatts * POWER_BUFFER_RESERVE_S;
  const powerBuffer: EnergyBuffer = { energy: capacityJoules, capacityJoules };

  return { cols, rows, minCol, minRow, thermal, propellant, atmosphere, powerBuffer };
}

/** Build (or return the cached) transport graph for the ship's current
 *  topology. The graph is a pure function of the alive module set, so it is
 *  cached on the ship and rebuilt only when the topology fingerprint changes
 *  (`refreshPathCache` clears `resourceGraph` alongside the path cache). */
function transportGraph(ship: SimShip, state: ResourceState): RectangularTransportGraph {
  if (
    ship.resourceGraph !== undefined &&
    ship.resourceGraph.fingerprint === (ship.topologyFingerprint ?? 0)
  ) {
    return ship.resourceGraph.graph;
  }
  // Two cells are connected (face open) iff both are alive modules AND the
  // edge between them is open (open or open door). Cells with no module map
  // to a closed face on every side, so they are isolated transport nodes.
  const moduleAt = new Map<number, SimModule>();
  for (const m of ship.modules ?? []) {
    if (!m.alive) continue;
    moduleAt.set(cellIndex(state, m.col, m.row), m);
  }
  const passable = (a: number, b: number): boolean => {
    const ma = moduleAt.get(a);
    const mb = moduleAt.get(b);
    if (ma === undefined || mb === undefined) return false;
    // Two modules are transport-adjacent iff they are 4-neighbours and the
    // edge between them is open. The edge direction from a→b: if b is east of
    // a, the edge is ma.edges.e; etc.
    const dCol = mb.col - ma.col;
    const dRow = mb.row - ma.row;
    if (Math.abs(dCol) + Math.abs(dRow) !== 1) return false;
    const edgeA =
      dCol === 1 ? ma.edges.e : dCol === -1 ? ma.edges.w : dRow === 1 ? ma.edges.n : ma.edges.s;
    return edgeA === "open" || edgeA === "door";
  };
  const graph = buildRectangularGraph(state.cols, state.rows, passable);
  ship.resourceGraph = { graph, fingerprint: ship.topologyFingerprint ?? 0 };
  return graph;
}

/**
 * Advance one ship's resource state by one tick. Builds the transport graph
 * (cached) and the three substance configs from the live module state, steps
 * each field, and stores the new φ arrays back onto the resource state. The
 * power buffer is stepped from the live reactor/draw terminals.
 *
 * Use-deferred: no consequence is enforced. The step is pure and deterministic
 * (module array order for the substance maps; the integrator is the existing
 * pure `stepTransportField`). Ships without modules have no resource state and
 * the step is a no-op.
 */
export function resourceStep(ship: SimShip): void {
  if (ship.modules === undefined) return;
  const state = ship.resource;
  if (state === undefined) return;

  const graph = transportGraph(ship, state);
  const idx = (m: SimModule): number => cellIndex(state, m.col, m.row);

  // --- Thermal substance ---
  // Heat sources: alive reactors inject their output as waste heat. (A real
  // reactor's Carnot-bounded efficiency dumps a large fraction as heat; for
  // this v1 anchor the full output is the conservative upper bound on waste
  // heat.) Weapons and engines firing this tick also dump heat — deferred to a
  // later pass that reads the firing/throttle state; the steady reactor load
  // alone makes the field evolve honestly.
  const thermalSources = new Map<number, number>();
  for (const m of ship.modules) {
    if (!m.alive || m.effect.kind !== "power") continue;
    thermalSources.set(idx(m), m.effect.output);
  }
  // Radiator cells: every perimeter cell of the bounding rectangle is a
  // radiator surface (v1 simplification — real radiators are fitted panels;
  // the damage model does not yet expose a separate radiator module kind).
  const radiators = new Set<number>(graph.boundaryCells);
  const thermalField: TransportField = {
    substance: makeThermalSubstance(thermalSources, radiators),
    faces: graph.faces,
    boundaryCells: graph.boundaryCells,
  };
  state.thermal = stepTransportField(thermalField, state.thermal).phi;

  // --- Propellant substance ---
  // Engine thrust command: each alive engine's rated thrust (N). v1 treats
  // every alive engine as burning at full rating; the deferred throttle model
  // refines this from the movement controller's actual command.
  const engineThrust = new Map<number, number>();
  const exhaust = new Map<number, { nx: number; ny: number }>();
  for (const m of ship.modules) {
    if (!m.alive || m.effect.kind !== "engine") continue;
    const i = idx(m);
    engineThrust.set(i, m.effect.thrust);
    // Exhaust normal: the engine's `facing` is the exhaust direction; thrust
    // pushes along −facing (Newton's third law).
    exhaust.set(i, { nx: Math.cos(m.facing), ny: Math.sin(m.facing) });
  }
  // Pipes: every open interior face is part of the fuel manifold (v1: the
  // whole connected interior is one plumbing graph).
  const pipes = new Set<string>();
  for (const face of graph.faces) {
    if (face.to === undefined || !face.open) continue;
    pipes.add(`${Math.min(face.from, face.to)}-${Math.max(face.from, face.to)}`);
  }
  const propellantField: TransportField = {
    substance: makePropellantSubstance(engineThrust, pipes, exhaust),
    faces: graph.faces,
    boundaryCells: graph.boundaryCells,
  };
  state.propellant = stepTransportField(propellantField, state.propellant).phi;

  // --- Atmosphere substance ---
  // Crew map: cell index → number of crew present on that cell.
  const crewMap = new Map<number, number>();
  if (ship.crew !== undefined) {
    for (const c of ship.crew) {
      const i = cellIndex(state, c.col, c.row);
      crewMap.set(i, (crewMap.get(i) ?? 0) + 1);
    }
  }
  // Vents: v1 has no breached compartments (the damage model does not yet
  // expose breaches), so nothing vents and the vent mask is empty.
  const atmosphereField: TransportField = {
    substance: makeAtmosphereSubstance(crewMap, new Map()),
    faces: graph.faces,
    boundaryCells: graph.boundaryCells,
  };
  state.atmosphere = stepTransportField(atmosphereField, state.atmosphere).phi;

  // --- Power budget ---
  // Terminals: alive reactors (sources, watts = output) and alive
  // powered modules (sinks, watts = powerDraw). Iterated in module array
  // order for determinism.
  const terminals: PowerTerminal[] = [];
  for (const m of ship.modules) {
    if (!m.alive) continue;
    if (m.effect.kind === "power") {
      terminals.push({ watts: m.effect.output, direction: "source" });
    }
    if (m.powerDraw > 0) {
      terminals.push({ watts: m.powerDraw, direction: "sink" });
    }
  }
  state.powerBuffer = stepEnergyBuffer(state.powerBuffer, netPower(terminals));
}
