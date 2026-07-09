/**
 * Medium source-term deposits: the per-tick injection of mass (ρ), excitation
 * (ε, εVis), and momentum into the arena medium's per-cell source buffers.
 *
 * Extracted from `medium-setup.ts` so the deposit logic (which grows as more
 * emitters — impact bursts, cooling-particle residuals — deposit into the field)
 * sits in its own module under the 800-line lint cap. The coupling constants and
 * the `mediumCellIndex` helper remain in `medium-setup.ts` (they are shared with
 * the field-setup path); this module imports them.
 *
 * Determinism contract: fixed iteration order, no RNG, ADDITIVE writes into the
 * caller-cleared source buffers. Identical inputs plus identically-cleared
 * arrays give byte-identical deposits, so the optimised and reference compute
 * paths (both call {@link depositMediumSources}) agree.
 */

import { MEDIUM_DT_S, type MediumField } from "./medium-field";
import { rasterSegmentCells } from "./medium-raster";
import {
  ASTEROID_PARTULATE_PER_CELL_KG,
  BODY_DRAG_COEFFICIENT,
  DEBRIS_SHED_FRACTION_PER_TICK,
  EXHAUST_RHO_COUPLING,
  IMPACT_EPS_VIS_COUPLING,
  MEDIUM_EXHAUST_VELOCITY_M_PER_S,
  NEBULA_FILL_FRACTION_PER_TICK,
  NEBULA_TARGET_CELL_KG,
  PROJECTILE_WAKE_EPS_COUPLING,
  PROJECTILE_WAKE_RHO_COUPLING,
  THERMAL_EPS_COUPLING_FRACTION,
  WAKE_EPS_COUPLING,
  mediumCellIndex,
  type MediumImpactEntry,
  type ProjectileMediumEntry,
} from "./medium-setup";
import { cellWorldPositionCs } from "@/domain/simulation/spatial-hash";
import type { BattleAnomalyKind } from "@/schema/battle";
import { hasAnomaly } from "@/domain/anomaly";
import type { SimShip } from "./types";
import type { Debris } from "./debris";

/**
 * Shared medium-source deposit core. Writes the per-tick sources (thruster
 * exhaust, debris ablation, projectile wakes + plumes, nebula and asteroid
 * fills, body-drag wakes) into the five given arrays, ADDING to what they hold.
 * The caller clears first (optimised: `.fill(0)` in place; reference: fresh
 * zeroed arrays). Deterministic fixed iteration order, no RNG; identical inputs
 * plus identically-cleared arrays give byte-identical deposits, so the two
 * paths agree.
 */
