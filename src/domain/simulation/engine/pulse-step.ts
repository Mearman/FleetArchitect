/**
 * Tick-loop wiring for the Phase-8 active radar pulses (the physics primitives
 * live in `pulses.ts`). Each tick every operational active-mode sensor emits one
 * pulse; every live pulse expands at the speed of light, and when an outbound
 * pulse sweeps across an enemy it scatters a reflection back toward the emitter.
 * The emitter only learns of the contact once the reflection has completed the
 * round trip — so a radar fix is light-lagged, exactly as honest radar physics
 * demands.
 *
 * Determinism contract: pulse ids come from a monotonic per-battle counter (no
 * RNG, no clock); ships are iterated in lexicographic instanceId order in every
 * pass; pulses are advanced in insertion order (which is spawn order, hence
 * pulseSeq order). Two same-seed runs therefore produce byte-identical pulse
 * state and the same awareness contacts.
 */

import type { Contact, SimShip } from "./types";
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
  type SensorUnit,
} from "./sensors";
import { signatureMultiplier } from "./stealth";
import type { BattleAnomalyKind } from "@/schema/battle";

/** The active-emission strength of a sensor unit. An authored `emitStrength`
 *  (watts) governs how far the ping reaches; a unit that declares an active mode
 *  but no explicit transmit power falls back to a strength derived from its
 *  detection range so the round-trip return is still measurable at that range.
 *  Pure; shared with the reference oracle in ./pulse-step.reference. */
export function emitStrengthOf(unit: SensorUnit, range: number): number {
  const declared = unit.effect.emitStrength;
  if (declared !== undefined && declared > 0) return declared;
  // No authored transmit power: pick the strength whose omni return at the
  // sensor's own detection range equals unit incident power. The omni wavefront
  // spreads over 4·PI·range^2, so emitting that surface area's worth keeps the
  // ping detectable out to `range` without an arbitrary magic constant.
  return 4 * Math.PI * range * range;
}

/** Whether a sensor unit currently emits active pulses: its mode must be
 *  `active` or `hybrid` (a passive or mode-less sensor only listens). Pure;
 *  shared with the reference oracle in ./pulse-step.reference. */
export function emitsActively(unit: SensorUnit): boolean {
  return unit.effect.mode === "active" || unit.effect.mode === "hybrid";
}

/** Whether any alive ship carries at least one operational active-mode sensor
 *  unit that the emit pass could fire this tick — the gate condition for the
 *  whole pulse step. Mirrors the emit pass's own `sensorUnitsOf` +
 *  `emitsActively` filter exactly (alive ship, alive manned sensor module,
 *  active/hybrid mode) but scans the module array directly with no allocation,
 *  so the common no-active-sensor tick can skip the O(n log n) alive-filtered
 *  sort + array allocation entirely. Pure. */
function anyActiveEmitter(ships: readonly SimShip[]): boolean {
  for (const ship of ships) {
    if (!ship.alive) continue;
    const modules = ship.modules;
    if (modules === undefined) continue;
    for (const m of modules) {
      if (!m.alive) continue;
      const effect = m.effect;
      if (effect.kind !== "sensor") continue;
      const mode = effect.mode;
      if (mode !== "active" && mode !== "hybrid") continue;
      // A sensor that needs crew contributes only when manned; a crewless one
      // is always manned. Matches sensorUnitsOf, so the gate never disagrees
      // with the emit pass about whether a unit is operational.
      if (m.crewRequired > 0 && !m.manned) continue;
      return true;
    }
  }
  return false;
}

/** Expand a pulse one tick IN PLACE without applying the max-range cull.
 *  `advancePulse` in the primitives both grows the sphere and culls; this step
 *  needs to grow a pulse and still give it one illumination/return pass on the
 *  tick it overshoots (c per tick dwarfs battle distances, so the first advance
 *  covers the whole arena). The growth — radius += c, sweep += sweepRate — is
 *  identical to the primitive's arithmetic (and to the reference's spread-clone
 *  version in ./pulse-step.reference: `a + b` is bit-identical whether assigned
 *  via a fresh object or mutated in place); only the cull is deferred to the
 *  caller and the allocation is removed.
 *
 *  Aliasing is safe: within stepPulses the caller's `pulses` array is read only
 *  here (then wholesale rebuilt at the end from `survivors`), the checkpoint
 *  path structuredClone's the array, and the snapshot path builds fresh frame
 *  records via `.map`. Nothing observes the old vs new object identity. */
function advancePulseInPlace(pulse: SimPulse): void {
  pulse.radius += SPEED_OF_LIGHT_M_PER_TICK;
  pulse.sweepAngle += pulse.sweepRate;
}

/**
 * Advance the active-radar pulse field one tick and fold any completed round
 * trips into the emitters' awareness. Mutates `pulses` in place (rebuilding it
 * to the surviving + newly-spawned set) and writes light-lagged contacts onto
 * the originating ships' `awareness` maps. Returns the next pulse-sequence value.
 *
 * Order of operations within the tick:
 *  1. Emit — each operational active-mode sensor (ships in id order, modules in
 *     array order) spawns one outbound pulse.
 *  2. Advance — every pre-existing pulse expands by c; those past their max
 *     detection range are culled.
 *  3. Illuminate — each live outbound pulse is tested against every enemy ship
 *     (id order); the first time it covers a target it scatters a reflection.
 *  4. Receive — each live reflection that has reached its emitter registers a
 *     contact on that emitter, strength set by `pulseStrengthAt` at the return
 *     range.
 */
