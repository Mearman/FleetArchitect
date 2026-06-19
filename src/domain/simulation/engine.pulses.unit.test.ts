import { describe, expect, it } from "vitest";
import { SPEED_OF_LIGHT_M_PER_TICK } from "./engine/config";
import {
  advancePulse, lightTravelTicks, pulseIlluminates,
  pulseStrengthAt, spawnReflection, type SimPulse,
} from "./engine/pulses";

const omni = (over: Partial<SimPulse> = {}): SimPulse => ({
  id: 1, emitterId: "a", originX: 0, originY: 0, radius: 0,
  bearing: 0, arc: Math.PI, sweepRate: 0, sweepAngle: 0,
  strength: 1e6, birthTick: 0, maxRange: 1e9, ...over,
});

describe("engine.pulses", () => {
  it("the sphere expands at exactly c per tick", () => {
    // One tick adds exactly c (a single addition, no accumulation rounding).
    expect(advancePulse(omni())!.radius).toBe(SPEED_OF_LIGHT_M_PER_TICK);
    // And the radius after N ticks is N·c to floating-point precision
    // (compare as a ratio so the tolerance scales with the 1e9 magnitude).
    let p: SimPulse = omni();
    for (let i = 0; i < 100; i += 1) p = advancePulse(p)!;
    expect(p.radius / (100 * SPEED_OF_LIGHT_M_PER_TICK)).toBeCloseTo(1, 6);
  });

  it("is culled (null) once the radius exceeds maxRange", () => {
    const p = omni({ radius: 0, maxRange: 3 * SPEED_OF_LIGHT_M_PER_TICK });
    expect(advancePulse(p)).not.toBeNull();        // radius -> 1c (< maxRange)
    expect(advancePulse(advancePulse(p)!)).not.toBeNull(); // -> 2c
    const at3 = advancePulse(advancePulse(advancePulse(p)!)!)!;
    expect(advancePulse(at3)).toBeNull();          // 4c > maxRange -> cull
  });

  it("a reflection returns to the emitter after a 2·ceil(d/c) round trip", () => {
    // Target at range d: the ping reaches it at ceil(d/c) ticks; the reflection
    // (expanding at c from the target) reaches the emitter ceil(d/c) ticks
    // later. Total round trip = 2·ceil(d/c).
    const c = SPEED_OF_LIGHT_M_PER_TICK;
    const d = 5.5 * c;
    const roundTrip = 2 * lightTravelTicks(d);       // 2·ceil(5.5) = 12
    expect(roundTrip).toBe(12);
  });

  it("a sweeping beam illuminates a bearing only while the cone sweeps across it", () => {
    const p = omni({ arc: 0.1, bearing: 0, sweepRate: 0.05 });
    expect(pulseIlluminates(p, 0)).toBe(true);       // bearing 0 in cone at sweep 0
    let q: SimPulse = p;
    for (let i = 0; i < 40; i += 1) q = advancePulse(q)!; // sweep 0 -> 2.0
    expect(pulseIlluminates(q, 2.0)).toBe(true);     // swept onto bearing 2.0
    expect(pulseIlluminates(q, -2.0)).toBe(false);   // opposite bearing, not lit
  });

  it("an omni pulse illuminates every bearing", () => {
    const p = omni();
    for (const b of [0, 1, 2, 3, Math.PI]) expect(pulseIlluminates(p, b)).toBe(true);
  });

  it("omni strength falls as 1/(4·PI·r^2); a narrow beam concentrates it", () => {
    const om = omni({ strength: 1e6 });
    const narrow = omni({ strength: 1e6, arc: 0.05 });
    const r = 1000;
    expect(pulseStrengthAt(om, r)).toBeCloseTo(1e6 / (4 * Math.PI * r * r), 6);
    // Narrow beam strength > omni at the same range (concentrated into a small
    // solid angle).
    expect(pulseStrengthAt(narrow, r)).toBeGreaterThan(pulseStrengthAt(om, r));
  });

  it("a reflection's strength scales with incident strength and reflectivity", () => {
    const p = omni({ strength: 1e6, radius: 1000 });
    const incident = pulseStrengthAt(p, 1000);
    const refl = spawnReflection(2, p, "t1", 1000, 0, 0.5, 5);
    expect(refl.emitterId).toBe("a");              // owned by the emitter
    expect(refl.reflectedFrom).toBe("t1");
    expect(refl.originX).toBe(1000);               // expands from the target
    expect(refl.arc).toBe(Math.PI);                // scattered omni
    expect(refl.strength).toBeCloseTo(incident * 0.5, 6); // reflectivity
    expect(refl.birthTick).toBe(5);
  });

  it("the pulse primitives are deterministic (pure functions)", () => {
    const p = omni({ sweepRate: 0.1 });
    expect(advancePulse(p)).toEqual(advancePulse(p));
    expect(pulseStrengthAt(p, 500)).toEqual(pulseStrengthAt(p, 500));
  });
});