export function depositMediumSources(
  field: MediumField,
  liveRho: ArrayLike<number>,
  ships: readonly SimShip[],
  debris: readonly Debris[],
  projectiles: ReadonlyArray<ProjectileMediumEntry>,
  anomalies: readonly BattleAnomalyKind[],
  asteroidSourceCells: readonly number[],
  rho: Float64Array,
  eps: Float64Array,
  epsVisSrc: Float64Array,
  mxSrc: Float64Array,
  mySrc: Float64Array,
  impacts: ReadonlyArray<MediumImpactEntry>,
): void {
  const cellCount = field.cellCount;

  // --- Thruster exhaust: every firing engine cell deposits a fraction of its
  // expelled propellant mass as local density and jet power as excitation. ---
  for (const ship of ships) {
    const modules = ship.modules;
    if (modules === undefined || ship.engineThrottle <= 0) continue;
    // Hoist ship-pose trig per ship (cellWorldPositionCs ≡ cellWorldPosition).
    const cosF = Math.cos(ship.facing);
    const sinF = Math.sin(ship.facing);
    for (const m of modules) {
      if (!m.alive) continue;
      const thrust = m.effect.kind === "engine" ? m.effect.thrust : 0;
      if (!(thrust > 0)) continue;
      const burnFraction = ship.engineThrottle;
      const forceN = thrust * burnFraction;
      const massBurnedKg = (forceN / MEDIUM_EXHAUST_VELOCITY_M_PER_S) * MEDIUM_DT_S;
      if (massBurnedKg <= 0) continue;
      const { wx, wy } = cellWorldPositionCs(ship.x, ship.y, cosF, sinF, m.x, m.y);
      const exhaustAngle = ship.facing + (m.facing ?? 0) + Math.PI;
      const exDx = Math.cos(exhaustAngle);
      const exDy = Math.sin(exhaustAngle);

      const mainDepositKg = massBurnedKg * EXHAUST_RHO_COUPLING;
      const jetPowerW = 0.5 * forceN * MEDIUM_EXHAUST_VELOCITY_M_PER_S;
      const epsDepositJ = jetPowerW * THERMAL_EPS_COUPLING_FRACTION * MEDIUM_DT_S;
      const mainIdx = mediumCellIndex(
        field,
        Math.floor(wx / field.config.pitchM + field.config.widthM / 2),
        Math.floor(wy / field.config.pitchM + field.config.heightM / 2),
      );
      // ε (heat) at the nozzle cell — unchanged from before the velocity
      // substrate. The excitation feeds sensor signatures; keeping it here
      // preserves the existing battle behaviour.
      if (mainIdx !== null) {
        eps[mainIdx] = (eps[mainIdx] ?? 0) + epsDepositJ;
        epsVisSrc[mainIdx] = (epsVisSrc[mainIdx] ?? 0) + epsDepositJ;
      }
      // Conserved mass (ρ) + backward momentum one cell DOWNSTREAM (not at the
      // nozzle) so the ship never sits in its own exhaust mass (no self-drag).
      // The tiny coupling means negligible drag/sensor impact, but u = mx/ρ
      // stays at exhaust velocity so the plume streams. ε at 0.25× (unchanged).
      const downstreamIdx = mediumCellIndex(
        field,
        Math.floor((wx + exDx * field.config.pitchM) / field.config.pitchM + field.config.widthM / 2),
        Math.floor((wy + exDy * field.config.pitchM) / field.config.pitchM + field.config.heightM / 2),
      );
      if (downstreamIdx !== null && downstreamIdx !== mainIdx) {
        rho[downstreamIdx] = (rho[downstreamIdx] ?? 0) + mainDepositKg;
        eps[downstreamIdx] = (eps[downstreamIdx] ?? 0) + epsDepositJ * 0.25;
        epsVisSrc[downstreamIdx] = (epsVisSrc[downstreamIdx] ?? 0) + epsDepositJ * 0.25;
        mxSrc[downstreamIdx] = (mxSrc[downstreamIdx] ?? 0) + mainDepositKg * MEDIUM_EXHAUST_VELOCITY_M_PER_S * exDx;
        mySrc[downstreamIdx] = (mySrc[downstreamIdx] ?? 0) + mainDepositKg * MEDIUM_EXHAUST_VELOCITY_M_PER_S * exDy;
      }
    }
  }

  // --- Debris ablation: each drifting fragment sheds a small fraction of its
  // mass as particulate density in the cell it currently occupies. Cold debris
  // sources no excitation in the baseline model. ---
  for (const d of debris) {
    const idx = mediumCellIndex(
      field,
      Math.floor(d.x / field.config.pitchM + field.config.widthM / 2),
      Math.floor(d.y / field.config.pitchM + field.config.heightM / 2),
    );
    if (idx === null) continue;
    rho[idx] = (rho[idx] ?? 0) + (d.mass ?? 0) * DEBRIS_SHED_FRACTION_PER_TICK;
  }

  // --- Projectile wake + burning-motor plume: every round displaces and heats
  // a thin column along its per-tick path. A POWERED round with fuel remaining
  // also injects an exhaust plume (same SI coupling as ship exhaust: mass-flow
  // from `F = thrust·mass` over `MEDIUM_EXHAUST_VELOCITY_M_PER_S` plus a thermal
  // fraction of the jet power) so the plume tapers to nothing at burnout.
  // Iteration is in projectile array order for determinism. ---
  for (const pos of projectiles) {
    const idx = mediumCellIndex(
      field,
      Math.floor(pos.x / field.config.pitchM + field.config.widthM / 2),
      Math.floor(pos.y / field.config.pitchM + field.config.heightM / 2),
    );
    if (idx === null) continue;
    // Wake (every round): a tiny displacement + heating along the path. The
    // signature/mass substrates (eps, rho) deposit at the endpoint as before; the
    // VISUAL substrate (epsVis, renderer-only — never feeds AI signatures or
    // dazzle) is distributed along the swept prev→current segment so a fast round
    // leaves a continuous trail instead of per-tick dots.
    rho[idx] = (rho[idx] ?? 0) + PROJECTILE_WAKE_RHO_COUPLING;
    eps[idx] = (eps[idx] ?? 0) + PROJECTILE_WAKE_EPS_COUPLING;
    const wakeCells = rasterSegmentCells(field, pos.prevX, pos.prevY, pos.x, pos.y);
    if (wakeCells.length > 0) {
      const wakePerCell = PROJECTILE_WAKE_EPS_COUPLING / wakeCells.length;
      for (let i = 0; i < wakeCells.length; i += 1) {
        const c = wakeCells[i];
        if (c === undefined) continue;
        epsVisSrc[c] = (epsVisSrc[c] ?? 0) + wakePerCell;
      }
    }
    // Burning-motor plume (powered rounds with fuel). The motor force is
    // `F = thrust · mass` (thrust is an acceleration in m·s⁻²); the mass-flow
    // and jet-power derivations are identical to the ship-exhaust path above,
    // so a missile plume and a thruster plume of the same force read identically.
    if (pos.powered && pos.burnTicks > 0 && pos.thrust > 0) {
      const forceN = pos.thrust * Math.max(pos.mass, 1e-6);
      const massBurnedKg = (forceN / MEDIUM_EXHAUST_VELOCITY_M_PER_S) * MEDIUM_DT_S;
      const mainDepositKg = massBurnedKg * EXHAUST_RHO_COUPLING;
      const jetPowerW = 0.5 * forceN * MEDIUM_EXHAUST_VELOCITY_M_PER_S;
      const epsDepositJ = jetPowerW * THERMAL_EPS_COUPLING_FRACTION * MEDIUM_DT_S;
      rho[idx] = (rho[idx] ?? 0) + mainDepositKg;
      eps[idx] = (eps[idx] ?? 0) + epsDepositJ;
    }
  }

  // --- Impact bursts: a beam strike or projectile hit dumps energy at a point;
  // a fraction thermalises into the visual substrate for a brief flash. epsVis
  // only — never feeds AI signatures or dazzle. Iteration in array order. ---
  for (const impact of impacts) {
    const idx = mediumCellIndex(
      field,
      Math.floor(impact.x / field.config.pitchM + field.config.widthM / 2),
      Math.floor(impact.y / field.config.pitchM + field.config.heightM / 2),
    );
    if (idx === null) continue;
    epsVisSrc[idx] = (epsVisSrc[idx] ?? 0) + impact.energyJ * IMPACT_EPS_VIS_COUPLING * MEDIUM_DT_S;
  }

  // --- Nebula anomaly: fill every cell toward a dense target, proportional to
  // the gap between the target and the cell's CURRENT density. Sourcing the gap
  // (not a fixed amount) means a cell already at target stops sourcing, and the
  // field converges to the target with the documented fill timescale. ---
  if (hasAnomaly(anomalies, "nebula")) {
    for (let i = 0; i < cellCount; i += 1) {
      const rhoHere = liveRho[i] ?? 0;
      const gap = NEBULA_TARGET_CELL_KG - rhoHere;
      if (gap > 0) rho[i] = (rho[i] ?? 0) + gap * NEBULA_FILL_FRACTION_PER_TICK;
    }
  }

  // --- Asteroid field anomaly: iterate the precomputed source-cell list (from
  // computeAsteroidSourceCells). Cold rock sources density, no excitation. ---
  for (let i = 0; i < asteroidSourceCells.length; i += 1) {
    const idx = asteroidSourceCells[i];
    if (idx === undefined) continue;
    rho[idx] = (rho[idx] ?? 0) + ASTEROID_PARTULATE_PER_CELL_KG;
  }

  // --- Body drag → wake: a ship moving through the medium displaces it. The
  //     drag reaction deposits momentum (a wake behind the body) and the
  //     dissipated KE becomes heat (ε — a glowing wake in dense medium). In
  //     thin ISM this is negligible; in a nebula a fast ship leaves a faint
  //     disturbance trail. ---
  for (const ship of ships) {
    if (!ship.alive) continue;
    const speedTick = Math.hypot(ship.velX, ship.velY);
    if (speedTick < 0.5) continue;
    const speedMps = speedTick / MEDIUM_DT_S;
    const idx = mediumCellIndex(
      field,
      Math.floor(ship.x / field.config.pitchM + field.config.widthM / 2),
      Math.floor(ship.y / field.config.pitchM + field.config.heightM / 2),
    );
    if (idx === null) continue;
    const rhoHere = liveRho[idx] ?? 0;
    if (rhoHere <= 0) continue;
    const density = rhoHere / (field.config.pitchM * field.config.pitchM);
    const dragForce = 0.5 * density * speedMps * speedMps * BODY_DRAG_COEFFICIENT * (2 * ship.radius);
    if (dragForce <= 0) continue;
    const dirX = ship.velX / speedTick;
    const dirY = ship.velY / speedTick;
    mxSrc[idx] = (mxSrc[idx] ?? 0) + dragForce * dirX;
    mySrc[idx] = (mySrc[idx] ?? 0) + dragForce * dirY;
    epsVisSrc[idx] = (epsVisSrc[idx] ?? 0) + dragForce * speedMps * WAKE_EPS_COUPLING;
  }
}
