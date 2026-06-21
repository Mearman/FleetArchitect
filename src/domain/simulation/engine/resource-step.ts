/**
 * The per-tick resource step (Phase 12 wiring, minimal). Advances the
 * use-deferred transport-field substances — thermal, propellant, atmosphere —
 * and the power energy buffer for each ship, so the honest underlying
 * simulation runs every tick underneath the gameplay layer.
 *
 * VALUES are computed and exposed on the ship's `resource` field, and the
 * resource CONSEQUENCES are now enforced:
 *
 *  - Dry-tank flame-out (Gate 1): after the propellant step, an alive engine
 *    whose cell holds no fuel is marked `fuelStarved`, and the movement and
 *    aggregate paths skip it — zero thrust, zero geometric torque — until fuel
 *    reaches it again.
 *  - Brownout (Gate 2): after the energy buffer is stepped, if the stored charge
 *    plus reactor output cannot meet this tick's draw the grid sheds load in a
 *    fixed priority order (weapons/PD, then sensors, shields, engines; never the
 *    bridge, quarters, reactor, or repair), marking each shed module `powerCut`
 *    so its consuming systems treat it as offline.
 *  - Overheat shutdown (Gate 3): after the thermal step, an alive module whose
 *    cell temperature exceeds `SIM.overheatThresholdK` is destroyed through the
 *    same death path battle damage uses, so break-apart, airtightness venting,
 *    and a next-tick chain reaction for a volatile cell all follow.
 *  - Live airtightness: when battle damage (or an overheat death) destroys a
 *    module that was sealing a deck cell, that cell breaches across its now-open
 *    edge and vents its gas to vacuum — recoiling the hull and exposing any crew
 *    standing in the decompressing cell, who take vacuum damage and die if the
 *    cell reaches hard vacuum. An intact, sealed hull never vents (its vent mask
 *    is empty), so undamaged ships are unchanged.
 *
 * `fuelStarved` and `powerCut` are recomputed fresh every tick (cleared before
 * the substance steps re-derive them), and the step ends by re-deriving the
 * ship's aggregates so the shield-regen and repair steps later this tick — and
 * the next tick's movement and firing — read stats that reflect the cuts. A ship
 * with a full buffer, fuelled tanks, and cool, radiator-equipped cells carries
 * no consequence and behaves exactly as before.
 *
 * The step is pure and deterministic: the transport graph (and the vent mask
 * derived from the alive-cell topology) is rebuilt only on a topology change
 * (cached on the ship alongside the path cache and cleared by
 * `refreshPathCache`), the substance configs are rebuilt each tick from the
 * live module state in module array order, crew are processed in stable id
 * order, and the field integrator is the existing pure `stepTransportField`.
 *
 * Cell indexing. The transport field uses a module-sparse dense index: modules
 * are sorted by (row, col), numbered 0..n−1, and `ResourceState.moduleIndex`
 * maps `"col,row"` to that index. Only alive module cells participate in the
 * graph — empty bounding-box cells are excluded entirely, keeping n proportional
 * to the module count rather than the rectangular footprint.
 */

import {
  CABIN_TEMPERATURE_K,
  CREW_VACUUM_LETHAL_TIME_S,
  makeAtmosphereSubstance,
  STANDARD_CELL_GAS_MASS_KG,
  vacuumExposureSeverity,
  type VentMask,
} from "@/domain/simulation/engine/lifesupport";
import { CREW_HP, SIM } from "@/domain/simulation/engine/config";
import { TICKS_PER_SECOND } from "@/domain/simulation/types";
import { applyImpulse } from "@/domain/simulation/engine/weapons";
import { recomputeAggregates } from "@/domain/simulation/engine/physics";
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
  TRANSPORT_DT_S,
  type TransportFace,
  type TransportField,
} from "@/domain/simulation/engine/transport-field";
import {
  makeThermalSubstance,
} from "@/domain/simulation/engine/thermal";
import {
  TICK_DURATION_SECONDS,
  type EnergyBuffer,
  type PowerTerminal,
  netPower,
  stepEnergyBuffer,
} from "@/domain/simulation/engine/power";
import type { ResourceState, SimModule, SimShip } from "@/domain/simulation/engine/types";

