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
 * Cell indexing. The transport field uses a module-sparse dense index: modules
 * are sorted by (row, col), numbered 0..n−1, and `ResourceState.moduleIndex`
 * maps `"col,row"` to that index. Only alive module cells participate in the
 * graph — empty bounding-box cells are excluded entirely, keeping n proportional
 * to the module count rather than the rectangular footprint.
 */

import {
  CABIN_TEMPERATURE_K,
  makeAtmosphereSubstance,
  STANDARD_CELL_GAS_MASS_KG,
} from "@/domain/simulation/engine/lifesupport";
import {
  EXHAUST_VELOCITY_M_PER_S,
  makePropellantSubstance,
  pipeKey,
} from "@/domain/simulation/engine/propellant";
import type {
  RectangularTransportGraph,
} from "@/domain/simulation/engine/transport-graph";
import {
  stepTransportField,
  type TransportFace,
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

/** Canonical "col,row" cell key used by the module index. */
function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

/** Whether a module cell is a deck (crew-walkable, atmosphere-retaining). */
function isDeck(m: SimModule): boolean {
  return m.surface === "deck";
}

/**
 * Build the initial ResourceState for a ship. Modules are sorted by (row, col)
 * and numbered 0..n−1. The phi arrays have length n (the number of modules),
 * keeping the transport grid proportional to module count, not bounding-box
 * size. `moduleIndex` maps `"col,row"` keys to dense indices for O(1) lookup.
 */
export function makeResourceState(ship: SimShip): ResourceState | undefined {
  if (ship.modules === undefined || ship.modules.length === 0) return undefined;

  // Deterministic dense index: sort modules by (row, col) so the order is
  // stable and independent of the array's original order.
  const sorted = [...ship.modules].sort(
    (a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col,
  );
  const n = sorted.length;
  const moduleIndex = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const m = sorted[i];
    if (m !== undefined) moduleIndex.set(cellKey(m.col, m.row), i);
  }

  // Thermal: every cell starts at cabin temperature.
  const thermal = new Array<number>(n).fill(CABIN_TEMPERATURE_K);

  // Atmosphere: deck cells hold a standard cell's worth of gas.
  const atmosphere = new Array<number>(n).fill(0);
  for (const m of sorted) {
    if (isDeck(m)) {
      const i = moduleIndex.get(cellKey(m.col, m.row));
      if (i !== undefined) atmosphere[i] = STANDARD_CELL_GAS_MASS_KG;
    }
  }

  // Propellant: total fuel mass from the rocket equation, at engine cells.
  const propellant = new Array<number>(n).fill(0);
  const engineCells = sorted.filter((m) => m.effect.kind === "engine");
  if (engineCells.length > 0 && ship.mass > 0) {
    const fuelMass = ship.mass * (Math.exp(TARGET_DELTA_V_M_PER_S / EXHAUST_VELOCITY_M_PER_S) - 1);
    const perEngine = fuelMass / engineCells.length;
    for (const m of engineCells) {
      const i = moduleIndex.get(cellKey(m.col, m.row));
      if (i !== undefined) propellant[i] = perEngine;
    }
  }

  // Power buffer: capacity = total reactor output × reserve duration.
  let reactorWatts = 0;
  for (const m of ship.modules) {
    if (m.alive && m.effect.kind === "power") reactorWatts += m.effect.output;
  }
  const capacityJoules = reactorWatts * POWER_BUFFER_RESERVE_S;
  const powerBuffer: EnergyBuffer = { energy: capacityJoules, capacityJoules };

  return { moduleIndex, thermal, propellant, atmosphere, powerBuffer };
}

/** Build (or return the cached) sparse transport graph for the ship's alive
 *  module set. n = number of live modules in `state.moduleIndex`. Faces
 *  connect 4-adjacent alive pairs where the edge between them is open.
 *  Cached on `ship.resourceGraph`; rebuilt only on a topology change.  */
function transportGraph(ship: SimShip, state: ResourceState): RectangularTransportGraph {
  if (
    ship.resourceGraph !== undefined &&
    ship.resourceGraph.fingerprint === (ship.topologyFingerprint ?? 0)
  ) {
    return ship.resourceGraph.graph;
  }

  const aliveByKey = new Map<string, SimModule>();
  for (const m of ship.modules ?? []) {
    if (m.alive) aliveByKey.set(cellKey(m.col, m.row), m);
  }
  const n = state.moduleIndex.size;

  const faces: TransportFace[] = [];
  const boundaryIndices = new Set<number>();
  const FACE_AREA = 1; // 1 m² for a unit-grid face

  for (const [key, fromIdx] of state.moduleIndex) {
    const fromM = aliveByKey.get(key);
    if (fromM === undefined) {
      boundaryIndices.add(fromIdx);
      continue;
    }
    type EdgeDir = { dc: number; dr: number; nx: number; ny: number; edgeKey: "e"|"w"|"n"|"s" };
    const dirs: EdgeDir[] = [
      { dc:  1, dr:  0, nx:  1, ny: 0,  edgeKey: "e" },
      { dc: -1, dr:  0, nx: -1, ny: 0,  edgeKey: "w" },
      { dc:  0, dr:  1, nx:  0, ny:  1, edgeKey: "n" },
      { dc:  0, dr: -1, nx:  0, ny: -1, edgeKey: "s" },
    ];
    for (const { dc, dr, nx, ny, edgeKey } of dirs) {
      const toKey = cellKey(fromM.col + dc, fromM.row + dr);
      const toIdx = state.moduleIndex.get(toKey);
      if (toIdx !== undefined) {
        const toM = aliveByKey.get(toKey);
        const edgeState = fromM.edges[edgeKey];
        const open = toM !== undefined && (edgeState === "open" || edgeState === "door");
        faces.push({ from: fromIdx, to: toIdx, nx, ny, area: FACE_AREA, open, boundary: false });
      } else {
        // No module in this direction: hull-facing boundary face.
        faces.push({ from: fromIdx, to: undefined, nx, ny, area: FACE_AREA, open: false, boundary: true });
        boundaryIndices.add(fromIdx);
      }
    }
  }

  const boundaryCells = [...boundaryIndices].sort((a, b) => a - b);
  const facesFrom: TransportFace[][] = Array.from({ length: n }, () => []);
  for (const face of faces) { facesFrom[face.from]?.push(face); }
  const boundaryCellSet = new Set(boundaryCells);
  const openInteriorPipes = new Set<number>();
  for (const face of faces) {
    if (face.to !== undefined && face.open) openInteriorPipes.add(pipeKey(face.from, face.to));
  }

  const graph: RectangularTransportGraph = { faces, facesFrom, boundaryCells, boundaryCellSet, openInteriorPipes };
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
  const idx = (m: SimModule): number | undefined => state.moduleIndex.get(cellKey(m.col, m.row));

  // --- Thermal substance ---
  // Heat sources: alive reactors inject their output as waste heat.
  const thermalSources = new Map<number, number>();
  for (const m of ship.modules) {
    if (!m.alive || m.effect.kind !== "power") continue;
    const i = idx(m);
    if (i !== undefined) thermalSources.set(i, m.effect.output);
  }
  // Radiator cells: every perimeter cell of the bounding rectangle is a
  // radiator surface (v1 simplification). Use the pre-built set from the
  // cached graph to avoid O(n) Set construction on every tick.
  const thermalField: TransportField = {
    substance: makeThermalSubstance(thermalSources, graph.boundaryCellSet),
    faces: graph.faces,
    facesFrom: graph.facesFrom,
    boundaryCells: graph.boundaryCells,
    boundaryCellSet: graph.boundaryCellSet,
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
    if (i !== undefined) {
      engineThrust.set(i, m.effect.thrust);
      exhaust.set(i, { nx: Math.cos(m.facing), ny: Math.sin(m.facing) });
    }
  }
  // Pipes: every open interior face is part of the fuel manifold. Use the
  // pre-built set from the cached graph — avoids O(n_faces) string allocations
  // on every tick.
  const propellantField: TransportField = {
    substance: makePropellantSubstance(engineThrust, graph.openInteriorPipes, exhaust),
    faces: graph.faces,
    facesFrom: graph.facesFrom,
    boundaryCells: graph.boundaryCells,
    boundaryCellSet: graph.boundaryCellSet,
  };
  state.propellant = stepTransportField(propellantField, state.propellant).phi;

  // --- Atmosphere substance ---
  // Crew map: cell index → number of crew present on that cell.
  const crewMap = new Map<number, number>();
  if (ship.crew !== undefined) {
    for (const c of ship.crew) {
      const i = state.moduleIndex.get(cellKey(c.col, c.row));
      if (i !== undefined) crewMap.set(i, (crewMap.get(i) ?? 0) + 1);
    }
  }
  // Vents: v1 has no breached compartments (the damage model does not yet
  // expose breaches), so nothing vents and the vent mask is empty.
  const atmosphereField: TransportField = {
    substance: makeAtmosphereSubstance(crewMap, new Map()),
    faces: graph.faces,
    facesFrom: graph.facesFrom,
    boundaryCells: graph.boundaryCells,
    boundaryCellSet: graph.boundaryCellSet,
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
