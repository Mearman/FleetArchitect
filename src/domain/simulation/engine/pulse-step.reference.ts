/**
 * REFERENCE (oracle) for the active-radar pulse step: the frozen original
 * implementation of {@link stepPulses} that the optimised production path in
 * ./pulse-step replaces. Not wired into production; production runs
 * {@link stepPulses}. The pulse-step equivalence unit test
 * (engine.pulse-step.equivalence) calls both on identical, deep-cloned fields
 * and asserts the returned next-id, the surviving pulse array, and the
 * awareness contacts written are byte-for-byte equal; the whole-battle lossless
 * digest gate is the final arbiter.
 *
 * The optimisation is lossless for two independent reasons, each exercised by
 * the equivalence fixtures:
 *
 *  1. The early-out gate. The optimised path returns early when there are no
 *     live pulses AND no alive ship carries an operational active-mode sensor.
 *     In that case the original path is provably a no-op too: the advance loop
 *     iterates an empty `pulses` array, the emit loop's `sensorUnitsOf` +
 *     `emitsActively` find no firing unit (the gate's `anyActiveEmitter`
 *     mirrors those filters exactly), so no pulse is ever appended and
 *     `pulses` is rebuilt empty with `pulseSeq` returned unchanged. The gate
 *     only ever skips work that produces no output.
 *
 *  2. The in-place advance. The original allocates a fresh spread-clone
 *     (`{ ...pulse, radius: r+c, sweepAngle: s+rate }`) per live pulse; the
 *     optimised path mutates `pulse.radius`/`pulse.sweepAngle` in place and
 *     reuses the reference. The arithmetic is bit-identical (`a + b` is the
 *     same IEEE-754 operation whether the result lands on a fresh object or
 *     back on the same field), and no external observer sees the old object —
 *     within `stepPulses` the caller's array is read only in the advance loop
 *     and then wholesale rebuilt from `survivors`; the checkpoint path
 *     structuredClone's it; the snapshot builds fresh frame records via `.map`.
 *
 * This reference is the original logic frozen exactly as it read before the
 * optimisation; it shares only the pure leaf helpers ({@link emitsActively},
 * {@link emitStrengthOf}) so the emission decision and strength cannot drift
 * between the two paths.
 */

import { SPEED_OF_LIGHT_M_PER_TICK } from "./config";
import { cellWorldPosition } from "@/domain/simulation/spatial-hash";
import {
  lightTravelTicks,
  pulseIlluminates,
  pulseStrengthAt,
  spawnReflection,
  type SimPulse,
} from "./pulses";
import {
  attenuatedSensorRange,
  contactThreat,
  effectiveSensorArc,
  effectiveSensorBearing,
  sensorUnitsOf,
} from "./sensors";
import { signatureMultiplier } from "./stealth";
import { emitsActively, emitStrengthOf } from "./pulse-step";
import type { Contact, SimShip } from "./types";
import type { BattleAnomalyKind } from "@/schema/battle";

/** Expand a pulse one tick WITHOUT applying the max-range cull — the original
 *  spread-clone allocation the optimised path replaces with in-place mutation.
 *  Frozen as the oracle. */
function advancePulseUnculled(pulse: SimPulse): SimPulse {
  return {
    ...pulse,
    radius: pulse.radius + SPEED_OF_LIGHT_M_PER_TICK,
    sweepAngle: pulse.sweepAngle + pulse.sweepRate,
  };
}

/**
 * The original active-radar pulse step, frozen as the oracle. Identical
 * semantics to {@link stepPulses} (in ./pulse-step) but with neither the
 * no-op early-out gate nor the in-place advance: it always builds the sorted
 * alive list, always allocates a fresh spread-clone per live pulse, and runs
 * the same emit/illuminate/receive passes. Mutates `pulses` in place
 * (rebuilding it to the surviving + newly-spawned set) and writes light-lagged
 * contacts onto the originating ships' `awareness` maps. Returns the next
 * pulse-sequence value.
 */
export function stepPulsesReference(
  ships: readonly SimShip[],
  byId: ReadonlyMap<string, SimShip>,
  pulses: SimPulse[],
  anomalies: readonly BattleAnomalyKind[],
  tick: number,
  pulseSeq: number,
): number {
  // Ships in lexicographic instanceId order — the determinism contract for
  // every accumulation/iteration pass over ships.
  const ordered = [...ships]
    .filter((s) => s.alive)
    .sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));

  let nextId = pulseSeq;

  const advanced: SimPulse[] = [];
  for (const pulse of pulses) {
    advanced.push(advancePulseUnculled(pulse));
  }

  for (const ship of ordered) {
    for (const unit of sensorUnitsOf(ship)) {
      if (!emitsActively(unit)) continue;
      const range = attenuatedSensorRange(unit.effect, unit.module, anomalies);
      if (range <= 0) continue;
      const arc = effectiveSensorArc(unit.effect, unit.module);
      const bearing = effectiveSensorBearing(unit.module, unit.ship);
      const cell = cellWorldPosition(ship.x, ship.y, ship.facing, unit.module.x, unit.module.y);
      nextId += 1;
      advanced.push({
        id: nextId,
        emitterId: ship.instanceId,
        originX: cell.wx,
        originY: cell.wy,
        radius: 0,
        bearing,
        arc,
        sweepRate: unit.effect.sweepRate ?? 0,
        sweepAngle: 0,
        strength: emitStrengthOf(unit, range),
        birthTick: tick,
        maxRange: range,
      });
    }
  }

  const survivors: SimPulse[] = [];
  for (const pulse of advanced) {
    if (pulse.radius <= pulse.maxRange) survivors.push(pulse);
    if (pulse.reflectedFrom === undefined) {
      const emitter = byId.get(pulse.emitterId);
      if (emitter === undefined) continue;
      for (const target of ordered) {
        if (target.side === emitter.side) continue;
        if (target.phantom !== undefined) continue;
        const dx = target.x - pulse.originX;
        const dy = target.y - pulse.originY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > pulse.radius) continue;
        if (!pulseIlluminates(pulse, Math.atan2(dy, dx))) continue;
        nextId += 1;
        survivors.push(
          spawnReflection(
            nextId,
            pulse,
            target.instanceId,
            target.x,
            target.y,
            signatureMultiplier(target),
            tick,
          ),
        );
        break;
      }
      continue;
    }
    const emitter = byId.get(pulse.emitterId);
    if (emitter === undefined) continue;
    const dx = emitter.x - pulse.originX;
    const dy = emitter.y - pulse.originY;
    const back = Math.sqrt(dx * dx + dy * dy);
    if (tick - pulse.birthTick < lightTravelTicks(back)) continue;
    const enemyId = pulse.reflectedFrom;
    const enemy = byId.get(enemyId);
    if (enemy === undefined || !enemy.alive) continue;
    if (pulseStrengthAt(pulse, back) <= 0) continue;
    const contact: Contact = {
      enemyId,
      x: pulse.originX,
      y: pulse.originY,
      facing: enemy.facing,
      threat: contactThreat(emitter, enemy),
      origin: emitter.instanceId,
    };
    emitter.awareness.set(enemyId, contact);
  }

  pulses.length = 0;
  for (const pulse of survivors) pulses.push(pulse);

  return nextId;
}