/**
 * Full-thrust propellant endurance of a freshly fuelled warship, seconds: how
 * long every engine can burn at its rated thrust before its tank runs dry. The
 * tank is sized directly from this — `fuel = burnRate · endurance` with
 * `burnRate = thrust / v_e` (kg·s⁻¹) — which makes the endurance independent of
 * the engine's rated thrust and the ship's mass: a light interceptor and a
 * heavy cruiser both get the same seconds of continuous full burn.
 *
 * Endurance, not a Tsiolkovsky Δv, is the right anchor for the current arena.
 * Catalogue thrusts and masses are NOT yet in SI (config.ts: the SI re-authoring
 * lands in Phase 14), so dividing an arena-unit thrust by the real SI exhaust
 * velocity to get a Δv is unit-incoherent and yields a meaningless reserve; an
 * endurance in seconds sidesteps the mismatch and produces a fuel load that is
 * meaningful regardless of the thrust unit. The value is sized to comfortably
 * exceed a full battle of continuous manoeuvring (a battle runs at most a few
 * thousand ticks ≈ a couple of minutes at 30 ticks·s⁻¹), so an undamaged ship
 * fighting normally never flames out, and the dry-tank consequence falls only on
 * a ship that burns hard and sustained — exactly the case Gate 1 exists to
 * catch. Re-derived from the real propellant mass fraction when the SI catalogue
 * lands in Phase 14.
 */
