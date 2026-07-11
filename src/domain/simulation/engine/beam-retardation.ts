/**
 * Retarded-time (finite-speed-of-light) beam weapons.
 *
 * Beam weapons apply damage at the retarded time `fire_tick + floor(range / c)`,
 * where `c = SPEED_OF_LIGHT_M_PER_TICK`. At every real/preset battle's scale
 * (tens of km) `range / c < 1`, so `floor(range / c) === 0` and the beam
 * resolves on the SAME tick it is fired — byte-identical to the prior hitscan
 * code. The delayed path only engages at light-second ranges, which no preset
 * battle reaches.
 *
 * Two entry points:
 *  - {@link queueIfRetarded} — called from `fireOne` at fire time; returns true
 *    when the beam is deferred (delay > 0), false when it should resolve now.
 *  - {@link applyDueBeamImpacts} — called at the top of the tick loop before
 *    `fireWeapons`; applies the damage of every pending beam whose light front
 *    arrives this tick, re-resolving against the target's CURRENT hull.
 */

import type { WeaponEffect } from "@/schema/module";
import { DEFLECTOR_PIERCING_DEFAULT } from "@/data/catalog/combat-scale";
import { SPEED_OF_LIGHT_M_PER_TICK, SIM } from "./config";
import { applyImpact } from "./damage-impact";
import { beamImpactProfile } from "./impact-profile";
import { outerWorldLoop, rayPolygonEntry } from "./poly-collision";
import { penetrationPath, type PenetrationPathScratch } from "./penetration-path";
import type { PendingBeamImpact, SimBeam } from "./beams";
import type { EngineState } from "./state";
import type { SimShip } from "./types";

/**
 * Test whether a beam's light front is still in flight at the fire-time range,
 * and if so queue a {@link PendingBeamImpact} for later resolution. Returns
 * `true` when the beam is deferred (the caller must `return` immediately,
 * skipping the same-tick damage + render path); `false` when the beam should
 * resolve now (delay 0, the common case at battlefield scale).
 *
 * Pure: no rng, no clock, no mutation beyond appending to the caller's array.
 */
export function queueIfRetarded(
  pendingBeamImpacts: PendingBeamImpact[],
  tick: number,
  range: number,
  ship: SimShip,
  target: SimShip,
  source: { wx: number; wy: number },
  dirX: number,
  dirY: number,
  damage: number,
  weapon: WeaponEffect,
): boolean {
  const beamDelayTicks = Math.floor(range / SPEED_OF_LIGHT_M_PER_TICK);
  if (beamDelayTicks <= 0) return false;
  // Light-lag: the beam's energy is still in flight. Defer the strike to the
  // tick the light front reaches the fire-time range. At battlefield scales
  // range << c so this branch is never taken; it engages only at light-second
  // range, keeping every preset battle byte-identical to hitscan.
  pendingBeamImpacts.push({
    sourceId: ship.instanceId,
    targetId: target.instanceId,
    originX: ship.x,
    originY: ship.y,
    dirX,
    dirY,
    damageJ: damage,
    shieldPiercing: weapon.shieldPiercing,
    armourPiercing: weapon.armourPiercing,
    deflectorPiercing: weapon.deflectorPiercing ?? DEFLECTOR_PIERCING_DEFAULT.beam,
    weaponType: weapon.weaponType,
    sourceX: source.wx,
    sourceY: source.wy,
    applyAtTick: tick + beamDelayTicks,
  });
  return true;
}

/**
 * Apply beam impacts whose light front arrives this tick. Each pending beam is
 * re-resolved against the target's CURRENT hull along the fire-time ray (the
 * target may have moved during the light-time); if the ray no longer
 * intersects, the beam misses. Processed in fire (insertion) order for
 * determinism. A no-op when `state.pendingBeamImpacts` is empty (every preset
 * battle), so the delay-0 byte-identity contract holds.
 */
export function applyDueBeamImpacts(
  state: EngineState,
  tick: number,
  penetrationPathScratch: PenetrationPathScratch,
): void {
  if (state.pendingBeamImpacts.length === 0) return;
  const remaining: PendingBeamImpact[] = [];
  for (const imp of state.pendingBeamImpacts) {
    if (imp.applyAtTick > tick) {
      remaining.push(imp);
      continue;
    }
    // applyAtTick === tick (a < tick entry cannot occur — the processor runs
    // every tick — but if it did, dropping it is the safe degradation).
    const target = state.byId.get(imp.targetId);
    if (target === undefined || !target.alive) continue; // miss / destroyed
    // Re-resolve the fire-time ray against the target's CURRENT hull. The
    // target may have moved during the light-time, so the stored origin/direction
    // is retraced; if the ray no longer intersects, the beam misses (dodged).
    const outline = outerWorldLoop(target);
    let ix: number;
    let iy: number;
    if (outline !== undefined) {
      const entry = rayPolygonEntry(imp.originX, imp.originY, imp.dirX, imp.dirY, outline);
      if (entry === null) continue; // dodged — ray no longer hits the hull
      ix = entry.x;
      iy = entry.y;
    } else {
      ix = target.x + imp.dirX * target.radius;
      iy = target.y + imp.dirY * target.radius;
    }
    const beamPath = outline !== undefined
      ? penetrationPath(target, ix, iy, imp.dirX, imp.dirY, penetrationPathScratch)
      : undefined;
    applyImpact(
      target,
      beamImpactProfile({
        damageJ: imp.damageJ,
        shieldPiercing: imp.shieldPiercing,
        armourPiercing: imp.armourPiercing,
        deflectorPiercing: imp.deflectorPiercing,
      }),
      ix,
      iy,
      Math.atan2(imp.dirY, imp.dirX),
      beamPath,
      imp.dirX,
      imp.dirY,
    );
    // Push a render beam so the renderer draws the deferred strike line.
    const beam: SimBeam = {
      sourceId: imp.sourceId,
      sourceX: imp.sourceX,
      sourceY: imp.sourceY,
      targetX: ix,
      targetY: iy,
      kind: imp.weaponType,
      damageJ: imp.damageJ,
      emissionTicks: SIM.beamEmissionTicks,
    };
    state.beams.push(beam);
  }
  state.pendingBeamImpacts = remaining;
}
