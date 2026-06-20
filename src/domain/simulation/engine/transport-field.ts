/**
 * Conserved-scalar transport field over a ship's cell graph.
 *
 * The advection–diffusion–reaction equation
 *
 *     ∂φ/∂t = −∇·(φv) + ∇·(D∇φ) + S
 *
 * discretised on an explicit finite-volume scheme over an arbitrary cell
 * graph. Each substance (thermal, atmosphere, propellant) is a configuration
 * of this primitive — it selects which terms to enable and supplies the
 * physical coefficients. Boundary fluxes across designated edges (radiators,
 * vents, exhaust nozzles) carry momentum back onto the hull as a reaction
 * force, so venting gas and exhausting propellant produce recoil by the same
 * mechanism.
 *
 * Use-deferred (Phase 12): the field is honestly simulated in real SI units
 * but is not wired into the tick loop. Gameplay *use* (overheat shutdown,
 * asphyxiation, dry-tank, balancing) is a later pass on top of this honest
 * model.
 *
 * Scheme notes
 * ------------
 * Explicit forward-time, centred-space (FTCS) finite volume on a graph of
 * cells of volume `V_i` connected by faces of area `A_ij` and centring
 * distance `d_ij`. For the 1 m ship-local grid with unit faces area and
 * unit volume this collapses to the familiar cell-centred difference.
 *
 * Stability of the explicit diffusion step requires `D·dt·A/(V·d²) ≤ 1/2` per
 * face (the FTCS bound); each substance derives its integration sub-step
 * `dt` from its own diffusivity and the cell geometry so the bound holds by
 * construction rather than by hand-tuning.
 */

/** Speed of light in vacuum, m·s⁻¹ (CODATA 2018 exact). Used only where a
 *  substance's physics genuinely fixes it (e.g. radiative outflux scaling is
 *  independent of c, but exhaust-energy bookkeeping references it). */
export const SPEED_OF_LIGHT_M_PER_S = 299_792_458;

/** Standard gravitational acceleration at Earth's surface, m·s⁻² (CODATA).
 *  Relates specific impulse `Isp` (seconds) to effective exhaust velocity
 *  `v_e = Isp · g₀` — the Tsiolkovsky convention. */
export const STANDARD_GRAVITY_M_PER_S2 = 9.80665;

/** Stefan–Boltzmann constant, W·m⁻²·K⁻⁴ (CODATA 2018 exact via SI redefinition).
 *  Power radiated per unit area of an ideal black body: `j = σT⁴`. Real
 *  radiators approach this with an emissivity factor ≤ 1. */
export const STEFAN_BOLTZMANN_W_PER_M2_K4 = 5.670374419e-8;

/** Simulation tick rate, ticks per second. A documented rate/epsilon
 *  category value (not physics-derived): the engine discretises continuous
 *  time at 30 Hz, matching the rest of the simulation. The transport field's
 *  per-tick `dt` is `1 / TICKS_PER_SECOND` seconds before any stability
 *  sub-stepping. */
export const TICKS_PER_SECOND = 30;

/** Ship-local cell edge length, metres. The layered cell model resolves
 *  interiors at 1 m; transport coefficients are looked up in SI and applied
 *  directly on this grid spacing, so no rescaling is needed. */
export const CELL_EDGE_M = 1;

/** Face area between two face-adjacent 1 m cells, m². */
const FACE_AREA_M2 = CELL_EDGE_M * CELL_EDGE_M;

/** Centring distance between two face-adjacent cell centres, m. */
const CELL_PITCH_M = CELL_EDGE_M;

/** Cell volume for a 1 m cubic cell, m³. */
const CELL_VOLUME_M3 = CELL_EDGE_M * CELL_EDGE_M * CELL_EDGE_M;

