import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import type { SensorEffect } from "@/schema/module";
import {
  core,
  inputs,
  moduleOf,
  sensor,
  ship,
} from "@/domain/simulation/engine.awareness-helpers";

/**
 * Wiring tests for the Phase-8 active radar pulses in the tick loop. The pulse
 * physics primitives are covered in engine.pulses.unit.test.ts; here we check
 * that the engine actually emits pulses from active-mode sensors, propagates
 * them, scatters reflections off enemies, and stays byte-deterministic.
 */

/** An active-mode omni sensor that emits sweeping pulses. */
function activeSensor(detectionRange: number, over: Partial<SensorEffect> = {}): SensorEffect {
  return sensor(detectionRange, {
    mode: "active",
    sweepRate: 0.1,
    emitStrength: 1000,
    ...over,
  });
}

/** Two stationary ships a short distance apart, the attacker carrying an active
 *  radar; the defender is a passive bystander. The detection range comfortably
 *  reaches the enemy so a reflection completes its round trip within the run. */
function radarBattle(maxTicks: number) {
  return runBattle(
    inputs(
      [
        ship("att", "attacker", -200, 0, [
          ...core(),
          moduleOf("radar", activeSensor(2000), 1, 0),
        ]),
        ship("def", "defender", 200, 0, [...core()]),
      ],
      [],
      maxTicks,
    ),
  );
}

describe("engine — active radar pulse wiring", () => {
  it("emits pulses into the frame from an active-mode sensor", () => {
    const result = radarBattle(8);
    // Some frame carries at least one outbound pulse (reflectedFrom absent).
    const hasOutbound = result.frames.some(
      (f) => f.pulses?.some((p) => p.reflectedFrom === undefined) ?? false,
    );
    expect(hasOutbound).toBe(true);
  });

  it("scatters a reflection off the enemy the pulse sweeps across", () => {
    const result = radarBattle(8);
    const reflection = result.frames
      .flatMap((f) => f.pulses ?? [])
      .find((p) => p.reflectedFrom === "def");
    expect(reflection).toBeDefined();
    // A reflection is owned by the emitter and expands from the target's
    // position when the ping struck it (x = 200, the defender's location).
    expect(reflection?.emitterId).toBe("att");
    expect(reflection?.x).toBeCloseTo(200, 6);
  });

  it("emits no pulses when no sensor is in active mode", () => {
    const result = runBattle(
      inputs(
        [
          // A purely passive sensor must never emit.
          ship("att", "attacker", -200, 0, [
            ...core(),
            moduleOf("p", sensor(2000, { mode: "passive" }), 1, 0),
          ]),
          ship("def", "defender", 200, 0, [...core()]),
        ],
        [],
        8,
      ),
    );
    const anyPulse = result.frames.some((f) => f.pulses !== undefined);
    expect(anyPulse).toBe(false);
  });

  it("is byte-identical across two same-seed runs (pulses included)", () => {
    const a = radarBattle(12);
    const b = radarBattle(12);
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
    expect(b.ticks).toBe(a.ticks);
  });
});
