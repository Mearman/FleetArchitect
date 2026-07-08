/**
 * Equivalence proof for the optimised active-radar pulse step: the production
 * {@link stepPulses} (early-out gate + in-place advance) must produce
 * byte-identical output to the frozen reference oracle
 * {@link stepPulsesReference} (no gate, spread-clone advance) across the
 * optimisation's decision boundaries.
 *
 * Why this is lossless:
 *  - The gate fires only when `pulses` is empty AND no alive ship carries an
 *    operational active-mode sensor. In that case the reference's advance loop
 *    iterates an empty array and its emit loop finds no firing sensor unit
 *    (`anyActiveEmitter` mirrors `sensorUnitsOf` + `emitsActively`), so it too
 *    leaves `pulses` empty and returns `pulseSeq` — the gate skips only work
 *    that produces no output.
 *  - The in-place advance computes `radius += c` and `sweepAngle += sweepRate`
 *    rather than spreading `{ ...pulse, radius: r+c, sweepAngle: s+rate }`.
 *    `a + b` is bit-identical IEEE-754 whether the result lands on a fresh
 *    object or back on the same field, and no external observer sees the old
 *    object (the caller's array is wholesale rebuilt from `survivors`).
 *
 * Each path runs against a `structuredClone` of the same template state, because
 * both mutate the `pulses` array in place and write contacts onto ship
 * `awareness`. The fixtures force each branch: the gated no-op (no sensor and
 * passive-only), a fresh emission, an outbound pulse illuminating an enemy and
 * scattering a reflection, a reflection completing its round trip and writing a
 * contact, an anomaly-damped range, a dead emitter in the roster, and a
 * randomised fuzz over mixed fleets and live pulses. The whole-battle lossless
 * digest gate (engine.lossless-digest) is the final arbiter; this unit test is
 * the finer-grained, targeted regression guard.
 */
import { describe, expect, it } from "vitest";

import { stepPulses } from "@/domain/simulation/engine/pulse-step";
import { stepPulsesReference } from "@/domain/simulation/engine/pulse-step.reference";
import { toSimShip } from "@/domain/simulation/engine/setup";
import type { SimPulse } from "@/domain/simulation/engine/pulses";
import type { SimShip } from "@/domain/simulation/engine/types";
import { mulberry32 } from "@/domain/simulation/rng";
import {
  core,
  moduleOf,
  sensor,
  ship as combatShip,
} from "@/domain/simulation/engine.awareness-helpers";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { SensorEffect } from "@/schema/module";
import type { BattleAnomalyKind } from "@/schema/battle";

/** A snapshot of every value the pulse step reads or writes, captured AFTER the
 *  step, that the optimised path must reproduce bit-for-bit. `pulses` is read
 *  back from the mutated caller array; `awareness` is read back per emitter. */
interface StepSnapshot {
  nextId: number;
  pulses: SimPulseSnapshot[];
  awareness: Map<string, ContactSnapshot[]>;
}

/** A plain-data view of a SimPulse (fields the step sets/culls; readonly id and
 *  emitterId are included to catch any ordering/identity drift). */
interface SimPulseSnapshot {
  id: number;
  emitterId: string;
  reflectedFrom: string | undefined;
  originX: number;
  originY: number;
  radius: number;
  bearing: number;
  arc: number;
  sweepRate: number;
  sweepAngle: number;
  strength: number;
  birthTick: number;
  maxRange: number;
}

/** A plain-data view of a Contact, sorted by enemyId for stable comparison. */
interface ContactSnapshot {
  enemyId: string;
  x: number;
  y: number;
  facing: number;
  threat: number;
  origin: string;
}

function snapshotPulse(p: SimPulse): SimPulseSnapshot {
  return {
    id: p.id,
    emitterId: p.emitterId,
    reflectedFrom: p.reflectedFrom,
    originX: p.originX,
    originY: p.originY,
    radius: p.radius,
    bearing: p.bearing,
    arc: p.arc,
    sweepRate: p.sweepRate,
    sweepAngle: p.sweepAngle,
    strength: p.strength,
    birthTick: p.birthTick,
    maxRange: p.maxRange,
  };
}

