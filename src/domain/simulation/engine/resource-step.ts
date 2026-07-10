/**
 * The per-tick resource step. Advances the transport-field substances —
 * thermal, propellant, atmosphere — and the power energy buffer for each ship,
 * so the honest underlying simulation runs every tick underneath the gameplay
 * layer.
 *
 * VALUES are exposed on the ship's `resource` field, and the resource
 * CONSEQUENCES are enforced:
 *
 *  - Dry-tank flame-out (Gate 1): an alive engine whose cell holds no fuel is
 *    marked `fuelStarved` (movement/aggregates skip it) until fuel returns.
 *  - Brownout (Gate 2): when stored charge plus reactor output cannot meet the
 *    draw, the grid sheds load in a fixed priority (weapons/PD, sensors,
 *    shields, engines; never bridge/quarters/reactor/repair), marking each shed
 *    module `powerCut`.
 *  - Overheat shutdown (Gate 3): an alive cell over `SIM.overheatThresholdK` is
 *    destroyed through the battle-damage death path (break-apart, venting,
 *    next-tick chain reaction all follow).
 *  - Live airtightness: a deck cell breached by a destroyed neighbour vents its
 *    gas to vacuum — recoiling the hull and exposing crew to vacuum damage. An
 *    intact, sealed hull never vents (empty vent mask), so undamaged ships are
 *    unchanged.
 *
 * `fuelStarved`/`powerCut` are recomputed fresh every tick, and the step ends by
 * re-deriving aggregates so later steps (and next tick's movement/firing) read
 * stats reflecting the cuts. A ship with a full buffer, fuelled tanks, and cool
 * radiator-equipped cells carries no consequence and behaves exactly as before.
 *
 * Determinism: the transport graph (and its vent mask), the materialised thermal
 * typed arrays, and the three transport substances are rebuilt only on a
 * topology change (cached on the ship, cleared by `refreshPathCache`); the
 * per-tick substance inputs (engine thrust, crew map, deck mask) are rebuilt
 * into pooled scratch maps each tick in module array order; crew are processed
 * in stable id order; the integrator is the existing pure `stepTransportField`.
 *
 * Cell indexing: modules are sorted by (row, col), numbered 0..n−1, and
 * `ResourceState.moduleIndex` maps `"col,row"` to that index. Only alive module
 * cells participate, keeping n proportional to the module count, not the
 * rectangular footprint.
 */

import { reactorWasteHeatWatts } from "@/data/catalog/combat-scale";
import { specificHeat } from "@/data/catalog/physics";
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
  createResourceTransportWork,
  stepTransportField,
  TRANSPORT_DT_S,
  type TransportFace,
  type TransportField,
  type TransportSubstance,
} from "@/domain/simulation/engine/transport-field";
import {
  makeThermalSubstance,
  materialiseThermalInputs,
  type ThermalArrays,
} from "@/domain/simulation/engine/thermal";
import {
  TICK_DURATION_SECONDS,
  type EnergyBuffer,
  stepEnergyBuffer,
} from "@/domain/simulation/engine/power";
import type { ResourceScratch, ResourceState, SimModule, SimShip } from "@/domain/simulation/engine/types";

/**
 * Full-thrust propellant endurance of a freshly fuelled warship, seconds: how
 * long every engine can burn at rated thrust before its tank runs dry. The tank
 * is sized directly from this — `fuel = burnRate · endurance`, `burnRate =
 * thrust / v_e` (kg·s⁻¹) — making endurance independent of rated thrust and
 * ship mass: a light interceptor and a heavy cruiser both get the same seconds.
 *
 * Endurance, not a Tsiolkovsky Δv, is the right anchor: catalogue thrusts/masses
 * are not yet in SI (config.ts), so an arena-unit thrust ÷ SI exhaust velocity
 * is unit-incoherent. Endurance in seconds sidesteps that and sizes the load to
 * comfortably exceed a full battle of continuous manoeuvring, so an undamaged
 * ship never flames out and the dry-tank consequence (Gate 1) falls only on a
 * ship that burns hard and sustained.
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

/**
 * Per-topology indices folded into the cached transport graph (U10). Each is a
 * pure function of the alive module set at graph-build time, stable across the
 * topology window (no module death → identical alive set every tick), so they
 * are computed once when the graph is built and reused every tick. `deckCells`
 * is NOT folded — see `deckCells` build site for why.
 */
