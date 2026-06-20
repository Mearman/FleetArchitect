/**
 * Propellant substance: fuel mass transported by advection only along a
 * tank→pipe→engine graph, consumed by engine burn, exhausted for thrust.
 *
 * φ = fuel mass per cell (kg). Pipied plumbing, not diffusive: fuel moves
 * along the pipe graph at a commanded flow rate, not by Fickian spreading, so
 * the diffusion coefficient is zero. The sink is engine burn (kg·s⁻¹ from
 * `thrust / (Isp · g₀)`), and the boundary flux is the exhaust nozzle —
 * `dm/dt = thrust / (Isp · g₀)` leaving at `v_e = Isp · g₀`, giving the
 * Tsiolkovsky thrust `F = dm/dt · v_e = thrust`. Momentum conservation:
 * exhaust impulse equals the impulse the field reports, so the same boundary
 * flux path that vents atmosphere also drives the engine.
 *
 * Use-deferred: fuel mass is honestly simulated and feeds the integrator
 * (mass falls ⇒ acceleration rises ⇒ Tsiolkovsky Δv), but a dry tank does
 * not yet derelict the ship, and the fuel UI is a later pass.
 */

import {
  STANDARD_GRAVITY_M_PER_S2,
  type BoundaryFlux,
  type TransportFace,
  type TransportSubstance,
} from "@/domain/simulation/engine/transport-field";

/**
 * Reference specific impulse, seconds. A chemical orbital manoeuvring
 * engine sits around 300–320 s; we use 320 s as the design point (hydrogen-
 * oxygen upper-stage class). `v_e = Isp · g₀ ≈ 3138 m·s⁻¹`.
 */
export const REFERENCE_ISP_S = 320;

/** Effective exhaust velocity, m·s⁻¹: `v_e = Isp · g₀`. The Tsiolkovsky
 *  relation between fuel burn rate and thrust. */
export const EXHAUST_VELOCITY_M_PER_S = REFERENCE_ISP_S * STANDARD_GRAVITY_M_PER_S2;

/**
 * Tank→pipe→engine flow speed, m·s⁻¹. Fuel moves along the pipe graph at a
 * fixed commanded rate when an engine is burning upstream; this is a plumbing
 * flow rate, not a fluid-dynamics derivation — a feed pump rating.
 */
export const PROPELLANT_FLOW_SPEED_M_PER_S = 1.0;

/** Per-engine thrust command, newtons. Map: engine cell index → thrust being
 *  produced. The caller derives this from the live throttle / module state. */
export type EngineThrustMap = ReadonlyMap<number, number>;

/** Pipe adjacency: the set of unordered cell-pair keys identifying plumbed
 *  edges. Use `pipeKey` to build a key; fuel flows along these edges toward
 *  the burning engine. Numeric keys avoid per-lookup string allocation. */
export type PipeAdjacency = ReadonlySet<number>;

/** Per-engine outward exhaust normal (ship-local). The nozzle points along
 *  this direction; thrust pushes the ship along −normal. */
export type ExhaustNormals = ReadonlyMap<number, { nx: number; ny: number }>;

/**
 * Serialise an unordered cell pair into a stable numeric key. The stride is
 * chosen large enough that no two distinct pairs `(a, b)` with a ≤ b share a
 * key across any realistic ship grid (cells < 65536).
 */
const PIPE_KEY_STRIDE = 65536;
export function pipeKey(a: number, b: number): number {
  return a < b ? a * PIPE_KEY_STRIDE + b : b * PIPE_KEY_STRIDE + a;
}

/**
 * Build a propellant substance configuration.
 *
 * `engineThrust` is the per-engine-cell thrust command (N); `pipes` is the
 * plumbing adjacency the fuel flows along; `exhaust` is the per-engine nozzle
 * normal. The sink rate per burning engine is `thrust / v_e` (kg·s⁻¹), and
 * the exhaust boundary flux carries that same mass out at `v_e` along the
 * nozzle normal — impulse `dm·v_e = thrust·dt`, exactly the engine thrust.
 */