/** Read back the step's full observable output: the rebuilt `pulses` array and
 *  every ship's awareness map. Awareness contacts are sorted by enemyId so the
 *  comparison is order-independent (the step writes at most one contact per
 *  enemy per ship per tick, but the map's insertion order need not match). */
function snapshot(ships: SimShip[], pulses: SimPulse[], nextId: number): StepSnapshot {
  const awareness = new Map<string, ContactSnapshot[]>();
  for (const s of ships) {
    const contacts: ContactSnapshot[] = [];
    for (const c of s.awareness.values()) {
      contacts.push({
        enemyId: c.enemyId,
        x: c.x,
        y: c.y,
        facing: c.facing,
        threat: c.threat,
        origin: c.origin,
      });
    }
    contacts.sort((a, b) => (a.enemyId < b.enemyId ? -1 : a.enemyId > b.enemyId ? 1 : 0));
    awareness.set(s.instanceId, contacts);
  }
  return { nextId, pulses: pulses.map(snapshotPulse), awareness };
}

/** The inputs to a single pulse step, in the shape the engine threads through. */
interface StepInput {
  ships: CombatShip[];
  pulses: SimPulse[];
  anomalies: BattleAnomalyKind[];
  tick: number;
  pulseSeq: number;
}

/** Run BOTH paths on deep-cloned copies of the same input and return their
 *  snapshots. Each path gets its own SimShip[] (cloned with toSimShip from the
 *  shared CombatShip templates), its own byId index, its own pulses array
 *  (cloned so the in-place advance cannot leak into the reference's run), and
 *  its own anomaly array reference (read-only). */
function runBoth(input: StepInput): { optimised: StepSnapshot; reference: StepSnapshot } {
  // Optimised path.
  const optShips = simShips(input.ships);
  const optById = indexById(optShips);
  const optPulses = input.pulses.map(clonePulse);
  const optNext = stepPulses(optShips, optById, optPulses, input.anomalies, input.tick, input.pulseSeq);
  const optimised = snapshot(optShips, optPulses, optNext);

  // Reference path — independent clones of every input.
  const refShips = simShips(input.ships);
  const refById = indexById(refShips);
  const refPulses = input.pulses.map(clonePulse);
  const refNext = stepPulsesReference(refShips, refById, refPulses, input.anomalies, input.tick, input.pulseSeq);
  const reference = snapshot(refShips, refPulses, refNext);

  return { optimised, reference };
}

/** Convert CombatShip templates to fresh SimShips with a fixed rng. Called
 *  twice per case (once per path) so the two paths never share mutable state. */
function simShips(ships: CombatShip[]): SimShip[] {
  const rng = mulberry32(7);
  return ships.map((s) => toSimShip(s, rng));
}

function indexById(ships: SimShip[]): Map<string, SimShip> {
  const m = new Map<string, SimShip>();
  for (const s of ships) m.set(s.instanceId, s);
  return m;
}

/** Deep-clone a SimPulse so the optimised path's in-place advance cannot mutate
 *  the fixture the reference path will also read. SimPulse is plain data. */
function clonePulse(p: SimPulse): SimPulse {
  return { ...p };
}

/** Build an outbound pulse fixture owned by `emitterId` at the given origin. */
function outboundPulse(
  emitterId: string,
  opts: {
    originX: number;
    originY: number;
    radius: number;
    maxRange: number;
    birthTick?: number;
    arc?: number;
    bearing?: number;
    sweepRate?: number;
    sweepAngle?: number;
    strength?: number;
    id?: number;
  },
): SimPulse {
  return {
    id: opts.id ?? 1,
    emitterId,
    originX: opts.originX,
    originY: opts.originY,
    radius: opts.radius,
    bearing: opts.bearing ?? 0,
    arc: opts.arc ?? Math.PI,
    sweepRate: opts.sweepRate ?? 0,
    sweepAngle: opts.sweepAngle ?? 0,
    strength: opts.strength ?? 1e12,
    birthTick: opts.birthTick ?? 0,
    maxRange: opts.maxRange,
  };
}

/** Build a reflection pulse: a scattered return sphere owned by `emitterId`,
 *  expanding from where it struck `targetId`. */
