/**
 * Frozen reference oracle for the per-observer direct-detection step — the
 * current O(N²) hull-reception logic WITHOUT the anomaly-free early-out that
 * {@link buildDirectContacts} in `awareness-direct.ts` adds. Kept as a parallel
 * implementation (per the byte-identical-optimisation convention: oracle +
 * optimised impl, both A/B-tested) so `engine.awareness.equivalence.unit.test`
 * can assert the early-out never changes a direct-contacts map or dazzle
 * accumulator byte-for-byte.
 *
 * This is deliberately a frozen copy of the unoptimised loop, NOT a shared
 * helper: the point of an oracle is that it does not drift with the optimised
 * path, so a divergence is caught rather than silenced. If the reception model
 * itself changes, update both this and `awareness-direct.ts` together.
 */

import { segmentBlocked } from "@/domain/occluders";
import type { Disc } from "@/domain/occluders";
import type { BattleAnomalyKind } from "@/schema/battle";

import { SPEED_OF_LIGHT_M_PER_TICK } from "./config";
import { aberratedContactPosition } from "./optics-aberration";
import { emReceives, hullDazzleContribution } from "./em-reception";
import { contactThreat, sensorUnitsOf } from "./sensors";
import type { Contact, SimShip } from "./types";
import type { AwarenessScratch } from "./awareness";
import type { EnemiesBySide } from "./awareness-direct";

/**
 * The unoptimised reference for {@link buildDirectContacts}: identical logic,
 * minus the anomaly-free early-out. Every alive observer scans its full enemy
 * side, accumulates dazzle for every non-occluded enemy, and forms a contact
 * for every enemy it receives — the plain O(N²) scan the optimised path must
 * match byte-for-byte.
 */
export function buildDirectContactsReference(
  alive: readonly SimShip[],
  occluders: readonly Disc[],
  anomalies: readonly BattleAnomalyKind[],
  dazzleAccum: Map<string, number>,
  enemiesBySide: EnemiesBySide,
  scratch: AwarenessScratch,
): Map<string, Contact[]> {
  const directContacts = scratch.directContacts;
  directContacts.clear();
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
    const observerSensors = sensorUnitsOf(observer);
    for (const enemy of enemies) {
      if (segmentBlocked(observer.x, observer.y, enemy.x, enemy.y, occluders)) continue;
      const accum = dazzleAccum.get(observer.instanceId);
      if (accum !== undefined) {
        dazzleAccum.set(
          observer.instanceId,
          accum + hullDazzleContribution(observer, enemy, anomalies),
        );
      }
      if (!emReceives(observer, enemy, anomalies, observerSensors)) continue;
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
