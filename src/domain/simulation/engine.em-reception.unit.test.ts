import { describe, expect, it } from "vitest";

import { runBattle } from "@/domain/simulation/engine";
import {
  continuousContact,
  continuousRange,
  emissionForRange,
} from "@/domain/simulation/engine/emissions";
import {
  EM_HULL_AMBIENT_EMISSION,
  EM_RECEIVER_NOISE_FLOOR,
} from "@/domain/simulation/engine/em-anchors";
import { SIM } from "@/domain/simulation/engine/config";
import {
  contactsOf,
  core,
  inputs,
  moduleOf,
  sensor,
  ship,
} from "@/domain/simulation/engine.awareness-helpers";

// ---------------------------------------------------------------------------
// The grounded reception primitives
// ---------------------------------------------------------------------------

describe("engine.em-reception — grounded constants", () => {
  it("visualLosRadius is the continuous-emission range of the ambient hull emission", () => {
    // The innate visual radius DERIVES from the ambient emission against the
    // noise floor at unit gain — not a hand-picked literal. So the round trip
    // emission -> range -> emission must close.
    const range = continuousRange(EM_HULL_AMBIENT_EMISSION, EM_RECEIVER_NOISE_FLOOR, 1);
    expect(range).toBeCloseTo(SIM.visualLosRadius, 6);
    // And the inverse: the ambient is exactly the emission needed to be seen at
    // that radius by the baseline receiver.
    expect(emissionForRange(SIM.visualLosRadius, EM_RECEIVER_NOISE_FLOOR)).toBeCloseTo(
      EM_HULL_AMBIENT_EMISSION,
      6,
    );
  });

  it("a baseline emitter is received exactly at the visual radius boundary, not beyond", () => {
    const justInside = SIM.visualLosRadius - 1;
    const justOutside = SIM.visualLosRadius + 1;
    expect(
      continuousContact(EM_HULL_AMBIENT_EMISSION, justInside, EM_RECEIVER_NOISE_FLOOR, 1),
    ).toBe(true);
    expect(
      continuousContact(EM_HULL_AMBIENT_EMISSION, justOutside, EM_RECEIVER_NOISE_FLOOR, 1),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reception replaces the instant geometric path
// ---------------------------------------------------------------------------

describe("engine.em-reception — baseline receiver (sensor-free sight)", () => {
  it("a sensorless ship still receives an enemy inside its visual radius", () => {
    // Neither ship carries a sensor; the attacker has only a bridge. The enemy
    // sits just inside the EM-grounded visual radius, so the baseline receiver
    // forms a contact with no sensor module at all.
    const inside = Math.floor(SIM.visualLosRadius) - 5;
    const result = runBattle(
      inputs([
        ship("a1", "attacker", 0, 0, [...core()]),
        ship("d1", "defender", inside, 0, [...core()]),
      ]),
    );
    expect(contactsOf(result, 0, "a1")).toContain("d1");
  });

  it("a sensorless ship does NOT receive an enemy beyond its visual radius", () => {
    const beyond = Math.ceil(SIM.visualLosRadius) + 50;
    const result = runBattle(
      inputs([
        ship("a1", "attacker", 0, 0, [...core()]),
        ship("d1", "defender", beyond, 0, [...core()]),
      ]),
    );
    expect(contactsOf(result, 0, "a1")).not.toContain("d1");
  });

  it("a sensor cone extends reception to its detection range", () => {
    // The enemy sits at 6000 m — beyond the ~5000 m innate baseline but inside
    // an 8000 m omni sensor's reach. The sensor-equipped ship (a1) receives it
    // via its sensor cone; the sensorless ship (blind) at (0, 2000) cannot reach
    // d1 at (6000, 0) — distance ~6325 m > 5000 m baseline — and receives nothing.
    const result = runBattle(
      inputs([
        ship("a1", "attacker", 0, 0, [...core(), moduleOf("se", sensor(8000), 1, 0)]),
        ship("blind", "attacker", 0, 2000, [...core()]),
        ship("d1", "defender", 6000, 0, [...core()]),
      ]),
    );
    expect(contactsOf(result, 0, "a1")).toContain("d1");
    expect(contactsOf(result, 0, "blind")).not.toContain("d1");
  });
});

// ---------------------------------------------------------------------------
// Emission log + snapshot
// ---------------------------------------------------------------------------

describe("engine.em-reception — emission snapshot", () => {
  it("every alive ship contributes a baseline emission to the frame", () => {
    const result = runBattle(
      inputs([
        ship("a1", "attacker", 0, 0, [...core()]),
        ship("d1", "defender", 100, 0, [...core()]),
      ]),
    );
    const frame0 = result.frames[0];
    if (frame0 === undefined) throw new Error("no frame 0");
    const ems = frame0.emissions ?? [];
    // One baseline emission per ship (neither runs an active sensor).
    const sources = ems.map((e) => e.sourceId).sort();
    expect(sources).toEqual(["a1", "d1"]);
    // Each carries the ambient strength at the ship's own position.
    for (const e of ems) {
      expect(e.strength).toBeCloseTo(EM_HULL_AMBIENT_EMISSION, 6);
    }
  });

  it("an active-mode sensor adds a second emission for its transmit power", () => {
    // A1 runs an active omni sensor with an explicit transmit power, so it logs
    // a baseline emission AND an active-emitter emission; the passive defender
    // logs only its baseline.
    const activeSensor = sensor(300, { mode: "active", emitStrength: 5e9 });
    const result = runBattle(
      inputs([
        ship("a1", "attacker", 0, 0, [...core(), moduleOf("se", activeSensor, 1, 0)]),
        ship("d1", "defender", 100, 0, [...core()]),
      ]),
    );
    const frame0 = result.frames[0];
    if (frame0 === undefined) throw new Error("no frame 0");
    const ems = frame0.emissions ?? [];
    const a1Emissions = ems.filter((e) => e.sourceId === "a1");
    expect(a1Emissions.length).toBe(2);
    expect(ems.filter((e) => e.sourceId === "d1").length).toBe(1);
    // The active emission carries the declared transmit power.
    expect(a1Emissions.some((e) => e.strength === 5e9)).toBe(true);
  });

  it("two runs produce byte-identical emission logs", () => {
    const mk = () =>
      runBattle(
        inputs(
          [
            ship("a1", "attacker", -100, 0, [...core(), moduleOf("se", sensor(300), 1, 0)]),
            ship("d1", "defender", 100, 0, [...core(), moduleOf("se", sensor(300), 1, 0)]),
          ],
          [],
          20,
        ),
      );
    const a = mk();
    const b = mk();
    expect(b.frames.map((f) => f.emissions)).toEqual(a.frames.map((f) => f.emissions));
  });
});