function reflectionPulse(
  emitterId: string,
  targetId: string,
  opts: {
    originX: number;
    originY: number;
    radius: number;
    maxRange: number;
    birthTick: number;
    strength?: number;
    id?: number;
  },
): SimPulse {
  return {
    id: opts.id ?? 2,
    emitterId,
    reflectedFrom: targetId,
    originX: opts.originX,
    originY: opts.originY,
    radius: opts.radius,
    bearing: 0,
    arc: Math.PI,
    sweepRate: 0,
    sweepAngle: 0,
    strength: opts.strength ?? 1e12,
    birthTick: opts.birthTick,
    maxRange: opts.maxRange,
  };
}

/** Assert two step snapshots are byte-identical: same next-id, same surviving
 *  pulses (order + fields), same awareness contacts per ship. */
function assertSnapshotsEqual(
  optimised: StepSnapshot,
  reference: StepSnapshot,
  context: string,
): void {
  if (optimised.nextId !== reference.nextId) {
    throw new Error(`${context}: nextId diverged (opt=${optimised.nextId} ref=${reference.nextId})`);
  }
  expect(optimised.pulses, `${context}: pulses`).toEqual(reference.pulses);
  // Awareness: compare the contact lists for every ship present in either side.
  const allIds = new Set<string>([
    ...optimised.awareness.keys(),
    ...reference.awareness.keys(),
  ]);
  for (const id of allIds) {
    expect(optimised.awareness.get(id), `${context}: awareness[${id}]`).toEqual(
      reference.awareness.get(id),
    );
  }
}

/** An active-mode omni sensor that emits pulses. */
function activeSensor(detectionRange: number, over: Partial<SensorEffect> = {}): SensorEffect {
  return sensor(detectionRange, { mode: "active", emitStrength: 1e12, ...over });
}

// ---------------------------------------------------------------------------
// Fixture ships: minimal hulls carrying the sensor mix under test.
// ---------------------------------------------------------------------------

/** An attacker carrying one active-mode omni radar at (1, 0). */
function radarAttacker(id: string, x: number, y: number, range = 2000): CombatShip {
  const mods: ResolvedModule[] = [...core(), moduleOf("radar", activeSensor(range), 1, 0)];
  return combatShip(id, "attacker", x, y, mods);
}

/** A passive observer (no active emitter) — the gate must still fire for it. */
function passiveAttacker(id: string, x: number, y: number): CombatShip {
  const mods: ResolvedModule[] = [...core(), moduleOf("se", sensor(2000, { mode: "passive" }), 1, 0)];
  return combatShip(id, "attacker", x, y, mods);
}

