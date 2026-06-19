/**
 * Sensor and comms units: per-module detection/coverage helpers, comms-link
 * formation, and the dish-aim pass for steerable relays.
 */

import { segmentBlocked } from "@/domain/occluders";
import type { Disc } from "@/domain/occluders";
import type { AwarenessSnapshot, BattleAnomaly } from "@/schema/battle";
import type { CommsEffect, SensorEffect } from "@/schema/module";

import { SIM } from "./config";
import { angleDifference } from "./setup";
import type { SimModule, SimShip } from "./types";

/** A comms unit on a ship, paired with its host for the link/aim passes. */
export interface CommsUnit {
  ship: SimShip;
  module: SimModule;
  effect: CommsEffect;
}

/** A sensor module on a ship, paired with its host for the detection pass. */
export interface SensorUnit {
  ship: SimShip;
  module: SimModule;
  effect: SensorEffect;
}

/** One coverage shape in a cluster's rendered footprint: a circle (bearing/arc
 *  absent) or a sector (both present). The element type the AwarenessSnapshot
 *  schema declares for `clusters[].coverage`. */
export type CoverageShape = AwarenessSnapshot["clusters"][number]["coverage"][number];

/** Alive sensor modules on a ship, in (col, row) module-array order. A crewed
 *  sensor (crewRequired > 0, e.g. a dish) is only included when it is manned;
 *  a crewless sensor is always manned. */
export function sensorUnitsOf(ship: SimShip): SensorUnit[] {
  const out: SensorUnit[] = [];
  if (ship.modules === undefined) return out;
  for (const m of ship.modules) {
    if (!m.alive) continue;
    const effect = m.effect;
    if (effect.kind !== "sensor") continue;
    // A sensor that needs crew contributes only when manned; a crewless one is
    // always manned (recomputeManning sets manned = true for it).
    if (m.crewRequired > 0 && !m.manned) continue;
    out.push({ ship, module: m, effect });
  }
  return out;
}

/** Effective detection range of a sensor unit. Variable units interpolate
 *  between their range bounds using the per-instance `sensorRangeSetting`
 *  (a longer range trades down the arc; see `effectiveSensorArc`); every other
 *  type uses the static effect range. */
export function effectiveSensorRange(unit: SensorUnit): number {
  const { effect, module } = unit;
  if (effect.sensorType !== "variable") return effect.detectionRange;
  const minR = effect.minRange ?? effect.detectionRange;
  const maxR = effect.maxRange ?? effect.detectionRange;
  const desired = module.sensorRangeSetting;
  if (desired === undefined) return maxR;
  return Math.max(minR, Math.min(maxR, desired));
}

/** Effective half-arc of a sensor unit. Variable units trade arc against range:
 *  at minimum range the arc is widest (`maxArc`), at maximum range narrowest
 *  (`minArc`), interpolating linearly with the chosen range. Every other type
 *  uses the static effect arc. */
export function effectiveSensorArc(unit: SensorUnit): number {
  const { effect } = unit;
  if (effect.sensorType !== "variable") return effect.arc;
  const minR = effect.minRange ?? effect.detectionRange;
  const maxR = effect.maxRange ?? effect.detectionRange;
  const minA = effect.minArc ?? effect.arc;
  const maxA = effect.maxArc ?? effect.arc;
  const range = effectiveSensorRange(unit);
  const span = maxR - minR;
  const t = span > 0 ? (range - minR) / span : 0;
  return maxA + (minA - maxA) * t;
}

/** World-space bearing (radians) a sensor unit's cone is centred on: its
 *  ship-local mount bearing rotated by the ship's facing. */
export function effectiveSensorBearing(unit: SensorUnit): number {
  return unit.module.sensorBearing + unit.ship.facing;
}

/** Effective range of a sensor unit after anomaly attenuation. In a nebula a
 *  non-immune sensor's range is scaled by `nebulaSensorFactor`; an immune one
 *  (active LIDAR / gravimetric) keeps its full range. */
export function attenuatedSensorRange(unit: SensorUnit, anomaly: BattleAnomaly): number {
  const range = effectiveSensorRange(unit);
  if (anomaly !== "nebula") return range;
  return unit.effect.nebulaImmune ? range : range * SIM.nebulaSensorFactor;
}