const FULL_THRUST_ENDURANCE_S = 600;

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

  // Propellant: each engine cell holds enough fuel for FULL_THRUST_ENDURANCE_S
  // seconds of continuous burn at its own rated thrust. The per-second burn rate
  // is `thrust / v_e` (the same Tsiolkovsky relation the exhaust boundary flux
  // uses), so the tank is `burnRate · endurance`. Sizing per engine from its own
  // thrust (rather than splitting one ship-wide Δv across the engines) means a
  // mixed-thrust fit fuels each nozzle to the same endurance.
  const propellant = new Array<number>(n).fill(0);
  for (const m of sorted) {
    if (m.effect.kind !== "engine" || m.effect.thrust <= 0) continue;
    const i = moduleIndex.get(cellKey(m.col, m.row));
    if (i === undefined) continue;
    const burnRatePerSecond = m.effect.thrust / EXHAUST_VELOCITY_M_PER_S;
    propellant[i] = burnRatePerSecond * FULL_THRUST_ENDURANCE_S;
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

  // Vent breach accumulation. A deck cell vents to vacuum across a face whose
  // edge is open (or an open door) and whose neighbour is no longer an alive
  // sealing cell — exactly the airtightness-breach condition in interior.ts,
  // evaluated live against the alive set. A cell with several breached faces
  // sums their outward normals (opposite breaches cancel recoil; a single
  // breach gives full directional recoil). Empty for an intact, sealed hull.
  const ventAccum = new Map<number, { nx: number; ny: number }>();

  // Whether a cell's edge in `edgeKey` is open to flow (open edge / open door).
  const edgeOpen = (m: SimModule, edgeKey: "e" | "w" | "n" | "s"): boolean => {
    const edge = m.edges[edgeKey];
    if (edge === "open") return true;
    if (edge === "door" && m.edges.doorStates[edgeKey] === "open") return true;
    return false;
  };

  // Whether a cell's edge passes transport (gas/heat/fuel). An open edge or any
  // door (open or closed — a shut door still leaks) carries flow; a wall does
  // not. A shared face is passable only if BOTH cells agree their facing edges
  // pass: edges are authored per cell with no symmetry constraint, so a cell
  // may carry `open`/`door` against a neighbour's `wall`. Building the directed
  // face A->B from A's edge alone (and B->A from B's edge alone) would then make
  // the two half-faces disagree, breaking the finite-volume scheme's
  // conservation — a cell with a one-way inflow accumulates mass without bound
  // (to Infinity, then Infinity - Infinity = NaN). Requiring both edges makes
  // the face symmetric by construction, so transport conserves mass.
  const facePasses = (m: SimModule, edgeKey: "e" | "w" | "n" | "s"): boolean => {
    const edge = m.edges[edgeKey];
    return edge === "open" || edge === "door";
  };
  const oppositeEdge: Record<"e" | "w" | "n" | "s", "e" | "w" | "n" | "s"> = {
    e: "w",
    w: "e",
    n: "s",
    s: "n",
  };

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
      const neighbourAlive = aliveByKey.has(toKey);
      if (toIdx !== undefined) {
        const toM = aliveByKey.get(toKey);
        const open =
          neighbourAlive &&
          toM !== undefined &&
          facePasses(fromM, edgeKey) &&
          facePasses(toM, oppositeEdge[edgeKey]);
        faces.push({ from: fromIdx, to: toIdx, nx, ny, area: FACE_AREA, open, boundary: false });
      } else {
        // No module in this direction: hull-facing boundary face.
        faces.push({ from: fromIdx, to: undefined, nx, ny, area: FACE_AREA, open: false, boundary: true });
        boundaryIndices.add(fromIdx);
      }
      // Breach detection: a deck cell vents only where a neighbour module that
      // existed at battle start (present in the module index, `toIdx`) has since
      // died, leaving an open edge (or open door) facing the gap. An open edge
      // toward a position that never held a module (`toIdx === undefined`) is
      // the ship's original hull geometry, not a new breach — venting it would
      // decompress an intact design from the first tick. A live neighbour still
      // seals the edge; a wall/closed-door edge holds even against vacuum
      // (matching the airtightness rule in interior.ts). So a breach opens
      // exactly when battle damage destroys the cell that was sealing this edge.
      const neighbourDied = toIdx !== undefined && !neighbourAlive;
      if (isDeck(fromM) && neighbourDied && edgeOpen(fromM, edgeKey)) {
        const prev = ventAccum.get(fromIdx);
        if (prev === undefined) ventAccum.set(fromIdx, { nx, ny });
        else ventAccum.set(fromIdx, { nx: prev.nx + nx, ny: prev.ny + ny });
        // A breached cell exposed to vacuum through a dead module neighbour is
        // a boundary cell even though a module index entry still sits beyond it:
        // the atmosphere boundary flux (and the thermal radiator surface) act
        // only on boundary cells, so it must be registered as one.
        boundaryIndices.add(fromIdx);
      }
    }
  }

  const ventMask: VentMask = ventAccum;

  const boundaryCells = [...boundaryIndices].sort((a, b) => a - b);
  const facesFrom: TransportFace[][] = Array.from({ length: n }, () => []);
  for (const face of faces) { facesFrom[face.from]?.push(face); }
  const boundaryCellSet = new Set(boundaryCells);
  const openInteriorPipes = new Set<number>();
  for (const face of faces) {
    if (face.to !== undefined && face.open) openInteriorPipes.add(pipeKey(face.from, face.to));
  }

  const graph: RectangularTransportGraph = { faces, facesFrom, boundaryCells, boundaryCellSet, openInteriorPipes, ventMask };
  ship.resourceGraph = { graph, fingerprint: ship.topologyFingerprint ?? 0 };
  return graph;
}

/**
 * Advance one ship's resource state by one tick. Builds the transport graph
 * (cached) and the three substance configs from the live module state, steps
 * each field, and stores the new φ arrays back onto the resource state. The
 * power buffer is stepped from the live reactor/draw terminals.
 *
 * The one enforced consequence is venting: a deck cell breached by a destroyed
 * neighbour vents its gas, recoils the hull, and exposes any crew in the cell
 * to vacuum (see the file header). Every other consequence is still deferred.
 * The step is pure and deterministic (module array order for the substance
 * maps; crew processed in stable id order; the integrator is the existing pure
 * `stepTransportField`). Ships without modules have no resource state and the
 * step is a no-op.
 */
