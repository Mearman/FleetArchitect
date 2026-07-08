/**
 * The per-observer direct-detection step of the awareness phase (step b in
 * {@link computeAwareness}): each alive observer scans its enemy side and forms
 * a contact for every enemy whose continuous EM emission it receives, while
 * accumulating sensor dazzle. Extracted into its own module so the lossless
 * early-out ({@link hullReceptionIsNegligible}) and its frozen reference oracle
 * ({@link buildDirectContactsReference} in `awareness.reference.ts`) sit beside
 * the optimised path for A/B equivalence testing.
 *
 * Determinism contract: zero rng, observer order is instanceId (the `alive`
 * list is already sorted), enemy order is instanceId (the side arrays are a
 * filter of `alive`). Map insertion order matches the discarded one-tick
 * allocation exactly (see `AwarenessScratch`).
 */

import { segmentBlocked } from "@/domain/occluders";
import type { Disc } from "@/domain/occluders";
import type { BattleAnomalyKind } from "@/schema/battle";

import { SPEED_OF_LIGHT_M_PER_TICK } from "./config";
import { aberratedContactPosition } from "./optics-aberration";
import {
  continuousEmissionStrength,
  effectiveReceiverFloor,
  emReceives,
  hullDazzleContribution,
  receptionShift,
  sensorGain,
} from "./em-reception";
import { DAZZLE_THRESHOLD_MULT } from "./em-anchors";
import { contactThreat, effectiveSensorRange } from "./sensors";
import type { SensorUnit } from "./sensors";
import type { Contact, SimShip } from "./types";
import type { AwarenessScratch } from "./awareness";

/** The enemy-side arrays built once per tick in `alive` order by
 *  {@link computeAwareness}: `attacker` holds the defenders (enemies an
 *  attacker faces), `defender` holds the attackers. */
export interface EnemiesBySide {
  readonly attacker: SimShip[];
  readonly defender: SimShip[];
}

/**
 * The maximum receiver gain available to `observerSensors` under the
 * anomaly-free case (the only case the early-out fires in): the baseline eye
 * (gain 1) or any live sensor's `sensorGain` at its unattenuated range,
 * whichever is larger. Mirrors the gain `emReceives` tests against, so "below
 * 1/maxGain" means no receiver — baseline or sensor — can clear the floor.
 */
export function observerMaxReceptionGain(observerSensors: readonly SensorUnit[]): number {
  let maxGain = 1; // baseline eye, gain 1 (no nebula when the early-out fires)
  for (const unit of observerSensors) {
    const range = effectiveSensorRange(unit.effect, unit.module);
    if (range <= 0) continue;
    const gain = sensorGain(range);
    if (gain > maxGain) maxGain = gain;
  }
  return maxGain;
}

/**
 * Strict-upper-bound early-out for one (observer, enemy) hull-reception pair.
 * Reports when the pair is PROVABLY negligible — it can form no contact AND
 * contribute no dazzle — so the full {@link emReceives} + occlusion +
 * aberration path can be skipped without changing a single frame byte.
 *
 * The bound is exact in the geometry and emission (`continuousEmissionStrength`,
 * the separation, the observer's effective floor and max receiver gain are all
 * computed exactly) and STRICT in the relativistic reception shift. With no
 * anomaly the shift is purely Doppler, `D² = (1-β)/(1+β)`, which is maximised
 * at the most negative (approaching) radial β. `|β_radial| ≤ |v_rel|/c ≤
 * (|v_observer| + |v_enemy|)/c` by the triangle inequality, so
 * `D² ≤ (1+β_bound)/(1-β_bound)` with `β_bound = (|v_o|+|v_e|)/c` — a strict
 * upper bound computed only from the two speed magnitudes (no radial
 * projection, no light-crossing solver). Valid only in the anomaly-free case
 * (the caller gates on `anomalies.length === 0`); under any anomaly — black-hole
 * gravitational redshift, nebula attenuation — the bound is not computed and
 * the full path runs. The lossless digest gate covers the anomaly-free case.
 *
 * Skip iff the bound is below BOTH downstream floors:
 *  - the dazzle floor {@link DAZZLE_THRESHOLD_MULT}: below it `dazzleBoost` is
 *    exactly 0, so the dazzle accumulator is unchanged whether the pair is
 *    occluded or not (an occluded pair also contributes 0).
 *  - `1/maxGain`: below it no receiver can pull the emission above the floor,
 *    so no contact forms regardless of arc.
 */