/**
 * A directed face on the cell graph: the oriented interface between cell
 * `from` and cell `to`, with an outward unit normal in ship-local metres.
 * `open` flags whether the face is passable (open edge / open door); a
 * closed face (wall / closed door / armor) blocks advection and diffusion.
 * `boundary` marks an outer-hull face across which a boundary flux may pass
 * (radiator, vent, exhaust nozzle).
 */
export interface TransportFace {
  /** Index of the interior cell this face belongs to. */
  from: number;
  /** Index of the neighbouring cell, or `undefined` for a hull boundary. */
  to: number | undefined;
  /** Outward unit normal (ship-local), pointing from `from` toward `to`. */
  nx: number;
  ny: number;
  /** Face area, m². Defaults to `CELL_EDGE_M²` for a unit grid face. */
  area: number;
  /** Whether the face is open to transport (open edge / open door). Walls,
   *  closed doors, and armor are not open. */
  open: boolean;
  /** Whether this face is on the outer hull (no neighbour). Boundary fluxes
   *  (radiation, venting, exhaust) act only across boundary faces. */
  boundary: boolean;
}

/**
 * A substance-specific boundary flux: the rate at which φ leaves (or, for a
 * negative flux, enters) cell `cell` across one of its boundary faces, plus
 * the momentum that flux carries onto the hull. Returning the momentum
 * alongside the scalar flux lets the field conserve momentum across the
 * boundary by the same path for every substance (venting recoils like
 * exhaust).
 *
 * All quantities per second (not per tick): the integrator multiplies by
 * `dt`. `scalarFlux` is in the substance's φ-units per second (W for thermal,
 * kg·s⁻¹ for propellant, kg·s⁻¹ for atmosphere gas). `momentumX/Y` are in
 * Newtons (kg·m·s⁻²).
 */
export interface BoundaryFlux {
  /** Cell index this flux acts on. */
  cell: number;
  /** Outward scalar flux of φ (positive = leaving the cell). */
  scalarFlux: number;
  /** Reaction force on the hull from this flux, Newtons, ship-local axes.
   *  By Newton's third law a flux leaving along +n pushes the hull along
   *  −n; the integrator applies it as-is and the sign convention is the
   *  caller's responsibility. */
  momentumX: number;
  momentumY: number;
}

/**
 * One step's accumulated change to a cell's φ, decomposed for inspection.
 * The integrator sums these per cell and applies them; tests assert the
 * individual terms to verify each piece of the physics in isolation.
 */
export interface TransportDelta {
  /** Net advective flux into the cell (units of φ per second). */
  advection: number;
  /** Net diffusive flux into the cell (units of φ per second). */
  diffusion: number;
  /** Local reaction source/sink (units of φ per second). */
  source: number;
  /** Net boundary flux out of the cell (units of φ per second). */
  boundary: number;
}

/**
 * Per-substance transport configuration. Each field picks the terms it needs:
 *
 *  - thermal: diffusion-only (D = thermal diffusivity; v = 0); boundary flux
 *    = radiator emission `σT⁴·A`.
 *  - atmosphere: advection (bulk flow on a pressure gradient through open
 *    doors/hallways) + diffusion (Fick, D = gas diffusion coefficient) +
 *    sink (crew O₂ consumption) + boundary flux (venting).
 *  - propellant: advection-only along tank→pipe→engine (D = 0); sink =
 *    engine burn; boundary flux = exhaust.
 *
 * `coefficient` is the diffusivity D in m²·s⁻¹ (zero disables diffusion).
 * `velocity` returns the advection velocity (m·s⁻¹) across a face, or zero
 * to disable advection. `source` returns the local reaction term S
 * (φ-units per second). `boundaryFlux` returns the per-boundary-face outflux
 * and its reaction momentum.
 */
