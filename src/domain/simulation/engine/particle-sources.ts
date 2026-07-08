/**
 * Gather one tick's NEW particle emissions straight from live engine state into
 * a single running array, in fixed order, for {@link appendParticles}. This
 * collapses the prior two-stage extract-then-gather pipeline (which built a
 * `ParticleSources` struct of four source arrays, then spread each source
 * through an `emit*` call that allocated and returned a fresh array) into one
 * pass that writes every parcel directly into `out` via the `push*` emission
 * cores. Iteration order (thrusters, beams, projectile wakes, impacts) and
 * per-source arithmetic are identical to the prior pipeline — byte-identical
 * output, no per-source source-object, spread-object, or throwaway emit array.
 *
 * The thruster extraction mirrors `computeArenaMediumSources` in
 * `medium-setup.ts` (same nozzle world position, exhaust direction, throttle,
 * and jet-power derivation) so exhaust particles land exactly where the medium
 * solver deposits exhaust excitation. The ship-pose trig is hoisted once per
 * ship (`cellWorldPositionCs` is bit-identical to `cellWorldPosition`); a
 * multi-engine ship no longer recomputes cos(facing)/sin(facing) per module.
 * Pure: reads state, no RNG, array order only — deterministic.
 */

import { cellWorldPositionCs } from "@/domain/simulation/spatial-hash";
import { MEDIUM_DT_S, TICKS_PER_SECOND } from "./medium-field";
import { MEDIUM_EXHAUST_VELOCITY_M_PER_S } from "./medium-setup";
import type { SimBeam } from "./beams";
import type { SimProjectile, SimShip } from "./types";
import {
  appendParticles,
  pushBeamChannelParticles,
  pushExhaustParticles,
  pushImpactBurstParticles,
  pushProjectileWakeParticles,
  stepParticleStore,
  type ExhaustParticle,
  type ParticleStore,
} from "./exhaust-particles";

/**
 * Gather this tick's new emissions from ships, beams, and projectiles in the
 * fixed order the prior extract-then-gather pipeline produced — thrusters
 * (ships → modules), then beam channels, then projectile wakes, then impact
 * bursts (a second pass over beams at each strike point). Each parcel is pushed
 * straight into `out`; no intermediate source struct or emit array is built.
 *
 *  - thrusters: every firing engine module (throttle > 0), nozzle world
 *    position + exhaust direction + jet energy;
 *  - beams: every active beam's channel (source → target);
 *  - projectiles: every in-flight round's wake sample;
 *  - impacts: a burst at every active beam's strike point (the target).
 *
 * Iterates ships then modules, then beams, then projectiles, then beams again
 * (impacts), so two same-seed runs build identical emission lists — matching
 * {@link gatherParticles}'s concatenation order byte-for-byte.
 */
export function gatherParticlesFromState(
  ships: readonly SimShip[],
  beams: readonly SimBeam[],
  projectiles: readonly SimProjectile[],
): ExhaustParticle[] {
  const out: ExhaustParticle[] = [];

  // Thrusters: ship-pose trig hoisted once per ship; the exhaust-angle trig
  // depends on m.facing and stays per module. Arithmetic grouped exactly as
  // `computeArenaMediumSources` (0.5·force·vₑ·dt, force = thrust·throttle) so
  // the particle's energy and the medium's epsilon deposit do not diverge.
  for (const ship of ships) {
    const modules = ship.modules;
    if (modules === undefined || ship.engineThrottle <= 0) continue;
    const cosF = Math.cos(ship.facing);
    const sinF = Math.sin(ship.facing);
    for (const m of modules) {
      if (!m.alive) continue;
      const thrust = m.effect.kind === "engine" ? m.effect.thrust : 0;
      if (!(thrust > 0)) continue;
      const { wx, wy } = cellWorldPositionCs(ship.x, ship.y, cosF, sinF, m.x, m.y);
      const exhaustAngle = ship.facing + (m.facing ?? 0) + Math.PI;
      const jetPowerW = 0.5 * (thrust * ship.engineThrottle) * MEDIUM_EXHAUST_VELOCITY_M_PER_S;
      const energyJ = jetPowerW * MEDIUM_DT_S;
      pushExhaustParticles(
        out,
        wx,
        wy,
        Math.cos(exhaustAngle),
        Math.sin(exhaustAngle),
        MEDIUM_EXHAUST_VELOCITY_M_PER_S,
        ship.engineThrottle,
        energyJ,
      );
    }
  }

  // Beam channels: every active beam's source→target line.
  for (const b of beams) {
    pushBeamChannelParticles(out, b.sourceX, b.sourceY, b.targetX, b.targetY, b.damageJ);
  }

  // Projectile wakes: every in-flight round's kinetic energy at its position.
  for (const p of projectiles) {
    // Kinetic energy of the round. p.vx/p.vy are world-units per tick, so scale
    // to m·s⁻¹ by TICKS_PER_SECOND (mirrors weapons.ts's speedMps idiom).
    const speedMps = Math.hypot(p.vx, p.vy) * TICKS_PER_SECOND;
    const energyJ = 0.5 * p.mass * speedMps * speedMps;
    pushProjectileWakeParticles(out, p.x, p.y, energyJ);
  }

  // Impact bursts at each active beam's strike point — the beam dumps energy at
  // its target. Deterministic (beams in array order); no damage-pipeline hook.
  for (const b of beams) {
    pushImpactBurstParticles(out, b.targetX, b.targetY, b.damageJ);
  }

  return out;
}

/**
 * Advance the live plume one tick IN PLACE: step every particle (transport +
 * cool + cull by lifetime), then append this tick's new emissions from every
 * weapon source in fixed order, dropping the oldest when over capacity. One call
 * per tick from the engine loop. Mutates `particles` directly (no allocation for
 * the surviving set), no RNG — deterministic. The prior pure form rebuilt the
 * live array every tick via `step(...).concat(gather(...)).slice(-MAX)`; this is
 * byte-identical to that (see {@link stepParticleStore}'s order-preserving
 * compaction and {@link appendParticles}'s `concat().slice(-MAX)` semantics) but
 * reuses the fixed-capacity store across ticks.
 */
export function stepPlume(
  particles: ParticleStore,
  ships: readonly SimShip[],
  beams: readonly SimBeam[],
  projectiles: readonly SimProjectile[],
): void {
  stepParticleStore(particles, MEDIUM_DT_S);
  const emissions = gatherParticlesFromState(ships, beams, projectiles);
  appendParticles(particles, emissions);
}
