/**
 * Extract one tick's particle sources from live engine state, in fixed order,
 * for {@link gatherParticles}. The thruster extraction mirrors
 * `computeArenaMediumSources` in `medium-setup.ts` (same nozzle world position,
 * exhaust direction, throttle, and jet-power derivation) so exhaust particles
 * land exactly where the medium solver deposits exhaust excitation. Pure: reads
 * state, returns slim source structs. No RNG, array order only — deterministic.
 */

import { cellWorldPosition } from "@/domain/simulation/spatial-hash";
import { MEDIUM_DT_S, TICKS_PER_SECOND } from "./medium-field";
import { MEDIUM_EXHAUST_VELOCITY_M_PER_S } from "./medium-setup";
import type { SimBeam } from "./beams";
import type { SimProjectile, SimShip } from "./types";
import {
  appendParticles,
  gatherParticles,
  stepParticleStore,
  type ParticleBeamSource,
  type ParticleImpactSource,
  type ParticleProjectileSource,
  type ParticleSources,
  type ParticleStore,
  type ParticleThrusterSource,
} from "./exhaust-particles";

/**
 * Build the tick's {@link ParticleSources} from ships, beams, and projectiles:
 *  - thrusters: every firing engine module (throttle > 0), nozzle world
 *    position + exhaust direction + throttle;
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
      const { wx, wy } = cellWorldPosition(ship.x, ship.y, ship.facing, m.x, m.y);
      const exhaustAngle = ship.facing + (m.facing ?? 0) + Math.PI;
      // Real per-tick jet energy. Group and order the arithmetic exactly as
      // `computeArenaMediumSources` in medium-setup.ts (0.5·force·vₑ·dt, with
      // force = thrust·throttle) so the particle's energy and the medium's own
      // epsilon deposit — nominally the same physical jet power — do not diverge
      // by a stray float-rounding difference.
      const jetPowerW = 0.5 * (thrust * ship.engineThrottle) * MEDIUM_EXHAUST_VELOCITY_M_PER_S;
      const energyJ = jetPowerW * MEDIUM_DT_S;
      thrusters.push({
        nozzleX: wx,
        nozzleY: wy,
        dirX: Math.cos(exhaustAngle),
        dirY: Math.sin(exhaustAngle),
        exhaustSpeed: MEDIUM_EXHAUST_VELOCITY_M_PER_S,
        throttle: ship.engineThrottle,
        energyJ,
      });
    }
  }

  const beamChannels: ParticleBeamSource[] = beams.map((b) => ({
    sourceX: b.sourceX,
    sourceY: b.sourceY,
    targetX: b.targetX,
    targetY: b.targetY,
    energyJ: b.damageJ,
  }));

  const wakes: ParticleProjectileSource[] = projectiles.map((p) => {
    // Kinetic energy of the round. p.vx/p.vy are world-units per tick, so scale
    // to m·s⁻¹ by TICKS_PER_SECOND (mirrors weapons.ts's speedMps idiom).
    const speedMps = Math.hypot(p.vx, p.vy) * TICKS_PER_SECOND;
    const energyJ = 0.5 * p.mass * speedMps * speedMps;
    return { x: p.x, y: p.y, energyJ };
  });

  // Impact bursts at each active beam's strike point — the beam dumps energy at
  // its target. Deterministic (beams in array order); no damage-pipeline hook.
  const impacts: ParticleImpactSource[] = beams.map((b) => ({
    x: b.targetX,
    y: b.targetY,
    energyJ: b.damageJ,
  }));

  return { thrusters, beams: beamChannels, projectiles: wakes, impacts };
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
  const emissions = gatherParticles(
    extractParticleSources(ships, beams, projectiles),
    MEDIUM_DT_S,
  );
  appendParticles(particles, emissions);
}