export interface TransportSubstance {
  /** Human-readable name (tests, diagnostics). */
  readonly name: string;
  /** Diffusion coefficient D, m²·s⁻¹. Zero disables the diffusion term. */
  readonly coefficient: number;
  /** Upper bound on the advection velocity the closure will return,
   *  m·s⁻¹. The integrator derives its sub-step count from this. Zero (or
   *  omitted) means the substance does not advect. */
  readonly maxVelocity?: number;
  /**
   * Advection velocity across a face, m·s⁻¹, positive along the face's
   * outward normal. Returning zero (or omitting) disables advection. The
   * caller derives this from a pressure gradient (atmosphere) or a piped
   * flow direction (propellant).
   */
  readonly velocity?: (face: TransportFace, phi: readonly number[]) => number;
  /**
   * Local reaction source/sink S for cell `cell`, in φ-units per second.
   * Positive adds φ (a reactor heat source); negative removes it (crew O₂
   * consumption, engine burn).
   */
  readonly source?: (cell: number, phi: readonly number[]) => number;
  /**
   * If true, the integrator clamps each cell's φ to `≥ floor` after every
   * sub-step. Mass-like substances (atmosphere, propellant) set this with
   * `floor = 0` — a cell cannot hold negative mass. Thermal (temperature in
   * kelvin) leaves this off and relies on the physics to stay positive.
   */
  readonly nonNegative?: boolean;
  /** φ floor applied when `nonNegative` is set. Defaults to 0. */
  readonly floor?: number;
  /**
   * Boundary flux for a designated boundary face of `cell`. Substances with
   * no boundary flux (e.g. an enclosed thermal mass with no radiator) return
   * a zero flux, or the caller simply omits the face from the boundary list.
   */
  readonly boundaryFlux?: (
    cell: number,
    phi: readonly number[],
  ) => BoundaryFlux;
}

/**
 * A transport field: the cell graph plus a substance configuration. The
 * field is pure data — `stepTransportField` advances it by one tick and
 * returns the new φ array plus the accumulated hull reaction force, leaving
 * the input untouched (deterministic, testable).
 */
export interface TransportField {
  /** The substance configuration (coefficients, terms). */
  readonly substance: TransportSubstance;
  /** The directed faces of the cell graph. */
  readonly faces: readonly TransportFace[];
  /** Boundary-face cell indices, in a fixed deterministic order. */
  readonly boundaryCells: readonly number[];
}

/** Per-tick time step derived from the tick rate, seconds. The integrator
 *  further sub-steps if a substance's explicit-scheme stability bound
 *  requires it. */
export const TRANSPORT_DT_S = 1 / TICKS_PER_SECOND;

/** FTCS stability margin: the explicit diffusion step is stable when
 *  `D·dt/dx² ≤ 0.5` per face. We run at 0.4 to stay clear of the neutral
 *  stability boundary (a documented numerical choice, not a physical
 *  constant — the rate/epsilon category). */
export const DIFFUSION_CFL_MARGIN = 0.4;

/** CFL stability margin for the explicit upwind advection step: stable when
 *  `|u|·dt/dx ≤ 1`. We run at 0.5 to stay clear of the neutral boundary
 *  (same rate/epsilon category as `DIFFUSION_CFL_MARGIN`). */
export const ADVECTION_CFL_MARGIN = 0.5;

/**
 * Number of explicit sub-steps needed to keep `substance.coefficient` within
 * the FTCS bound over one tick, for a unit-area / unit-pitch face on the 1 m
 * grid. Returns at least 1 (a non-diffusive substance needs no sub-stepping).
 * Derived from `D·(dt/n)/dx² ≤ margin`  ⇒  `n ≥ D·dt/(margin·dx²)`.
 */
export function diffusionSubSteps(coefficient: number): number {
  if (coefficient <= 0) return 1;
  const dx2 = CELL_PITCH_M * CELL_PITCH_M;
  const n = (coefficient * TRANSPORT_DT_S) / (DIFFUSION_CFL_MARGIN * dx2);
  return Math.max(1, Math.ceil(n));
}

/**
 * Number of explicit sub-steps needed to keep the upwind advection step
 * inside its CFL bound: `|u|·(dt/n)/dx ≤ margin` ⇒ `n ≥ |u|·dt/(margin·dx)`.
 */