interface SparseTransportGraph extends RectangularTransportGraph {
  /** Dense φ-index → alive module (vent-recoil lever arm). */
  aliveByIndex: ReadonlyMap<number, SimModule>;
  /** Dense φ-index → engine exhaust normal (facing is fixed for life). Read
   *  only for cells with live thrust, gated by the per-tick `engineThrust` map
   *  in `makePropellantSubstance`, so a mid-tick-dead engine is never read. */
  exhaust: ReadonlyMap<number, { nx: number; ny: number }>;
  /** Dense thermal inputs (sources/radiator-mask/heat-capacity), materialised
   *  once per topology window so the thermal substance indexes directly per cell
   *  per sub-step instead of hashing a Map/Set. */
  thermalArrays: ThermalArrays;
  /** Cached transport substances, built once per topology window and reused
   *  every tick. Thermal reads the typed arrays above; propellant/atmosphere
   *  capture the per-tick scratch maps (`engineThrust`, `crewMap`, `deckCells`)
   *  and the graph's pipes/exhaust/ventMask by reference, so they observe the
   *  live per-tick contents (maps cleared+refilled each tick, never
   *  reallocated). Invalidated with the graph on a topology change or checkpoint
   *  restore — both drop `resourceGraph`, forcing a rebuild that re-captures
   *  the (possibly new) scratch + heat capacity. */
  thermalSubstance: TransportSubstance;
  propellantSubstance: TransportSubstance;
  atmosphereSubstance: TransportSubstance;
}

/** Narrow a cached graph to its sparse form. The cache is written solely by
 *  `transportGraph`, which always builds a sparse graph, so this always
 *  succeeds on a cache hit — the type-safe alternative to a cast. */
function isSparseTransportGraph(
  graph: RectangularTransportGraph,
): graph is SparseTransportGraph {
  return (
    "aliveByIndex" in graph &&
    "thermalSubstance" in graph &&
    "exhaust" in graph
  );
}

/**
 * Per-cell heat capacity (J/K): each module's mass × its faction material's
 * specific heat, keyed by the dense module index. A pure function of the
 * module set and index map, so the checkpoint path re-derives it on restore
 * (exact, since the restored modules carry their mass and faction) rather than
 * serializing the map.
 */
export function buildHeatCapacity(
  modules: readonly SimModule[],
  moduleIndex: ReadonlyMap<string, number>,
  faction: string,
): Map<number, number> {
  const cellSpecificHeat = specificHeat(faction);
  const heatCapacity = new Map<number, number>();
  for (const m of modules) {
    const i = moduleIndex.get(cellKey(m.col, m.row));
    if (i !== undefined) heatCapacity.set(i, m.mass * cellSpecificHeat);
  }
  return heatCapacity;
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
  // Cache the dense index on each module (property read vs per-call string
  // alloc + map hash). Populated FROM the map in a second pass so a shared cell
  // (stacked reactor/engine/sensor at one coordinate) preserves the map's
  // last-writer-wins collision: every module at that cell reads the SAME dense
  // index (the cell's one phi-slot). Writing each module's own rank would
  // address different phi-slots and diverge from the map path. `sorted` is a
  // shallow copy sharing `ship.modules`'s object references, so these writes
  // land on the live modules.
  for (const m of sorted) {
    const i = moduleIndex.get(cellKey(m.col, m.row));
    if (i !== undefined) m.transportIndex = i;
  }

  // Thermal: every cell starts at cabin temperature; `Float64Array` avoids boxing churn.
  const thermal = new Float64Array(n).fill(CABIN_TEMPERATURE_K);

  // Atmosphere: deck cells hold a standard cell's gas; `Float64Array` is zero-init.
  const atmosphere = new Float64Array(n);
  for (const m of sorted) {
    if (isDeck(m)) {
      const i = moduleIndex.get(cellKey(m.col, m.row));
      if (i !== undefined) atmosphere[i] = STANDARD_CELL_GAS_MASS_KG;
    }
  }

  // Propellant: each engine cell holds fuel for FULL_THRUST_ENDURANCE_S of
  // continuous burn at its own rated thrust. Burn rate is `thrust / v_e`, so the
  // tank is `burnRate · endurance`. Sizing per engine (not splitting one ship-wide
  // Δv) fuels each nozzle to the same endurance in a mixed-thrust fit.
  const propellant = new Float64Array(n);
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

  // Per-cell heat capacity (J/K): cell mass × the faction material's specific
  // heat. Fixed for the battle (a cell's mass never changes and the index map is
  // stable), so it is built once here and reused every tick by the thermal step.
  const heatCapacity = buildHeatCapacity(sorted, moduleIndex, ship.faction);

  return { moduleIndex, thermal, propellant, atmosphere, powerBuffer, heatCapacity };
}