export function hullReceptionIsNegligible(
  observer: SimShip,
  enemy: SimShip,
  /** Precomputed `sqrt(observer.vx² + observer.vy²)`. */
  observerSpeedMag: number,
  /** Precomputed {@link observerMaxReceptionGain} for this observer. */
  observerMaxGain: number,
  /**
   * The precomputed `continuousEmissionStrength(enemy)`, when the caller has
   * already evaluated it. `buildDirectContacts` hoists this once per pair so the
   * same evaluation feeds the bound here AND the full emission product threaded
   * into the dazzle and reception paths. When omitted the function computes its
   * own — same float, same bound.
   */
  precomputedEnemyEmission?: number,
): boolean {
  const dx = enemy.x - observer.x;
  const dy = enemy.y - observer.y;
  const distSq = dx * dx + dy * dy;
  // Coincident → no inverse-square falloff; always run the full path.
  if (distSq <= 0) return false;
  const enemySpeedMag = Math.sqrt(enemy.velX * enemy.velX + enemy.velY * enemy.velY);
  const betaBound = (observerSpeedMag + enemySpeedMag) / SPEED_OF_LIGHT_M_PER_TICK;
  // At/above light-speed relative motion the Doppler bound is singular; the
  // full path handles it (ship speeds are far below c, so this never fires).
  if (betaBound >= 1) return false;
  const dMaxSq = (1 + betaBound) / (1 - betaBound); // strict upper bound on D²
  const emission = precomputedEnemyEmission ?? continuousEmissionStrength(enemy);
  const floor = effectiveReceiverFloor(observer);
  // Strict upper bound on the received strength as a multiple of the floor.
  const receivedFloorBound = (emission * dMaxSq) / (4 * Math.PI * distSq * floor);
  return receivedFloorBound < DAZZLE_THRESHOLD_MULT && receivedFloorBound * observerMaxGain < 1;
}

/**
 * Per-observer direct detection: each observer scans its enemy side, accumulates
 * sensor dazzle for every non-occluded enemy, and forms a contact for every
 * enemy it receives. Returns the `observerId → Contact[]` map (a cleared-and-
 * refilled entry on `scratch.directContacts`, with per-observer reusable inner
 * arrays on `scratch.directContactLists`).
 *
 * The anomaly-free early-out ({@link hullReceptionIsNegligible}) skips the full
 * reception path for pairs PROVABLY below every downstream floor — a lossless
 * saving for the many far-apart pairs early in a battle. Under any anomaly the
 * early-out is disabled and the full path runs unchanged.
 */
export function buildDirectContacts(
  alive: readonly SimShip[],
  occluders: readonly Disc[],
  anomalies: readonly BattleAnomalyKind[],
  dazzleAccum: Map<string, number>,
  enemiesBySide: EnemiesBySide,
  scratch: AwarenessScratch,
): Map<string, Contact[]> {
  const directContacts = scratch.directContacts;
  directContacts.clear();
  // The early-out's Doppler bound is strict only in the anomaly-free case.
  const earlyOut = anomalies.length === 0;
  for (const observer of alive) {
    let list = scratch.directContactLists.get(observer.instanceId);
    if (list === undefined) {
      list = [];
      scratch.directContactLists.set(observer.instanceId, list);
    } else {
      list.length = 0;
    }
    const enemies =
      observer.side === "attacker" ? enemiesBySide.attacker : enemiesBySide.defender;
    // Precomputed once per observer per tick by computeAwareness and shared
    // with the medium-reception pass. `observer` is drawn from `alive`, and
    // `scratch.sensorsByShip` is built from that same `alive` set, so the entry
    // is always present; contents/order are identical to a fresh sensorUnitsOf.
    const observerSensors = scratch.sensorsByShip.get(observer.instanceId)!;
    const observerSpeedMag = earlyOut
      ? Math.sqrt(observer.velX * observer.velX + observer.velY * observer.velY)
      : 0;
    const observerMaxGain = earlyOut ? observerMaxReceptionGain(observerSensors) : 1;
    for (const enemy of enemies) {
      // Hoisted once per pair: the enemy's continuous emission strength feeds
      // the early-out's strict bound (next) AND the full emission product (after
      // the occlusion check), so it is evaluated once rather than recomputed by
      // each of the three downstream paths. Every intermediate is a pure function
      // of (observer, enemy, anomalies) and none are mutated within the pair.
      const enemyEmission = continuousEmissionStrength(enemy);
      if (
        earlyOut &&
        hullReceptionIsNegligible(
          observer,
          enemy,
          observerSpeedMag,
          observerMaxGain,
          enemyEmission,
        )
      ) {
        continue;
      }
      if (segmentBlocked(observer.x, observer.y, enemy.x, enemy.y, occluders)) continue;
      // Hoisted once per pair: the full emission product (enemy strength ×
      // relativistic + gravitational reception shift) feeds both the dazzle
      // contribution and the reception decision, which previously each
      // recomputed the strength and the shift independently.
      const emission = enemyEmission * receptionShift(observer, enemy, anomalies);
      // Sensor dazzle: a strong emission raises the observer's saturation for
      // subsequent ticks, whatever its origin. Accumulated even when the enemy
      // does not form a contact this tick.
      const accum = dazzleAccum.get(observer.instanceId);
      if (accum !== undefined) {
        dazzleAccum.set(
          observer.instanceId,
          accum + hullDazzleContribution(observer, enemy, anomalies, emission),
        );
      }
      if (!emReceives(observer, enemy, anomalies, observerSensors, emission)) continue;
      // Relativistic aberration: a moving observer measures the contact's
      // bearing swept toward its direction of travel. Stationary → identity.
      const apparent = aberratedContactPosition(
        observer.x,
        observer.y,
        observer.velX,
        observer.velY,
        enemy.x,
        enemy.y,
        SPEED_OF_LIGHT_M_PER_TICK,
      );
      list.push({
        enemyId: enemy.instanceId,
        x: apparent.x,
        y: apparent.y,
        facing: enemy.facing,
        threat: contactThreat(observer, enemy),
        origin: observer.instanceId,
      });
    }
    directContacts.set(observer.instanceId, list);
  }
  return directContacts;
}