/** A bare defender target with no sensors. */
function defender(id: string, x: number, y: number): CombatShip {
  return combatShip(id, "defender", x, y, [...core()]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("engine pulse step — optimised matches the reference oracle", () => {
  it("gate: no sensors and empty pulses is byte-identical (the common no-op)", () => {
    // Both paths must leave pulses empty and return pulseSeq unchanged.
    const { optimised, reference } = runBoth({
      ships: [defender("d1", -100, 0), defender("d2", 100, 0)],
      pulses: [],
      anomalies: [],
      tick: 5,
      pulseSeq: 100,
    });
    assertSnapshotsEqual(optimised, reference, "no-sensor gate");
    expect(optimised.pulses).toEqual([]);
    expect(optimised.nextId).toBe(100);
  });

  it("gate: a passive-only fleet with empty pulses is byte-identical", () => {
    // A passive sensor must not emit; the gate fires (no active emitter) and
    // the optimised path skips the sort while the reference runs it pointlessly.
    const { optimised, reference } = runBoth({
      ships: [
        passiveAttacker("p1", -200, 0),
        combatShip("p2", "defender", 200, 0, [
          ...core(),
          moduleOf("se", sensor(2000, { mode: "passive" }), 1, 0),
        ]),
      ],
      pulses: [],
      anomalies: [],
      tick: 3,
      pulseSeq: 42,
    });
    assertSnapshotsEqual(optimised, reference, "passive-only gate");
    expect(optimised.pulses).toEqual([]);
  });

  it("a fresh emission from an active sensor is byte-identical", () => {
    // No pre-existing pulses; the attacker emits one outbound ping this tick.
    // The emitted pulse has radius 0 (no advance this tick) and survives.
    const { optimised, reference } = runBoth({
      ships: [radarAttacker("att", -200, 0), defender("def", 200, 0)],
      pulses: [],
      anomalies: [],
      tick: 1,
      pulseSeq: 10,
    });
    assertSnapshotsEqual(optimised, reference, "fresh emission");
    expect(optimised.pulses).toHaveLength(reference.pulses.length);
    expect(optimised.pulses.length).toBeGreaterThan(0);
  });

  it("an active sensor with anomaly-damped range (still > 0) emits identically", () => {
    // An anomaly that damps but does not zero the range exercises the
    // attenuatedSensorRange path; both paths must agree on the emitted
    // pulse's maxRange and strength.
    const { optimised, reference } = runBoth({
      ships: [radarAttacker("att", -200, 0), defender("def", 200, 0)],
      pulses: [],
      anomalies: ["nebula"],
      tick: 1,
      pulseSeq: 10,
    });
    assertSnapshotsEqual(optimised, reference, "nebula-damped emission");
  });

  it("an outbound pulse illuminating an enemy scatters an identical reflection", () => {
    // Seed an outbound ping at radius 100 originating near the emitter; the
    // defender sits at distance 100, so the wavefront just reaches it and the
    // pulse illuminates (omni arc). This exercises the in-place advance (the
    // seeded pulse is advanced by c this tick before illumination) AND the
    // reflection spawn.
    const att = radarAttacker("att", 0, 0);
    const { optimised, reference } = runBoth({
      ships: [att, defender("def", 100, 0)],
      pulses: [
        outboundPulse("att", {
          originX: 0,
          originY: 0,
          radius: 100,
          maxRange: 5000,
          birthTick: 0,
        }),
      ],
      anomalies: [],
      tick: 1,
      pulseSeq: 50,
    });
    assertSnapshotsEqual(optimised, reference, "illuminate + reflect");
    // The reflection must be present on both paths.
    const hasReflection = (sn: StepSnapshot) =>
      sn.pulses.some((p) => p.reflectedFrom === "def");
    expect(hasReflection(optimised)).toBe(true);
    expect(hasReflection(reference)).toBe(true);
  });

  it("a reflection completing its round trip writes an identical contact", () => {
    // Seed a reflection sphere born long enough ago that the round trip has
    // completed; it must register a light-lagged contact on the emitter's
    // awareness. Both paths must write the same contact fields.
    const att = radarAttacker("att", 0, 0);
    const def = defender("def", 150, 0);
    const { optimised, reference } = runBoth({
      ships: [att, def],
      pulses: [
        reflectionPulse("att", "def", {
          // The reflection scattered at the defender's position.
          originX: 150,
          originY: 0,
          radius: 0,
          maxRange: 5000,
          // Born many ticks ago — well past the one-way light travel time.
          birthTick: 0,
          strength: 1e10,
        }),
      ],
      anomalies: [],
      tick: 100,
      pulseSeq: 50,
    });
    assertSnapshotsEqual(optimised, reference, "round-trip receive");
    // The contact must have been written on the emitter.
    const attContacts = optimised.awareness.get("att");
    expect(attContacts).toBeDefined();
    expect(attContacts?.some((c) => c.enemyId === "def")).toBe(true);
  });

  it("a dead emitter is filtered identically (ordered build + gate scan agree)", () => {
    // A dead ship in the roster must be excluded from the emit pass on both
    // paths. The dead ship carries the only active sensor, so the gate must
    // fire (no ALIVE active emitter) and the reference must likewise emit
    // nothing (the dead ship is filtered out of `ordered`).
    const att = radarAttacker("att", 0, 0);
    // Kill the attacker before the step runs by post-conversion mutation
    // (done in a custom builder so both paths clone the same dead state).
    const { optimised, reference } = runBothDeadEmitter(att, defender("def", 100, 0));
    assertSnapshotsEqual(optimised, reference, "dead emitter");
    expect(optimised.pulses).toEqual([]);
  });

  it("randomised fleets + live pulses: optimised ≡ reference for every tick", () => {
    // A fuzz pass: scatter ships of mixed sensor loadout on a deterministic rng,
    // seed a handful of live outbound and reflection pulses at varied radii, and
    // assert snapshot parity. Catches boundary cases the hand-built fixtures do
    // not enumerate (pulse just reaching / just missing, sweeping beams, etc.).
    const rng = mulberry32(99);
    const fleet: CombatShip[] = [];
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const id = `s-${i.toString().padStart(2, "0")}`;
      ids.push(id);
      const side = i % 2 === 0 ? "attacker" : "defender";
      const x = (rng() - 0.5) * 400;
      const y = (rng() - 0.5) * 400;
      const mods: ResolvedModule[] = [...core()];
      // Roughly half the ships carry an active radar; a few carry passive; the
      // rest are bare. Mix omni with a sweeping directional emitter.
      const roll = rng();
      if (roll < 0.5) {
        mods.push(moduleOf("radar", activeSensor(800 + rng() * 1200), 1, 0));
      } else if (roll < 0.7) {
        mods.push(moduleOf("se", sensor(1500, { mode: "passive" }), 1, 0));
      }
      fleet.push(combatShip(id, side, x, y, mods));
    }
    // Seed live pulses: a few outbound pings from random emitters at varied
    // radii, plus a couple of in-flight reflections.
    const seedPulses: SimPulse[] = [];
    let pid = 1000;
    for (let k = 0; k < 6; k++) {
      const emitter = ids[Math.floor(rng() * ids.length)] ?? "s-00";
      seedPulses.push(
        outboundPulse(emitter, {
          id: pid++,
          originX: (rng() - 0.5) * 200,
          originY: (rng() - 0.5) * 200,
          radius: rng() * 300,
          maxRange: 3000,
          birthTick: 0,
          sweepRate: rng() < 0.5 ? 0.1 : 0,
          sweepAngle: rng() * Math.PI,
          arc: rng() < 0.5 ? Math.PI : 0.4,
          bearing: rng() * Math.PI * 2,
        }),
      );
    }
    for (let k = 0; k < 2; k++) {
      const emitter = ids[Math.floor(rng() * ids.length)] ?? "s-00";
      const target = ids[Math.floor(rng() * ids.length)] ?? "s-01";
      seedPulses.push(
        reflectionPulse(emitter, target, {
          id: pid++,
          originX: (rng() - 0.5) * 200,
          originY: (rng() - 0.5) * 200,
          radius: 0,
          maxRange: 3000,
          birthTick: 0,
        }),
      );
    }
    const { optimised, reference } = runBoth({
      ships: fleet,
      pulses: seedPulses,
      anomalies: rng() < 0.5 ? ["nebula"] : [],
      tick: 2,
      pulseSeq: 500,
    });
    assertSnapshotsEqual(optimised, reference, "fuzz");
  });
});

/** Variant of {@link runBoth} that kills the attacker (sets alive=false and
 *  destroys its radar module) BEFORE the step, so both paths see the same dead
 *  emitter. Exercises the dead-ship filter in `ordered` and in the gate scan. */
function runBothDeadEmitter(attackerTemplate: CombatShip, defenderTemplate: CombatShip): {
  optimised: StepSnapshot;
  reference: StepSnapshot;
} {
  const runOnce = (useOptimised: boolean): StepSnapshot => {
    const ships = simShips([attackerTemplate, defenderTemplate]);
    // Kill the attacker and its radar so neither emit pass nor gate scan sees
    // it as an active emitter. Sort key: instanceId "att" < "def".
    const att = ships.find((s) => s.instanceId === attackerTemplate.instanceId);
    if (att !== undefined) {
      att.alive = false;
      if (att.modules !== undefined) {
        for (const m of att.modules) {
          if (m.effect.kind === "sensor") m.alive = false;
        }
      }
    }
    const byId = indexById(ships);
    const pulses: SimPulse[] = [];
    const next = useOptimised
      ? stepPulses(ships, byId, pulses, [], 5, 50)
      : stepPulsesReference(ships, byId, pulses, [], 5, 50);
    return snapshot(ships, pulses, next);
  };
  return { optimised: runOnce(true), reference: runOnce(false) };
}