/** The ship's innate omni visual radius after anomaly attenuation. The naked-eye
 *  / short-range passive circle every ship has; a nebula halves it (it is never
 *  immune). */
export function attenuatedVisualRadius(anomaly: BattleAnomaly): number {
  const r = SIM.visualLosRadius;
  return anomaly === "nebula" ? r * SIM.nebulaSensorFactor : r;
}

/** Whether `observer` detects `enemy` this tick (line-of-sight permitting):
 *  the enemy lies inside the innate omni visual circle OR inside any of the
 *  observer's alive (manned-if-crewed) sensor cones. A cone hit needs
 *  `dist <= effRange` AND the bearing within the cone's half-arc; an omni
 *  sensor (arc === Math.PI) is a full circle and skips the angle test. */
export function sensorDetects(
  observer: SimShip,
  enemy: SimShip,
  anomaly: BattleAnomaly,
): boolean {
  const dx = enemy.x - observer.x;
  const dy = enemy.y - observer.y;
  const distSq = dx * dx + dy * dy;
  // Innate omni visual circle — always present, no angle test.
  const visual = attenuatedVisualRadius(anomaly);
  if (distSq <= visual * visual) return true;
  // Any sensor cone covering the enemy.
  const toEnemy = Math.atan2(dy, dx);
  for (const unit of sensorUnitsOf(observer)) {
    const range = attenuatedSensorRange(unit, anomaly);
    if (distSq > range * range) continue;
    const arc = effectiveSensorArc(unit);
    // An omni sensor's arc is Math.PI: |angleDifference| <= PI always holds, so
    // the cone is a full circle. Directional/dish/variable test the bearing.
    if (arc >= Math.PI) return true;
    const bearing = effectiveSensorBearing(unit);
    if (Math.abs(angleDifference(bearing, toEnemy)) <= arc) return true;
  }
  return false;
}

/** Alive comms modules on a ship, in module-array order. */
export function commsUnitsOf(ship: SimShip): CommsUnit[] {
  const out: CommsUnit[] = [];
  if (ship.modules === undefined) return out;
  for (const m of ship.modules) {
    if (!m.alive) continue;
    const effect = m.effect;
    if (effect.kind !== "comms") continue;
    out.push({ ship, module: m, effect });
  }
  return out;
}

/** Threat score of an enemy from a ship's position: nearer and costlier enemies
 *  score higher. Distance dominates; cost is a small tie-shaper. */
export function contactThreat(ship: SimShip, enemy: SimShip): number {
  const dx = enemy.x - ship.x;
  const dy = enemy.y - ship.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return -dist + SIM.threatCostWeight * enemy.cost;
}

/** Effective comms range of a unit. Variable units interpolate between their
 *  range bounds using the per-instance `commsRange` setting (a longer range
 *  trades down the arc; see `variableArc`); every other type uses the static
 *  effect range. */
export function effectiveCommsRange(unit: CommsUnit): number {
  const { effect, module } = unit;
  if (effect.commsType !== "variable") return effect.range;
  const minR = effect.minRange ?? effect.range;
  const maxR = effect.maxRange ?? effect.range;
  // commsRange is the desired range; clamp into [minR, maxR]. Absent => maxR.
  const desired = module.dishRangeSetting;
  if (desired === undefined) return maxR;
  return Math.max(minR, Math.min(maxR, desired));
}

/** Effective half-arc of a unit. Variable units trade arc against range: at
 *  minimum range the arc is widest (`maxArc`), at maximum range narrowest
 *  (`minArc`), interpolating linearly with the chosen range. Every other type
 *  uses the static effect arc. */
export function effectiveCommsArc(unit: CommsUnit): number {
  const { effect } = unit;
  if (effect.commsType !== "variable") return effect.arc;
  const minR = effect.minRange ?? effect.range;
  const maxR = effect.maxRange ?? effect.range;
  const minA = effect.minArc ?? effect.arc;
  const maxA = effect.maxArc ?? effect.arc;
  const range = effectiveCommsRange(unit);
  // Fraction of the way from min to max range; 0 at minR (=> maxArc), 1 at maxR.
  const span = maxR - minR;
  const t = span > 0 ? (range - minR) / span : 0;
  return maxA + (minA - maxA) * t;
}

