/**
 * Extract one tick's particle sources from live engine state, in fixed order,
 * for {@link gatherParticles}. The thruster extraction mirrors
 * `computeArenaMediumSources` in `medium-setup.ts` (same nozzle world position,
 * exhaust direction, throttle, and jet-power derivation) so exhaust particles
 * land exactly where the medium solver deposits exhaust excitation. Pure: reads
 * state, returns slim source structs. No RNG, array order only — deterministic.
 */

import { cellWorldPosition } from "@/domain/simulation/spatial-hash";
import { MEDIUM_DT_S } from "./medium-field";
import { MEDIUM_EXHAUST_VELOCITY_M_PER_S } from "./medium-setup";
import type { SimBeam } from "./beams";
import type { SimProjectile, SimShip } from "./types";
import {
  gatherParticles,
  stepExhaustParticles,
  type ExhaustParticle,
  type ParticleBeamSource,
  type ParticleImpactSource,
  type ParticleProjectileSource,
  type ParticleSources,
  type ParticleThrusterSource,
} from "./exhaust-particles";

/**
 * Impact-burst energy proxy at a beam strike point, W. A beam dumps energy at
 * its target; `SimBeam` carries no energy, so a constant proxy tuned for a clear
 * strike-point flash.
 */
const BEAM_IMPACT_ENERGY_W = 1e6;

/**
 * Build the tick's {@link ParticleSources} from ships, beams, and projectiles:
 *  - thrusters: every firing engine module (throttle > 0), nozzle world
 *    position + exhaust direction + jet power;
 *  - beams: every active beam's channel (source → target);
 *  - projectiles: every in-flight round's wake sample;
 *  - impacts: a burst at every active beam's strike point (the target).
 *
 * Iterates ships then modules, then beams, then projectiles in array order, so
 * two same-seed runs build identical source lists.
 */
export function extractParticleSources(
  ships: readonly SimShip[],
  beams: readonly SimBeam[],
  projectiles: readonly SimProjectile[],
): ParticleSources {
  const thrusters: ParticleThrusterSource[] = [];
  for (const ship of ships) {
    const modules = ship.modules;
    if (modules === undefined || ship.engineThrottle <= 0) continue;
    for (const m of modules) {
      if (!m.alive) continue;
      const thrust = m.effect.kind === "engine" ? m.effect.thrust : 0;
      if (!(thrust > 0)) continue;
      const forceN = thrust * ship.engineThrottle;
      const { wx, wy } = cellWorldPosition(ship.x, ship.y, ship.facing, m.x, m.y);
      const exhaustAngle = ship.facing + (m.facing ?? 0) + Math.PI;
      thrusters.push({
        nozzleX: wx,
        nozzleY: wy,
        dirX: Math.cos(exhaustAngle),
        dirY: Math.sin(exhaustAngle),
        exhaustSpeed: MEDIUM_EXHAUST_VELOCITY_M_PER_S,
        throttle: ship.engineThrottle,
        jetPower: 0.5 * forceN * MEDIUM_EXHAUST_VELOCITY_M_PER_S,
      });
    }
  }

  const beamChannels: ParticleBeamSource[] = beams.map((b) => ({
    sourceX: b.sourceX,
    sourceY: b.sourceY,
    targetX: b.targetX,
    targetY: b.targetY,
  }));

  const wakes: ParticleProjectileSource[] = projectiles.map((p) => ({
    x: p.x,
    y: p.y,
  }));

  // Impact bursts at each active beam's strike point — the beam dumps energy at
  // its target. Deterministic (beams in array order); no damage-pipeline hook.
  const impacts: ParticleImpactSource[] = beams.map((b) => ({
    x: b.targetX,
    y: b.targetY,
    energy: BEAM_IMPACT_ENERGY_W,
  }));

  return { thrusters, beams: beamChannels, projectiles: wakes, impacts };
}

/**
 * Advance the live plume one tick: step every particle (transport + cool + cull
 * by lifetime), then gather this tick's new emissions from every weapon source
 * in fixed order. One call per tick from the engine loop. Pure: returns a fresh
 * array, inputs untouched, no RNG — deterministic.
 */
export function stepPlume(
  particles: readonly ExhaustParticle[],
  ships: readonly SimShip[],
  beams: readonly SimBeam[],
  projectiles: readonly SimProjectile[],
): ExhaustParticle[] {
  return stepExhaustParticles(particles, MEDIUM_DT_S).concat(
    gatherParticles(extractParticleSources(ships, beams, projectiles), MEDIUM_DT_S),
  );
}