export function advectionSubSteps(maxVelocity: number): number {
  if (maxVelocity <= 0) return 1;
  const n = (maxVelocity * TRANSPORT_DT_S) / (ADVECTION_CFL_MARGIN * CELL_PITCH_M);
  return Math.max(1, Math.ceil(n));
}

/** Combined sub-step count: the max of the diffusion and advection
 *  requirements, so a substance that both diffuses and advects stays inside
 *  both stability bounds. */
export function transportSubSteps(substance: TransportSubstance): number {
  return Math.max(
    diffusionSubSteps(substance.coefficient),
    advectionSubSteps(substance.maxVelocity ?? 0),
  );
}

/** Result of advancing a transport field by one tick. */
export interface TransportStepResult {
  /** New φ values, same length as the input. */
  phi: number[];
  /** Accumulated reaction force on the hull over the tick, Newtons. */
  momentumX: number;
  momentumY: number;
  /** Per-cell delta breakdown for diagnostics / test assertions. */
  deltas: TransportDelta[];
}

/**
 * Diffusive flux into `cell` from its open faces, φ-units per second.
 *
 * For each open face, the conductance is `D·A/d` and the driving gradient is
 * `φ_to − φ_from`; a boundary face (no neighbour) contributes nothing here
 * (boundary flux is handled separately). Discrete finite-volume form:
 *
 *     dφ/dt|_diff = (D·A/d)·Σ (φ_to − φ_from)
 *
 * On the unit grid (A = d = 1 m) this is just `D·Σ(φ_to − φ_from)`.
 */

/**
 * Advective flux into `cell` from its open faces, φ-units per second, using
 * the first-order upwind scheme. For a face with outward-normal velocity
 * `u = v·n`:
 *
 *   - `u > 0` (flow leaves `cell` toward `to`): the cell loses `u·A·φ_cell`.
 *   - `u < 0` (flow enters `cell` from `to`): the cell gains `|u|·A·φ_to`.
 *
 * Upwinding is the stable choice for the advection term — centred differencing
 * is unconditionally unstable for the explicit scheme. On the unit grid
 * `A = 1 m²` so the per-face contribution is just `u · (upwind φ)`.
 */

/**
 * Advance a transport field by one tick. Pure: returns a new φ array and the
 * accumulated hull reaction force; the input array is untouched. Sub-steps
 * the explicit integrator so the substance's diffusivity stays inside the
 * FTCS bound.
 *
 * Momentum bookkeeping: every boundary flux reports a reaction force in
 * Newtons; the integrator multiplies by `dt` and sums, returning the impulse
 * (kg·m·s⁻¹) applied to the hull over the tick. By construction the impulse
 * from venting a mass `dm` at exhaust velocity `v_e` equals `dm·v_e` — the
 * same as propellant exhaust — so the two recoil by the identical mechanism.
 */
