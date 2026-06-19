/**
 * Active-illumination radar pulses (Phase 8). A pulse is an expanding sphere
 * of EM that propagates at the speed of light (`SPEED_OF_LIGHT_M_PER_TICK` per
 * tick), carrying a bearing/arc (omni or a directional beam) and an optional
 * sweep. When it reaches a target it can spawn a *reflection* — a second
 * sphere at the target's reflection-time position, owned by the emitter, scaled
 * by the target's reflectivity — which is what the emitter eventually receives
 * back (the round trip is the radar range measurement).
 *
 * This module is the honest pulse physics (propagation, reflection, sweep),
 * deterministic and RNG-free. Contact/awareness resolution (light-lagged
 * detections via a spatial index) is Phase 9 — these primitives feed it.
 */

import { SPEED_OF_LIGHT_M_PER_TICK } from "./config";

/** A pulse shape: omni (arc = PI, a full sphere) or directional (narrow arc on
 *  a bearing, optionally sweeping). `arc` is the half-angle (radians) either
 *  side of `bearing`, so the illuminated cone is `[bearing - arc, bearing + arc]`. */
export interface SimPulse {
  readonly id: number;
  /** Whose pulse this is (the emitter's instance id); reflections carry the
   *  emitter's id too so the emitter recognises its own return. */
  readonly emitterId: string;
  /** The contact id this pulse illuminates (set on a reflection), or undefined
   *  for the outbound ping. */
  readonly reflectedFrom?: string;
  originX: number;
  originY: number;
  /** Current sphere radius in metres (grows by c each tick). */
  radius: number;
  /** Centre bearing of the illuminated cone (radians, world). */
  bearing: number;
  /** Half-angle of the cone either side of `bearing` (PI = omni / full sphere). */
  arc: number;
  /** Per-tick bearing increment for a sweeping beam (0 = fixed). */
  sweepRate: number;
  /** Current sweep offset (bearing + sweepAngle is the live centre). */
  sweepAngle: number;
  /** EM strength at the emitter (decays with the sphere's surface area:
   *  1/(4·PI·r^2) for an omni sphere). */
  strength: number;
  /** Tick the pulse was emitted (for round-trip timing). */
  birthTick: number;
  /** Cull the pulse once its radius exceeds this (metres). */
  maxRange: number;
}

/** Advance a pulse one tick: the sphere expands by c, and a sweeping beam
 *  rotates. Returns a new pulse (pure — deterministic, snapshot-friendly);
 *  returns `null` once the pulse has exceeded its max range (cull signal). */
export function advancePulse(pulse: SimPulse): SimPulse | null {
  const radius = pulse.radius + SPEED_OF_LIGHT_M_PER_TICK;
  if (radius > pulse.maxRange) return null;
  return {
    ...pulse,
    radius,
    sweepAngle: pulse.sweepAngle + pulse.sweepRate,
  };
}

/** The live centre bearing of a pulse's cone, including sweep. */
export function pulseBearing(pulse: SimPulse): number {
  return pulse.bearing + pulse.sweepAngle;
}

/** Whether a point at bearing `b` from the pulse origin lies inside the pulse's
 *  illuminated cone (within `arc` of the live bearing). An omni pulse (arc >=
 *  PI) illuminates everything. */
export function pulseIlluminates(pulse: SimPulse, b: number): boolean {
  if (pulse.arc >= Math.PI) return true;
  let delta = b - pulseBearing(pulse);
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta) <= pulse.arc;
}

/** The EM strength of a pulse at radius `r` from its origin. An omni sphere
 *  spreads over its surface area `4·PI·r^2`, so strength falls as `1/r^2`; a
 *  directional beam keeps its strength over the arc it sweeps (a narrow beam
 *  reaches further — the inverse-square only for the omni case). At the origin
 *  (r = 0) the strength is the emitted strength. */
export function pulseStrengthAt(pulse: SimPulse, r: number): number {
  if (r <= 0) return pulse.strength;
  // Power P spread over the wavefront's cross-sectional area. An omni sphere
  // spreads over its surface 4·PI·r^2; a directional beam spreads only over
  // its cone's solid angle (2·PI·(1 - cos arc))·r^2 — so a narrow beam is
  // STRONGER at range (the same power concentrated into a smaller area), not
  // weaker. This is why a radar dish reaches further than an omni ping.
  const omniArea = 4 * Math.PI * r * r;
  if (pulse.arc >= Math.PI) return pulse.strength / omniArea;
  const solidAngle = 2 * Math.PI * (1 - Math.cos(pulse.arc));
  return pulse.strength / (solidAngle * r * r);
}

/** Spawn a reflection of `pulse` at a target's position. The reflection is a
 *  new omni sphere (a target scatters incident EM in all directions) owned by
 *  the original emitter, with strength scaled by the target's `reflectivity`
 *  (0..1; stealth cuts it) and by the incident strength at the target's range.
 *  It expands from the target's reflection-time position back toward the
 *  emitter; the emitter receives it after the round trip. */
export function spawnReflection(
  nextId: number,
  pulse: SimPulse,
  targetId: string,
  targetX: number,
  targetY: number,
  reflectivity: number,
  nowTick: number,
): SimPulse {
  const incident = pulseStrengthAt(pulse, pulse.radius);
  return {
    id: nextId,
    emitterId: pulse.emitterId,
    reflectedFrom: targetId,
    originX: targetX,
    originY: targetY,
    radius: 0,
    bearing: 0,
    arc: Math.PI,
    sweepRate: 0,
    sweepAngle: 0,
    strength: incident * reflectivity,
    birthTick: nowTick,
    maxRange: pulse.maxRange,
  };
}

/** The one-way light travel time (ticks) for distance `d` (metres) —
 *  ceil(d / c). The radar round trip to a target at range d is twice this. */
export function lightTravelTicks(d: number): number {
  return Math.ceil(d / SPEED_OF_LIGHT_M_PER_TICK);
}