export function makePropellantSubstance(
  engineThrust: EngineThrustMap,
  pipes: PipeAdjacency,
  exhaust: ExhaustNormals,
): TransportSubstance {
  return {
    name: "propellant",
    // Advection-only: piped, not diffusive.
    coefficient: 0,
    maxVelocity: PROPELLANT_FLOW_SPEED_M_PER_S,
    nonNegative: true,
    floor: 0,
    velocity: (face: TransportFace, phi: readonly number[]): number => {
      // Flow only along plumbed edges, toward a burning engine. The pipe is
      // symmetric: fuel moves from whichever end has fuel toward whichever
      // end is a burning engine. For a face `from → to`, positive velocity
      // means fuel leaves `from` (toward `to`); we return +v when `to` is
      // the burning engine and `from` has fuel, −v when `from` is the
      // burning engine and `to` has fuel, and 0 otherwise.
      if (face.to === undefined) return 0;
      if (!pipes.has(pipeKey(face.from, face.to))) return 0;
      const burnTo = engineThrust.get(face.to) ?? 0;
      const burnFrom = engineThrust.get(face.from) ?? 0;
      const phiFrom = phi[face.from] ?? 0;
      const phiTo = phi[face.to] ?? 0;
      if (burnTo > 0 && phiFrom > 0) {
        // Fuel leaves `from` toward the burning engine at `to`.
        return PROPELLANT_FLOW_SPEED_M_PER_S;
      }
      if (burnFrom > 0 && phiTo > 0) {
        // Fuel leaves `to` toward the burning engine at `from` — i.e. enters
        // `from` from the pipe, which is a negative velocity along this
        // face's outward normal.
        return -PROPELLANT_FLOW_SPEED_M_PER_S;
      }
      return 0;
    },
    source: () => {
      // Engines do not consume fuel locally — the burn mass leaves through
      // the exhaust boundary flux, which is where thrust is produced. Keeping
      // the sink at the boundary (not the source) lets one path account for
      // both the mass loss and the thrust impulse.
      return 0;
    },
    boundaryFlux: (cell, phi): BoundaryFlux => {
      const thrust = engineThrust.get(cell) ?? 0;
      if (thrust <= 0) {
        return { cell, scalarFlux: 0, momentumX: 0, momentumY: 0 };
      }
      const mass = phi[cell] ?? 0;
      // Burn rate: dm/dt = thrust / v_e. If the tank is dry there is nothing
      // to burn — the flux is zero and the engine flames out.
      const burnRate = thrust / EXHAUST_VELOCITY_M_PER_S;
      if (mass <= 0) {
        return { cell, scalarFlux: 0, momentumX: 0, momentumY: 0 };
      }
      const normal = exhaust.get(cell) ?? { nx: 0, ny: -1 };
      // Thrust force = burnRate · v_e = thrust (by construction). Pushes the
      // ship along −normal (Newton's third law: exhaust leaves along
      // +normal, ship recoils along −normal).
      return {
        cell,
        scalarFlux: burnRate,
        momentumX: -normal.nx * thrust,
        momentumY: -normal.ny * thrust,
      };
    },
  };
}

/**
 * Steady-state delta-v from burning a fuel mass `deltaM` (kg) from a ship of
 * dry mass `dryMass` (kg), via the Tsiolkovsky rocket equation:
 *
 *     Δv = v_e · ln((dryMass + fuelMass) / dryMass)
 *
 * Tests use this as the physics anchor for mass depletion → Δv.
 */
export function tsiolkovskyDeltaV(
  dryMassKg: number,
  fuelMassKg: number,
): number {
  return EXHAUST_VELOCITY_M_PER_S * Math.log((dryMassKg + fuelMassKg) / dryMassKg);
}

/** Fuel mass consumed to produce a given total impulse `F·dt` (N·s):
 *  `dm = impulse / v_e`. */
export function fuelMassForImpulse(impulseNewtonSeconds: number): number {
  return impulseNewtonSeconds / EXHAUST_VELOCITY_M_PER_S;
}