export function stepTransportField(
  field: TransportField,
  phi: readonly number[],
): TransportStepResult {
  const n = phi.length;
  const subSteps = transportSubSteps(field.substance);
  const dt = TRANSPORT_DT_S / subSteps;
  const floor = field.substance.nonNegative ? (field.substance.floor ?? 0) : -Infinity;

  // Work on a mutable copy so the input is untouched (deterministic, pure).
  let current = phi.slice();
  let momentumX = 0;
  let momentumY = 0;
  const deltaAccum: TransportDelta[] = [];
  for (let i = 0; i < n; i += 1) {
    deltaAccum.push({ advection: 0, diffusion: 0, source: 0, boundary: 0 });
  }

  // Precompute: cell -> its faces. The flux functions previously iterated
  // ALL faces per cell (O(cells x total_faces)); this lookup makes each cell's
  // flux O(faces_per_cell ~= 4). Built once here, used every sub-step.
  type Face = (typeof field.faces)[number];
  const facesByCell: Face[][] = Array.from({ length: n }, () => []);
  for (const face of field.faces) {
    const list = facesByCell[face.from];
    if (list !== undefined) list.push(face);
  }
  const boundarySet = new Set(field.boundaryCells);
  const D = field.substance.coefficient;
  const velocity = field.substance.velocity;
  for (let step = 0; step < subSteps; step += 1) {
    const next = current.slice();
    for (let cell = 0; cell < n; cell += 1) {
      const phiHere = current[cell] ?? 0;
      const cellFaces = facesByCell[cell] ?? [];
      // Inline the diffusive + advective flux (iterate only this cell's faces).
      let adv = 0;
      let dif = 0;
      for (const face of cellFaces) {
        if (!face.open) continue;
        if (face.to === undefined) continue;
        const phiThere = current[face.to] ?? 0;
        if (D !== 0) {
          dif += (D * face.area) / CELL_PITCH_M * (phiThere - phiHere);
        }
        if (velocity !== undefined) {
          const u = velocity(face, current);
          if (u !== 0) {
            adv -= u > 0 ? u * face.area * phiHere : u * face.area * phiThere;
          }
        }
      }
      const src =
        field.substance.source?.(cell, current) ?? 0;
      // Boundary flux acts only on designated boundary cells. The flux is a
      // physical rate (kg/s of venting gas, fuel burn, etc.); we cap the
      // amount actually removed this sub-step at what the cell holds above
      // its floor — a cell cannot vent more mass than it contains.
      let bnd = 0;
      if (boundarySet.has(cell)) {
        const bf = field.substance.boundaryFlux?.(cell, current);
        if (bf !== undefined && bf.scalarFlux > 0) {
          const available = (current[cell] ?? 0) - floor;
          const maxRemovable = Math.max(0, available / dt);
          const effective = Math.min(bf.scalarFlux, maxRemovable);
          const scale = bf.scalarFlux === 0 ? 0 : effective / bf.scalarFlux;
          bnd -= effective;
          momentumX += bf.momentumX * dt * scale;
          momentumY += bf.momentumY * dt * scale;
        }
      }
      const dPhi = (adv + dif + src + bnd) * dt;
      let nextVal = (current[cell] ?? 0) + dPhi;
      if (nextVal < floor) {
        // Clamp to floor for mass-like substances: a combination of outfluxes
        // cannot drive a cell below its physical minimum (zero mass, etc.).
        nextVal = floor;
      }
      next[cell] = nextVal;
      // Accumulate per-sub-step into the diagnostics (scaled back to per-second
      // for a clean reading regardless of sub-step count).
      const perSecond = subSteps / TRANSPORT_DT_S;
      const delta = deltaAccum[cell];
      if (delta !== undefined) {
        delta.advection += adv / perSecond;
        delta.diffusion += dif / perSecond;
        delta.source += src / perSecond;
        delta.boundary += bnd / perSecond;
      }
    }
    current = next;
  }

  return { phi: current, momentumX, momentumY, deltas: deltaAccum };
}

/**
 * Total conserved scalar over the field minus what has crossed the boundary.
 * Diffusion and advection are conservative (they only move φ between cells);
 * only sources and boundary fluxes change the total. Tests use this to assert
 * conservation: for a closed field with no sources, the total is invariant.
 */
export function totalScalar(phi: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < phi.length; i += 1) sum += phi[i] ?? 0;
  return sum;
}

/** Shape of the shared cell-geometry constant. */
export interface TransportGeometry {
  readonly cellEdgeM: number;
  readonly faceAreaM2: number;
  readonly cellPitchM: number;
  readonly cellVolumeM3: number;
}

/** Re-exported geometry constants so substance modules and tests share one
 *  source of truth for the cell geometry. */
export const TRANSPORT_GEOMETRY: TransportGeometry = {
  cellEdgeM: CELL_EDGE_M,
  faceAreaM2: FACE_AREA_M2,
  cellPitchM: CELL_PITCH_M,
  cellVolumeM3: CELL_VOLUME_M3,
};