/** Build (or return the cached) sparse transport graph for the ship's alive
 *  module set. n = number of live modules in `state.moduleIndex`. Faces
 *  connect 4-adjacent alive pairs where the edge between them is open.
 *  Cached on `ship.resourceGraph`; rebuilt only on a topology change. The
 *  graph also carries the folded per-topology indices (`aliveByIndex`,
 *  `exhaust`), the materialised thermal typed arrays, and the three cached
 *  transport substances — all reused across ticks instead of rebuilt.  */
function transportGraph(
  ship: SimShip,
  state: ResourceState,
  scratch: ResourceScratch,
): SparseTransportGraph {
  const cached = ship.resourceGraph;
  if (
    cached !== undefined &&
    cached.fingerprint === (ship.topologyFingerprint ?? 0) &&
    isSparseTransportGraph(cached.graph)
  ) {
    return cached.graph;
  }

  const aliveByKey = new Map<string, SimModule>();
  for (const m of ship.modules ?? []) {
    if (m.alive) aliveByKey.set(cellKey(m.col, m.row), m);
  }
  const n = state.moduleIndex.size;

  const faces: TransportFace[] = [];
  const boundaryIndices = new Set<number>();
  const FACE_AREA = 1; // 1 m² for a unit-grid face

  // Vent breach accumulation. A deck cell vents to vacuum across an open edge/
  // door whose neighbour is no longer an alive sealing cell (the airtightness
  // condition in interior.ts, evaluated live against the alive set). A cell with
  // several breached faces sums their outward normals (opposite breaches cancel
  // recoil). Empty for an intact, sealed hull.
  const ventAccum = new Map<number, { nx: number; ny: number }>();

  // Whether a cell's edge in `edgeKey` is open to flow (open edge / open door).
  const edgeOpen = (m: SimModule, edgeKey: "e" | "w" | "n" | "s"): boolean => {
    const edge = m.edges[edgeKey];
    if (edge === "open") return true;
    if (edge === "door" && m.edges.doorStates[edgeKey] === "open") return true;
    return false;
  };

  // Whether a cell's edge passes transport (gas/heat/fuel). An open edge or any
  // door (a shut door still leaks) carries flow; a wall does not. A shared face
  // requires BOTH cells' facing edges to pass: edges are authored per cell with
  // no symmetry constraint, so a one-sided `open`/`door` against a neighbour's
  // `wall` would make the two half-faces disagree and break finite-volume
  // conservation (one-way inflow accumulates mass to Infinity → NaN). Requiring
  // both edges makes the face symmetric by construction.
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
      // Breach detection: a deck cell vents where a neighbour module that
      // existed at battle start (`toIdx` present) has since died, leaving an
      // open edge/door facing the gap. An open edge toward a position that never
      // held a module is original hull geometry, not a breach. A live neighbour
      // still seals; a wall/closed-door holds against vacuum (matching
      // interior.ts). So a breach opens exactly when battle damage destroys the
      // cell that was sealing this edge.
      const neighbourDied = toIdx !== undefined && !neighbourAlive;
      if (isDeck(fromM) && neighbourDied && edgeOpen(fromM, edgeKey)) {
        const prev = ventAccum.get(fromIdx);
        if (prev === undefined) ventAccum.set(fromIdx, { nx, ny });
        else ventAccum.set(fromIdx, { nx: prev.nx + nx, ny: prev.ny + ny });
        // A breached cell is a boundary cell (the atmosphere/thermal boundary
        // flux acts only on boundary cells) even though a module index entry
        // still sits beyond it.
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

  // Folded per-topology indices (U10). Each is a pure function of this graph's
  // alive set, stable for the topology window, so they rebuild only on a
  // fingerprint change. Iterated in `aliveByKey` insertion order (ship.modules
  // order for alive modules) — the same order the previous per-tick builds used,
  // so the Maps' insertion order is preserved exactly.
  const aliveByIndex = new Map<number, SimModule>();
  const thermalSources = new Map<number, number>();
  const exhaust = new Map<number, { nx: number; ny: number }>();
  for (const [key, m] of aliveByKey) {
    const i = state.moduleIndex.get(key);
    if (i === undefined) continue;
    aliveByIndex.set(i, m);
    if (m.effect.kind === "power") {
      thermalSources.set(i, reactorWasteHeatWatts(m.effect.output));
    }
    if (m.effect.kind === "engine") {
      exhaust.set(i, { nx: Math.cos(m.facing), ny: Math.sin(m.facing) });
    }
  }

  // Materialise the topology-invariant thermal inputs (Map/Set → dense typed
  // arrays) once per graph rebuild so the thermal substance indexes directly per
  // cell per sub-step. The radiator mask IS the boundary cell set; the
  // heat-capacity default is baked in by materialiseThermalInputs.
  const thermalArrays = materialiseThermalInputs(
    thermalSources,
    boundaryCellSet,
    state.heatCapacity,
    n,
  );

  // Cache the three transport substances on the graph (built once per topology
  // window, reused every tick). See SparseTransportGraph for the liveness/
  // invalidation reasoning.
  const thermalSubstance = makeThermalSubstance(
    thermalArrays.sources,
    thermalArrays.radiators,
    thermalArrays.heatCapacity,
  );
  const propellantSubstance = makePropellantSubstance(
    scratch.engineThrust,
    openInteriorPipes,
    exhaust,
  );
  const atmosphereSubstance = makeAtmosphereSubstance(
    scratch.crewMap,
    ventMask,
    scratch.deckCells,
  );

  const graph: SparseTransportGraph = {
    faces,
    facesFrom,
    boundaryCells,
    boundaryCellSet,
    openInteriorPipes,
    ventMask,
    aliveByIndex,
    exhaust,
    thermalArrays,
    thermalSubstance,
    propellantSubstance,
    atmosphereSubstance,
  };
  ship.resourceGraph = { graph, fingerprint: ship.topologyFingerprint ?? 0 };
  return graph;
}

/**
 * Advance one ship's resource state by one tick. Fetches the cached transport
 * graph + substances, refills the per-tick scratch, steps each field, and steps
 * the power buffer. Pure and deterministic (see file header). Ships without
 * modules have no resource state and the step is a no-op.
 */
export function resourceStep(ship: SimShip): void {
  runResourceStep(ship, () => (m: SimModule) => m.transportIndex);
}

/**
 * REFERENCE (oracle) resource step: the naive map-lookup path, kept for the
 * equivalence test (`engine.resource-step.equivalence.unit.test.ts`). Not wired
 * into production. Resolves each module's dense index by allocating a
 * `"col,row"` string and hashing `moduleIndex` per call — the lookup the cached
 * `m.transportIndex` read replaces. Both return the same value (cache populated
 * FROM the map), so the step is byte-identical.
 */
export function resourceStepReference(ship: SimShip): void {
  runResourceStep(
    ship,
    (state) => (m: SimModule) => state.moduleIndex.get(cellKey(m.col, m.row)),
  );
}

/**
 * Shared resource-step core. `idx` is the ONLY difference between the optimised
 * and reference paths (property read vs string-alloc + map hash); both return
 * the same value, so the rest — graph/substance fetch, consequence enforcement
 * — is shared and byte-identical. The folded per-topology indices and the three
 * cached transport substances are read from the cached graph, not rebuilt per
 * tick.
 */
function runResourceStep(
  ship: SimShip,
  makeIdx: (state: ResourceState) => (m: SimModule) => number | undefined,
): void {
  if (ship.modules === undefined) return;
  const state = ship.resource;
  if (state === undefined) return;

  // Pooled scratch (see ResourceScratch): cleared, not reallocated, each tick.
  // Lazily allocated BEFORE the graph fetch so the graph's cache-build site can
  // capture the scratch maps in the cached propellant/atmosphere substances; a
  // checkpoint restore rebuilds the state without it (and without
  // resourceGraph), so both re-warm together.
  if (state.scratch === undefined) {
    // Dense typed arrays sized to n (invariant for the ship's lifetime).
    const scratchN = state.thermal.length;
    state.scratch = { engineThrust: new Float64Array(scratchN), crewMap: new Int32Array(scratchN), deckCells: new Uint8Array(scratchN), crewOrder: [] };
  }
  // Persistent per-substance transport ping-pong buffers, reused every tick
  // (mirrors ArenaMedium.work). Lazily built, never serialised — a checkpoint
  // restore rebuilds state without these, and the φ arrays restore by value.
  if (state.transportWork === undefined) {
    state.transportWork = createResourceTransportWork(state.thermal.length);
  }
  const scratch = state.scratch;
  const work = state.transportWork;

  const graph = transportGraph(ship, state, scratch);
  const idx = makeIdx(state);

  scratch.engineThrust.fill(0);
  scratch.crewMap.fill(0);
  scratch.deckCells.fill(0);
  scratch.crewOrder.length = 0;

  // Resource consequences are recomputed fresh every tick: clear the previous
  // tick's flame-out and grid-shed verdicts before the substance steps re-derive
  // them from the new field state, so a tank that refilled or a buffer that
  // recovered un-cuts the affected modules. Iterated in fixed module-array order.
  for (const m of ship.modules) {
    m.fuelStarved = false;
    m.powerCut = false;
  }

  // --- Thermal substance ---
  // Heat sources (alive reactors' WASTE heat, not electrical output — see
  // `reactorWasteHeatWatts`) and per-cell heat capacity are folded into the
  // cached graph as dense typed arrays (`graph.thermalArrays`), stable across
  // the topology window. The radiator surface is `graph.boundaryCellSet`. The
  // thermal substance itself is cached on the graph and reused every tick.
  const thermalField: TransportField = {
    substance: graph.thermalSubstance,
    faces: graph.faces,
    facesFrom: graph.facesFrom,
    boundaryCells: graph.boundaryCells,
    boundaryCellSet: graph.boundaryCellSet,
  };
  state.thermal = stepTransportField(thermalField, state.thermal, undefined, work.thermal).phi;

  // Gate 3 — Overheat shutdown. An alive cell over the failure threshold is
  // killed through the battle-damage death path (HPs zeroed, `alive` cleared) so
  // every downstream effect follows: aggregates drop it, break-apart (4c)
  // re-evaluates connectivity, the vent mask treats it as a dead neighbour next
  // graph rebuild, a volatile cell detonates next tick. Iterated in fixed
  // module-array order, no RNG.
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
  // Per-tick engine thrust command: each alive engine's rated thrust scaled by
  // `ship.engineThrottle`. Exhaust normals are folded into the cached graph
  // (`graph.exhaust`); only the magnitude is rebuilt here.
  // Fused single pass over ship.modules (was three O(modules) scans): builds
  // engineThrust, the deckCells mask, and the net-power running sum. Aliveness
  // is stable from the overheat pass above through to the power budget below
  // (transport steps and crew-vacuum pass touch fields/crew, not module.alive),
  // and fixed module-array order throughout keeps Map/Set insertion order and
  // the source-before-sink net order byte-identical to the old three-loop path.
  const throttle = ship.engineThrottle;
  const engineThrust = scratch.engineThrust;
  const deckCells = scratch.deckCells;
  let net = 0;
  for (const m of ship.modules) {
    if (!m.alive) continue;
    if (m.effect.kind === "engine" && throttle > 0) {
      const i = idx(m);
      if (i !== undefined) engineThrust[i] = m.effect.thrust * throttle;
    }
    // Deck cells are NOT folded into the cached graph: the overheat pass above
    // can kill a deck cell mid-tick after the graph is fetched.
    if (isDeck(m)) {
      const i = idx(m);
      if (i !== undefined) deckCells[i] = 1;
    }
    if (m.effect.kind === "power") {
      net += m.effect.output;
    }
    if (m.powerDraw > 0) {
      net -= m.powerDraw;
    }
  }
  // Pipes: every open interior face is part of the fuel manifold. The pre-built
  // set from the cached graph avoids O(n_faces) string allocations per tick. The
  // propellant substance is cached on the graph and captures `engineThrust` by
  // reference, so it reads the live per-tick thrust map.
  const propellantField: TransportField = {
    substance: graph.propellantSubstance,
    faces: graph.faces,
    facesFrom: graph.facesFrom,
    boundaryCells: graph.boundaryCells,
    boundaryCellSet: graph.boundaryCellSet,
  };
  state.propellant = stepTransportField(propellantField, state.propellant, undefined, work.propellant).phi;

  // Gate 1 — Dry-tank flame-out. An alive engine commanded to thrust this tick
  // (`throttle > 0`) whose cell holds no fuel is marked `fuelStarved` (movement/
  // aggregates skip it). An idle engine on a coasting ship is not starved — it
  // was not asked to burn. Recomputed fresh every tick (cleared at step top), so
  // a refilled tank resumes thrust immediately. Iterated in fixed module-array
  // order, no RNG.
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
  const crewMap = scratch.crewMap;
  if (ship.crew !== undefined) {
    for (const c of ship.crew) {
      const i = state.moduleIndex.get(cellKey(c.col, c.row));
      if (i !== undefined) crewMap[i] = (crewMap[i] ?? 0) + 1;
    }
  }
  // Vents: the live vent mask from the alive-cell topology (empty for an intact,
  // sealed hull). The atmosphere substance is cached on the graph and captures
  // `crewMap`/`deckCells` by reference (deckCells is built in the fused pass
  // above); its `breached` flag is a pure function of `graph.ventMask`,
  // recomputed when the graph is rebuilt.
  const atmosphereField: TransportField = {
    substance: graph.atmosphereSubstance,
    faces: graph.faces,
    facesFrom: graph.facesFrom,
    boundaryCells: graph.boundaryCells,
    boundaryCellSet: graph.boundaryCellSet,
  };
  const atmosphereResult = stepTransportField(atmosphereField, state.atmosphere, undefined, work.atmosphere);
  state.atmosphere = atmosphereResult.phi;

  // Vent recoil: net reaction force from gas escaping every breach, applied at
  // the mass-weighted centroid of the venting cells (an off-centre breach pushes
  // and spins). The field returns SI impulse (kg·m·s⁻¹); the engine's momentum
  // is per-tick (velocity in metres/tick), so scale by `TRANSPORT_DT_S` and
  // rotate ship-local → world axes for `applyImpulse` (application point stays
  // in the ship-local design frame).
  if (
    graph.ventMask.size > 0 &&
    (atmosphereResult.momentumX !== 0 || atmosphereResult.momentumY !== 0)
  ) {
    // Centroid of the breached cells in ship-local coordinates. Iterated in
    // vent-mask insertion order (deterministic: module index is sorted).
    let cx = 0;
    let cy = 0;
    let count = 0;
    for (const cellIdx of graph.ventMask.keys()) {
      const m = graph.aliveByIndex.get(cellIdx);
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
    const ordered = scratch.crewOrder;
    for (const c of ship.crew) ordered.push(c);
    ordered.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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
  // Net power for this tick: the running sum accumulated in the fused pass
  // above (alive reactor outputs minus module draws, source-before-sink per
  // module in module-array order) — the same value the old terminal-array build
  // plus netPower produced.
  const bufferBefore = state.powerBuffer.energy;
  state.powerBuffer = stepEnergyBuffer(state.powerBuffer, net);

  // Gate 2 — Brownout enforcement. The buffer rides through transient spikes,
  // but once stored charge cannot cover the reactor-vs-draw shortfall the grid
  // sheds load. The deficit (W) is `-(bufferBefore/dt + net)` — positive only
  // when charge plus reactor output fall short of draw·dt over the tick. Shed
  // in fixed priority order until the recovered draw covers it.
  const deficitWatts = -(bufferBefore / TICK_DURATION_SECONDS + net);
  if (deficitWatts > 0) shedBrownoutLoad(ship, deficitWatts);

  // Re-derive aggregates so the shield-regen/repair steps this tick and next
  // tick's movement/firing read values reflecting the cuts. `recomputeAggregates`
  // is pure over the live module flags; its gate already honours `powerCut` and
  // `fuelStarved`, so a ship with no consequences recomputes to identical
  // aggregates.
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
    case "deflector":
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