export function resourceStep(ship: SimShip): void {
  if (ship.modules === undefined) return;
  const state = ship.resource;
  if (state === undefined) return;

  const graph = transportGraph(ship, state);
  const idx = (m: SimModule): number | undefined => state.moduleIndex.get(cellKey(m.col, m.row));

  // Resource consequences are recomputed fresh every tick: clear the previous
  // tick's flame-out and grid-shed verdicts before the substance steps re-derive
  // them from the new field state, so a tank that refilled or a buffer that
  // recovered un-cuts the affected modules. Iterated in fixed module-array order.
  for (const m of ship.modules) {
    m.fuelStarved = false;
    m.powerCut = false;
  }

  // Reverse index (cell φ-index → alive module), used by the vent recoil to
  // recover a breached cell's ship-local position for the lever arm. Built once
  // per tick from the live module set in fixed module order.
  const aliveByIndex = new Map<number, SimModule>();
  for (const m of ship.modules) {
    if (!m.alive) continue;
    const i = idx(m);
    if (i !== undefined) aliveByIndex.set(i, m);
  }

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

  // Gate 3 — Overheat shutdown. After the thermal field is stepped, any alive
  // module whose cell temperature exceeds the failure threshold suffers thermal
  // and structural destruction. The cell is killed through the same death path
  // battle damage uses — surface and scaffold HP to zero, `alive` cleared — so
  // every downstream effect follows: `recomputeAggregates` (called at the end of
  // this step) drops it from the aggregates, break-apart (4c) re-evaluates
  // connectivity, the airtightness vent mask treats it as a dead neighbour next
  // graph rebuild, and a volatile cell (reactor/magazine) detonates on the next
  // tick's chain-reaction pass. Iterated in fixed module-array order; no RNG.
  for (const m of ship.modules) {
    if (!m.alive) continue;
    const i = idx(m);
    if (i === undefined) continue;
    const temperature = state.thermal[i] ?? 0;
    if (temperature > SIM.overheatThresholdK) {
      m.surfaceHp = 0;
      m.hp = 0;
      m.alive = false;
    }
  }

  // --- Propellant substance ---
  // Engine thrust command: each alive engine's rated thrust scaled by the
  // throttle the movement step actually applied this tick (`ship.engineThrottle`,
  // afterburner included). Fuel is burned in proportion to the thrust genuinely
  // produced — a coasting or station-keeping ship (throttle 0) burns nothing —
  // so the dry-tank flame-out reflects real usage rather than charging every
  // engine full burn every tick.
  const throttle = ship.engineThrottle;
  const engineThrust = new Map<number, number>();
  const exhaust = new Map<number, { nx: number; ny: number }>();
  for (const m of ship.modules) {
    if (!m.alive || m.effect.kind !== "engine") continue;
    const i = idx(m);
    if (i !== undefined) {
      if (throttle > 0) engineThrust.set(i, m.effect.thrust * throttle);
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

  // Gate 1 — Dry-tank flame-out. After the propellant field is stepped, an alive
  // engine that was commanded to thrust this tick (`ship.engineThrottle > 0`) but
  // whose cell holds no fuel flames out: it is marked `fuelStarved` so the
  // movement and aggregate paths skip it this tick (zero thrust, zero geometric
  // torque). An idle engine on a coasting ship is not starved — it simply was not
  // asked to burn. The flag is recomputed fresh every tick (cleared at the top of
  // this step), so an engine fed by a tank that refills resumes thrust the moment
  // fuel reaches it. Only engine cells are considered; iterated in fixed
  // module-array order, no RNG.
  if (throttle > 0) {
    for (const m of ship.modules) {
      if (!m.alive || m.effect.kind !== "engine") continue;
      if (m.effect.thrust <= 0) continue;
      const i = idx(m);
      if (i === undefined) continue;
      const fuel = state.propellant[i] ?? 0;
      if (fuel <= 0) m.fuelStarved = true;
    }
  }

  // --- Atmosphere substance ---
  // Crew map: cell index → number of crew present on that cell.
  const crewMap = new Map<number, number>();
  if (ship.crew !== undefined) {
    for (const c of ship.crew) {
      const i = state.moduleIndex.get(cellKey(c.col, c.row));
      if (i !== undefined) crewMap.set(i, (crewMap.get(i) ?? 0) + 1);
    }
  }
  // Deck mask: the alive deck cells (pressurised, gas-holding compartments).
  // Advection flows only between two decks; a deck never advects gas into a solid
  // armour/hull cell. Built once per tick in fixed module-array order.
  const deckCells = new Set<number>();
  for (const m of ship.modules) {
    if (!m.alive || !isDeck(m)) continue;
    const i = idx(m);
    if (i !== undefined) deckCells.add(i);
  }
  // Vents: the live vent mask derived from the alive-cell topology. A deck cell
  // breached by a dead/absent neighbour across an open edge vents its gas to
  // vacuum at exhaust velocity, recoiling the hull. Empty for an intact, sealed
  // hull, so an undamaged ship behaves exactly as before.
  const atmosphereField: TransportField = {
    substance: makeAtmosphereSubstance(crewMap, graph.ventMask, deckCells),
    faces: graph.faces,
    facesFrom: graph.facesFrom,
    boundaryCells: graph.boundaryCells,
    boundaryCellSet: graph.boundaryCellSet,
  };
  const atmosphereResult = stepTransportField(atmosphereField, state.atmosphere);
  state.atmosphere = atmosphereResult.phi;

  // Vent recoil: the net reaction force from gas escaping every breach, in
  // ship-local axes, applied at the mass-weighted centroid of the venting cells
  // so an off-centre breach both pushes and spins the hull. The transport field
  // returns the impulse in SI (kg·m·s⁻¹) accumulated over the tick; the engine's
  // momentum convention is per-tick (velocity is world-units — metres — per
  // tick), so scale by the tick interval `TRANSPORT_DT_S` to convert SI
  // impulse to the per-tick momentum `applyImpulse` expects. The impulse is
  // rotated from ship-local into world axes (the frame `applyImpulse` takes its
  // vector in) while the application point stays in the ship-local design frame.
  if (
    graph.ventMask.size > 0 &&
    (atmosphereResult.momentumX !== 0 || atmosphereResult.momentumY !== 0)
  ) {
    // Centroid of the breached cells in ship-local coordinates. The vent mask
    // is iterated in insertion order, which is deterministic (the module index
    // is sorted, and breaches are accumulated in that fixed iteration order).
    let cx = 0;
    let cy = 0;
    let count = 0;
    for (const cellIdx of graph.ventMask.keys()) {
      const m = aliveByIndex.get(cellIdx);
      if (m === undefined) continue;
      cx += m.x;
      cy += m.y;
      count += 1;
    }
    if (count > 0) {
      cx /= count;
      cy /= count;
      const localImpulseX = atmosphereResult.momentumX * TRANSPORT_DT_S;
      const localImpulseY = atmosphereResult.momentumY * TRANSPORT_DT_S;
      // Rotate the ship-local impulse into world axes for `applyImpulse`.
      const cos = Math.cos(ship.facing);
      const sin = Math.sin(ship.facing);
      const worldImpulseX = localImpulseX * cos - localImpulseY * sin;
      const worldImpulseY = localImpulseX * sin + localImpulseY * cos;
      applyImpulse(ship, worldImpulseX, worldImpulseY, cx, cy);
    }
  }

  // Crew vacuum exposure: a crew member standing in a cell whose gas has
  // fallen below the survivable fraction takes vacuum damage this tick, scaled
  // by how far the cell has decompressed. Crew are processed in stable id order
  // so the (floating-point) damage and any deaths are order-independent across
  // identical runs. A crew member at zero HP is removed from the roster.
  if (ship.crew !== undefined && ship.crew.length > 0) {
    const lethalRatePerTick = CREW_HP / (CREW_VACUUM_LETHAL_TIME_S * TICKS_PER_SECOND);
    const ordered = [...ship.crew].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    let anyDied = false;
    for (const c of ordered) {
      const cellIdx = state.moduleIndex.get(cellKey(c.col, c.row));
      if (cellIdx === undefined) continue;
      const gasMass = state.atmosphere[cellIdx] ?? 0;
      const severity = vacuumExposureSeverity(gasMass);
      if (severity <= 0) continue;
      c.hp -= lethalRatePerTick * severity;
      if (c.hp <= 0) {
        c.hp = 0;
        anyDied = true;
      }
    }
    if (anyDied) ship.crew = ship.crew.filter((c) => c.hp > 0);
  }

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
  const net = netPower(terminals);
  const bufferBefore = state.powerBuffer.energy;
  state.powerBuffer = stepEnergyBuffer(state.powerBuffer, net);

  // Gate 2 — Brownout enforcement. The energy buffer is a capacitor bank: it
  // rides through a transient draw spike, but once the stored charge cannot
  // cover the reactor-vs-draw shortfall for this tick the grid must shed load.
  // `stepEnergyBuffer` clamps the buffer to non-negative joules, so the deficit
  // is read not from the clamped buffer but from the energy balance that
  // produced it: over one tick of `dt` seconds the grid can deliver
  // `reactorOutput·dt + storedCharge` joules, and the demand is `draw·dt`. The
  // shortfall in watts is `-(bufferBefore/dt + net)` — positive only when the
  // stored charge plus reactor output fall short of the draw. We shed modules in
  // a fixed priority order until the recovered draw covers that shortfall.
  const deficitWatts = -(bufferBefore / TICK_DURATION_SECONDS + net);
  if (deficitWatts > 0) shedBrownoutLoad(ship, deficitWatts);

  // With the tick's resource consequences settled — engines flamed out, modules
  // grid-shed, cells overheated to destruction — re-derive the aggregate stats
  // so the shield-regen and repair steps that follow this tick, and the next
  // tick's movement and firing, read values that reflect them. recomputeAggregates
  // is pure over the live module flags and its functional gate already honours
  // `powerCut` and `fuelStarved`, so a ship with no consequences this tick
  // recomputes to the identical aggregates it already held.
  recomputeAggregates(ship);
}

/**
 * Brownout priority class of a module: lower numbers are shed first. Weapons and
 * point-defence (active offensive/defensive fire) go first, then sensors, then
 * shields, then engines. Protected kinds — the reactor itself, crew quarters,
 * repair bays, and the command bridge — return `undefined` and are never shed:
 * cutting them would either remove the supply, strand the crew, or disarm the
 * ship's ability to recover. A module with no positive power draw also returns
 * `undefined` (shedding it frees no power, so it is not a candidate).
 */
function brownoutPriority(m: SimModule): number | undefined {
  if (m.powerDraw <= 0) return undefined;
  if (m.command) return undefined; // the bridge is never shed
  switch (m.effect.kind) {
    case "weapon":
    case "pointDefense":
      return 0;
    case "sensor":
      return 1;
    case "shield":
      return 2;
    case "engine":
      return 3;
    case "power":
    case "crew":
    case "repair":
      return undefined; // protected: reactor, quarters, repair
    default:
      return undefined; // every other kind is left powered
  }
}

/**
 * Shed powered load until the recovered draw covers `deficitWatts`. Candidates
 * are the alive, power-drawing modules eligible for cutting (see
 * `brownoutPriority`), shed in ascending priority class and, within a class, in
 * ascending `slotId` (lexicographic) so the same modules are always cut first
 * for a given deficit — fully deterministic, no RNG. Each cut sets
 * `powerCut = true` (its consuming systems treat a cut module as offline) and
 * credits its `powerDraw` against the deficit; cutting stops the moment the
 * accumulated freed draw meets or exceeds the shortfall.
 */
function shedBrownoutLoad(ship: SimShip, deficitWatts: number): void {
  if (ship.modules === undefined) return;
  const candidates: { module: SimModule; priority: number }[] = [];
  for (const m of ship.modules) {
    if (!m.alive) continue;
    const priority = brownoutPriority(m);
    if (priority === undefined) continue;
    candidates.push({ module: m, priority });
  }
  candidates.sort((a, b) =>
    a.priority !== b.priority
      ? a.priority - b.priority
      : a.module.slotId < b.module.slotId
        ? -1
        : a.module.slotId > b.module.slotId
          ? 1
          : 0,
  );
  let recovered = 0;
  for (const { module } of candidates) {
    if (recovered >= deficitWatts) break;
    module.powerCut = true;
    recovered += module.powerDraw;
  }
}