export function stepPulses(
  ships: readonly SimShip[],
  byId: ReadonlyMap<string, SimShip>,
  pulses: SimPulse[],
  anomalies: readonly BattleAnomalyKind[],
  tick: number,
  pulseSeq: number,
): number {
  // GATED: when there are no live pulses AND no alive ship carries an
  // operational active-mode sensor, nothing will be advanced, emitted,
  // illuminated, or received this tick — the function is a genuine no-op
  // (pulses stays empty, pulseSeq returned unchanged). Short-circuit before the
  // O(n log n) alive-filtered sort + array allocation. This is the common case
  // for passive-only fleets and for any quiet tick in an active-sensor battle;
  // byte-identical because `anyActiveEmitter` mirrors the emit pass's own
  // `sensorUnitsOf` + `emitsActively` filter, so the gate never disagrees with
  // the emit loop about whether an emission would occur.
  if (pulses.length === 0 && !anyActiveEmitter(ships)) {
    return pulseSeq;
  }

  // Ships in lexicographic instanceId order — the determinism contract for
  // every accumulation/iteration pass over ships.
  const ordered = [...ships]
    .filter((s) => s.alive)
    .sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));

  let nextId = pulseSeq;

  // 2. Advance every pre-existing pulse by c. We advance UNCONDITIONALLY here —
  //    `advancePulse` culls (returns null) once a pulse passes its max range, but
  //    because c per tick dwarfs any battle-scale distance a pulse covers its
  //    whole sphere on the first advanced tick; it must therefore get one
  //    illumination/return pass on the tick it overshoots before being dropped.
  //    The cull is applied at the end (survivors keep only radius <= maxRange).
  //    The advance mutates each pulse in place (the caller's array is wholesale
  //    rebuilt from `survivors` below, so no stale identity escapes).
  const advanced: SimPulse[] = [];
  for (const pulse of pulses) {
    advancePulseInPlace(pulse);
    advanced.push(pulse);
  }

  // 1. Emit one outbound pulse per operational active-mode sensor.
  for (const ship of ordered) {
    for (const unit of sensorUnitsOf(ship)) {
      if (!emitsActively(unit)) continue;
      const range = attenuatedSensorRange(unit.effect, unit.module, anomalies);
      if (range <= 0) continue;
      const arc = effectiveSensorArc(unit.effect, unit.module);
      const bearing = effectiveSensorBearing(unit.module, unit.ship);
      // The pulse originates at the sensor module's cell (rotated into world by
      // the ship's pose), not the ship centre — the radar dish is where the
      // ping leaves the hull.
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
        // The sweep advances the cone each tick by the sensor's sweep rate; a
        // non-sweeping (or mode-less) sensor keeps a fixed cone.
        sweepRate: unit.effect.sweepRate ?? 0,
        sweepAngle: 0,
        strength: emitStrengthOf(unit, range),
        birthTick: tick,
        maxRange: range,
      });
    }
  }

  // 3 + 4. Walk the live pulse set once in insertion (spawn) order. An outbound
  //        pulse scatters at most one reflection per tick (the first enemy its
  //        cone covers, in id order); a reflection that has reached its emitter
  //        records a contact. Reflections spawned this tick are appended and
  //        themselves advanced from next tick, so they cannot return early.
  const survivors: SimPulse[] = [];
  for (const pulse of advanced) {
    // Keep the pulse for the next tick only while it is still within its max
    // detection range. A pulse that overshot this tick still gets its single
    // illumination/return pass below, then is not carried forward.
    if (pulse.radius <= pulse.maxRange) survivors.push(pulse);
    if (pulse.reflectedFrom === undefined) {
      // Outbound ping: test against enemies of the emitter in id order.
      const emitter = byId.get(pulse.emitterId);
      if (emitter === undefined) continue;
      for (const target of ordered) {
        if (target.side === emitter.side) continue;
        if (target.phantom !== undefined) continue;
        const dx = target.x - pulse.originX;
        const dy = target.y - pulse.originY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // The wavefront has only reached targets within its current radius.
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
        break; // one reflection per outbound pulse per tick
      }
      continue;
    }
    // Reflection: has it reached its originating emitter yet?
    const emitter = byId.get(pulse.emitterId);
    if (emitter === undefined) continue;
    const dx = emitter.x - pulse.originX;
    const dy = emitter.y - pulse.originY;
    const back = Math.sqrt(dx * dx + dy * dy);
    // The reflection returns once it has been in flight for the closed-form
    // one-way light-travel time to the emitter — ceil(distance / c) ticks after
    // its birth. Comparing elapsed ticks (integer) keeps the round-trip exact
    // and free of accumulation drift.
    if (tick - pulse.birthTick < lightTravelTicks(back)) continue;
    const enemyId = pulse.reflectedFrom;
    const enemy = byId.get(enemyId);
    if (enemy === undefined || !enemy.alive) continue;
    // A returned reflection too weak to register against the receiver's noise
    // floor yields no fix; pulseStrengthAt at the return range gives the power.
    if (pulseStrengthAt(pulse, back) <= 0) continue;
    const contact: Contact = {
      enemyId,
      // The fix is light-lagged: the position the reflection carries is where
      // the target was when the pulse scattered, not where it is now.
      x: pulse.originX,
      y: pulse.originY,
      facing: enemy.facing,
      threat: contactThreat(emitter, enemy),
      origin: emitter.instanceId,
    };
    emitter.awareness.set(enemyId, contact);
  }

  // Rebuild the caller's array in place: survivors are already in spawn order.
  pulses.length = 0;
  for (const pulse of survivors) pulses.push(pulse);

  return nextId;
}