/** World-space bearing (radians) a comms unit's antenna points along: a dish
 *  uses its live auto-aimed `dishAngle` (a world angle set by the aim pass);
 *  every other type points along its mount bearing rotated by the ship's
 *  facing. */
export function effectiveCommsBearing(unit: CommsUnit): number {
  if (unit.effect.commsType === "dish") return unit.module.dishAngle;
  return unit.module.commsBearing + unit.ship.facing;
}

/** Whether `unit` on its ship can cover the point (tx, ty): the target lies
 *  within the unit's half-arc about its effective world bearing. Omni units
 *  (arc = PI) always pass since |angleDifference| <= PI. */
export function unitCovers(unit: CommsUnit, tx: number, ty: number): boolean {
  const bearing = effectiveCommsBearing(unit);
  const toTarget = Math.atan2(ty - unit.ship.y, tx - unit.ship.x);
  return Math.abs(angleDifference(bearing, toTarget)) <= effectiveCommsArc(unit);
}

/** Whether a comms unit is currently able to operate: a dish or laser (any
 *  crewed unit) must be manned. Crewless units are always manned. */
export function commsUnitOperable(unit: CommsUnit): boolean {
  return unit.module.manned;
}

/** A formed comms link between two units on two different same-side ships. */
export interface CommsLink {
  side: "attacker" | "defender";
  a: CommsUnit;
  b: CommsUnit;
  type: CommsEffect["commsType"];
}

/**
 * Whether a candidate pair of comms units (ua on A, ub on B) forms a link this
 * tick. Both must share a channel and lie within the shorter of the two ranges,
 * each must cover the other within its arc, and a laser pair additionally
 * requires both units manned and clear line of sight. A dish is already gated
 * to manned by the aim pass; omni/directional pass the manning gate trivially
 * (crewRequired 0) or via their crew. The two ships are guaranteed same-side and
 * distinct by the caller.
 */
export function linkForms(
  ua: CommsUnit,
  ub: CommsUnit,
  occluders: readonly Disc[],
): boolean {
  if (ua.module.channel !== ub.module.channel) return false;
  const a = ua.ship;
  const b = ub.ship;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distSq = dx * dx + dy * dy;
  const range = Math.min(effectiveCommsRange(ua), effectiveCommsRange(ub));
  if (distSq > range * range) return false;
  if (!unitCovers(ua, b.x, b.y)) return false;
  if (!unitCovers(ub, a.x, a.y)) return false;
  // A laser link is a tight beam: both ends must be manned and nothing may
  // block the segment. An RF link (omni/directional/dish/variable) passes
  // through occluders. Manning of crewed RF units is already required for the
  // unit to be operable (enforced where units are gathered).
  if (ua.effect.commsType === "laser" || ub.effect.commsType === "laser") {
    if (!ua.module.manned || !ub.module.manned) return false;
    if (segmentBlocked(a.x, a.y, b.x, b.y, occluders)) return false;
  }
  return true;
}

/**
 * Aim every manned steerable dish on one side at the nearest channel-compatible
 * same-side ally within range, setting its live world `dishAngle`. Runs before
 * link formation so a dish that has slewed onto an ally can then form a link
 * with it. Processed in (shipId, slotId) order; the ally tie-break is the ally
 * instanceId. A dish with no candidate keeps its previous bearing and simply
 * forms no link this tick (linkForms still fails its arc test against anyone it
 * isn't pointing at).
 */
export function aimDishes(units: readonly CommsUnit[]): void {
  for (const unit of units) {
    if (unit.effect.commsType !== "dish") continue;
    if (!unit.module.manned) continue;
    const range = effectiveCommsRange(unit);
    let best: SimShip | undefined;
    let bestDistSq = range * range;
    for (const other of units) {
      if (other.ship === unit.ship) continue;
      if (other.module.channel !== unit.module.channel) continue;
      const dx = other.ship.x - unit.ship.x;
      const dy = other.ship.y - unit.ship.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > range * range) continue;
      if (
        distSq < bestDistSq ||
        (distSq === bestDistSq &&
          best !== undefined &&
          other.ship.instanceId < best.instanceId)
      ) {
        bestDistSq = distSq;
        best = other.ship;
      }
    }
    if (best !== undefined) {
      unit.module.dishAngle = Math.atan2(best.y - unit.ship.y, best.x - unit.ship.x);
    }
  }
}
