import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import type {
  CombatShip,
} from "@/domain/simulation/types";
import type { BattleAnomalyKind } from "@/schema/battle";
import {
  comms,
  contactsOf,
  core,
  inputs,
  moduleOf,
  sensor,
  ship,
} from "@/domain/simulation/engine.awareness-helpers";
import type { ShipStats } from "@/domain/stats";

// ---------------------------------------------------------------------------
// 1. Determinism
// ---------------------------------------------------------------------------

describe("engine.awareness — determinism", () => {
  function mixedBattle(anomalies: BattleAnomalyKind[]) {
    return runBattle(
      inputs(
        [
          ship("a1", "attacker", -100, 0, [...core(), moduleOf("se", sensor(300), 1, 0), moduleOf("co", comms({ commsType: "omni" }), -1, 0)]),
          ship("a2", "attacker", -100, 40, [...core(), moduleOf("se", sensor(300), 1, 0), moduleOf("co", comms({ commsType: "omni" }), -1, 0)]),
          ship("d1", "defender", 100, 0, [...core(), moduleOf("se", sensor(300), 1, 0)]),
          ship("d2", "defender", 100, 40, [...core(), moduleOf("se", sensor(300), 1, 0)]),
        ],
        anomalies,
        // A moderate run exercises many awareness ticks (these ships carry no
        // weapons, so the battle would otherwise run to the full cap).
        30,
      ),
    );
  }

  it("two runs produce byte-identical awareness in an asteroid field", () => {
    const a = mixedBattle(["asteroidField"]);
    const b = mixedBattle(["asteroidField"]);
    expect(b.frames.map((f) => f.awareness)).toEqual(a.frames.map((f) => f.awareness));
  });

  it("two runs produce byte-identical awareness in a nebula", () => {
    const a = mixedBattle(["nebula"]);
    const b = mixedBattle(["nebula"]);
    expect(b.frames.map((f) => f.awareness)).toEqual(a.frames.map((f) => f.awareness));
  });
});

// ---------------------------------------------------------------------------
// 2. Direct detection + occlusion
// ---------------------------------------------------------------------------

describe("engine.awareness — direct detection", () => {
  it("an enemy inside the effective sensor radius is a direct contact", () => {
    // The enemy is 200 wu away, inside the omni sensor cone (range 300).
    const result = runBattle(
      inputs([
        ship("a1", "attacker", 0, 0, [...core(), moduleOf("se", sensor(300), 1, 0)]),
        ship("d1", "defender", 200, 0, [...core(), moduleOf("se", sensor(300), 1, 0)]),
      ]),
    );
    expect(contactsOf(result, 0, "a1")).toContain("d1");
    expect(contactsOf(result, 0, "d1")).toContain("a1");
  });

  it("an enemy beyond the effective sensor radius is not a contact", () => {
    // The innate visual baseline is ~5000 m; the enemy sits at 8000 m, beyond
    // the baseline. a1 has a comms unit (so it is on the fog path) but no sensor
    // of its own — the baseline is the only receiver, and 8000 m exceeds it.
    // d1's own sensor is irrelevant: it does not contribute to a1's awareness.
    const result = runBattle(
      inputs([
        ship("a1", "attacker", 0, 0, [...core(), moduleOf("co", comms({ commsType: "omni" }), 1, 0)]),
        ship("d1", "defender", 8000, 0, [...core(), moduleOf("se", sensor(50), 1, 0)]),
      ]),
    );
    expect(contactsOf(result, 0, "a1")).not.toContain("d1");
  });
});

// ---------------------------------------------------------------------------
// 2b. Directional sensor cones (arc, dish manning, variable trade)
// ---------------------------------------------------------------------------

describe("engine.awareness — directional sensor cones", () => {
  it("a directional sensor detects an enemy inside its arc but misses one at the same range outside it", () => {
    // a1 carries a forward (bearing 0) directional sensor of half-arc 0.4 rad
    // and range 8000. Both defenders sit 6000 m away — well within sensor range
    // and beyond the ~5000 m innate baseline — at different bearings: d1 straight
    // ahead (bearing 0, inside the arc) and d2 at ~90° (bearing PI/2, far outside
    // the 0.4 arc). The cone sees d1; the innate baseline misses both (6000 >
    // 5000) and d2 is off-bearing, so d2 is not a contact.
    const result = runBattle(
      inputs([
        ship("a1", "attacker", 0, 0, [
          ...core(),
          moduleOf("se", sensor(8000, { sensorType: "directional", arc: 0.4, bearing: 0 }), 1, 0),
        ]),
        ship("d1", "defender", 6000, 0, [...core()]),
        ship("d2", "defender", 0, 6000, [...core()]),
      ]),
    );
    const seen = contactsOf(result, 0, "a1");
    expect(seen).toContain("d1");
    expect(seen).not.toContain("d2");
  });

  it("an omni sensor detects enemies all around, regardless of bearing", () => {
    // The same geometry as the directional test but with an omni sensor (full
    // circle): both d1 (ahead) and d2 (abeam) sit at 6000 m — beyond the ~5000 m
    // innate baseline but within the 8000 m omni sensor range. The full-circle
    // cone covers all bearings, so both are seen.
    const result = runBattle(
      inputs([
        ship("a1", "attacker", 0, 0, [...core(), moduleOf("se", sensor(8000), 1, 0)]),
        ship("d1", "defender", 6000, 0, [...core()]),
        ship("d2", "defender", 0, 6000, [...core()]),
      ]),
    );
    expect(contactsOf(result, 0, "a1").sort()).toEqual(["d1", "d2"]);
  });

  it("a directional sensor's cone rotates with the ship's facing", () => {
    // Identical directional sensor (arc 0.4, mount bearing 0) on two ships that
    // face different ways. The enemy sits straight up (+y, bearing PI/2) at
    // 6000 m — beyond the ~5000 m innate baseline so the cone is what decides.
    // The ship facing +y (facing PI/2) sweeps its cone onto the enemy and sees
    // it; the ship facing +x (facing 0) points its cone away and misses — the
    // world cone bearing is mount + ship.facing.
    const build = (facing: number): CombatShip[] => [
      ship("a1", "attacker", 0, 0, [
        ...core(),
        moduleOf("se", sensor(8000, { sensorType: "directional", arc: 0.4, bearing: 0 }), 1, 0),
      ], { facing }),
      ship("d1", "defender", 0, 6000, [...core()]),
    ];
    const facingEnemy = runBattle(inputs(build(Math.PI / 2)));
    const facingAway = runBattle(inputs(build(0)));
    expect(contactsOf(facingEnemy, 0, "a1")).toContain("d1");
    expect(contactsOf(facingAway, 0, "a1")).not.toContain("d1");
  });

  it("a crewed dish only contributes detection when manned", () => {
    // A long-range dish (range 8000) with crewRequired 1 and no crew aboard is
    // never manned, so it contributes no cone: a1 sees only its ~5000 m innate
    // baseline and misses the enemy at 6000 m. The identical dish with
    // crewRequired 0 (always manned) sweeps its cone onto the enemy (arc 0.3,
    // bearing 0, enemy dead ahead at 6000 m — well within 8000 m range).
    const build = (crewRequired: number): CombatShip[] => [
      ship("a1", "attacker", 0, 0, [
        ...core(),
        moduleOf("se", sensor(8000, { sensorType: "dish", arc: 0.3, bearing: 0 }), 1, 0, { crewRequired }),
      ]),
      ship("d1", "defender", 6000, 0, [...core()]),
    ];
    const unmanned = runBattle(inputs(build(1)));
    const crewless = runBattle(inputs(build(0)));
    expect(contactsOf(unmanned, 0, "a1")).not.toContain("d1");
    expect(contactsOf(crewless, 0, "a1")).toContain("d1");
  });

  it("a variable sensor trades range against arc with its range dial", () => {
    // One variable sensor effect: at minRange 7000 the arc is widest (maxArc 0.6),
    // at maxRange 25000 narrowest (minArc 0.1), interpolating linearly. The enemy
    // sits at bearing atan2(3000, 10000) ≈ 0.291 rad, distance ≈ 10440 m —
    // beyond the ~5000 m innate baseline, so the sensor cone is the decisive factor.
    //   - Dialled to 25000: arc = 0.1 (< 0.291) — off-axis enemy outside the cone.
    //   - Dialled to 7000: arc = 0.6 (covers 0.291) but range 7000 < 10440 — too short.
    //   - Dialled to 14000: t ≈ 0.389 so arc = 0.6 + (0.1 - 0.6)*0.389 ≈ 0.406 (> 0.291)
    //     AND range 14000 > 10440 — the only setting that both reaches and covers it.
    const variable = sensor(14000, {
      sensorType: "variable",
      arc: 0.406,
      bearing: 0,
      minRange: 7000,
      maxRange: 25000,
      minArc: 0.1,
      maxArc: 0.6,
    });
    const build = (rangeSetting: number): CombatShip[] => [
      ship("a1", "attacker", 0, 0, [
        ...core(),
        moduleOf("se", variable, 1, 0, { sensorRangeSetting: rangeSetting }),
      ]),
      ship("d1", "defender", 10000, 3000, [...core()]),
    ];
    // Long range => narrow arc: off-axis enemy missed.
    expect(contactsOf(runBattle(inputs(build(25000))), 0, "a1")).not.toContain("d1");
    // Short range => wide arc but out of range: missed.
    expect(contactsOf(runBattle(inputs(build(7000))), 0, "a1")).not.toContain("d1");
    // Mid range => arc wide enough and range covers it: detected.
    expect(contactsOf(runBattle(inputs(build(14000))), 0, "a1")).toContain("d1");
  });

  it("nebula attenuates a non-immune sensor cone but not an immune one", () => {
    // Two attackers each with an omni sensor of range 5000 looking at an enemy
    // at 3000 m. The innate baseline inside a nebula reaches only ~2483 m (the
    // nebula sensor transmittance ~0.497 shrinks it), so the baseline alone
    // cannot see the enemy at 3000 m. The non-immune sensor is also attenuated to
    // ~2483 m (< 3000 m) and loses the contact; the nebula-immune sensor keeps its
    // full 5000 m range and holds it.
    const build = (nebulaImmune: boolean): CombatShip[] => [
      ship("a1", "attacker", 0, 0, [
        ...core(),
        moduleOf("se", sensor(5000, { nebulaImmune }), 1, 0),
      ]),
      ship("d1", "defender", 3000, 0, [...core()]),
    ];
    const plain = runBattle(inputs(build(false), ["nebula"]));
    const immune = runBattle(inputs(build(true), ["nebula"]));
    expect(contactsOf(plain, 0, "a1")).not.toContain("d1");
    expect(contactsOf(immune, 0, "a1")).toContain("d1");
  });

  it("two runs with directional sensors produce byte-identical awareness", () => {
    // Determinism with the cone path exercised: a directional and a dish sensor
    // on opposing ships across a moderate run must be byte-identical run to run.
    const mk = () =>
      runBattle(
        inputs(
          [
            ship("a1", "attacker", -150, 20, [
              ...core(),
              moduleOf("se", sensor(600, { sensorType: "directional", arc: 0.5, bearing: 0 }), 1, 0),
            ]),
            ship("d1", "defender", 150, -20, [
              ...core(),
              moduleOf("se", sensor(800, { sensorType: "dish", arc: 0.25, bearing: 0 }), 1, 0),
            ]),
          ],
          [],
          30,
        ),
      );
    const a = mk();
    const b = mk();
    expect(b.frames.map((f) => f.awareness)).toEqual(a.frames.map((f) => f.awareness));
  });
});

describe("engine.awareness — faithful fog (no omniscience)", () => {
  // A non-modular mobile ship: thrust drives advance-to-contact. With the
  // sensorRange scalar removed, a module-less ship sees only out to its innate
  // visual circle (SIM.visualLosRadius) — there is no aggregated sensor reach.
  function mobile(
    id: string,
    side: "attacker" | "defender",
    x: number,
  ): CombatShip {
    const stats: ShipStats = {
      mass: 10,
      cost: 100,
      powerDraw: 0,
      powerOutput: 0,
      powerNet: 0,
      crewRequired: 0,
      crewCapacity: 0,
      crewNet: 0,
      structure: 100_000,
      damageReduction: 0,
      shieldCapacity: 0,
      shieldRechargeRate: 0,
      shieldRechargeDelay: 30,
      deflectorCapacity: 0,
      deflectorRechargeRate: 0,
      deflectorRechargeDelay: 0,
      // Legacy (non-modular) path: movement.ts caps top speed at `thrust` and
      // sets per-tick accel to (thrust/mass)·ACCEL_PER_TICK_FROM_SI = (thrust/mass)/900.
      // 540 (= 0.6 × 900) restores the closing acceleration the advance-to-contact
      // budget was sized for; the raised speed cap is never approached within the
      // run, so the ship simply reaches visual contact well inside the tick budget.
      thrust: 540,
      turnRate: 0.2,
      weapons: [],
        compartments: 0,
    airtightCompartments: 0,
};
    return {
      instanceId: id,
      designId: `d-`,
      faction: "Terran",
      side,
      stats,
      position: { x, y: 0 },
      facing: side === "attacker" ? 0 : Math.PI,
      // Advance-to-contact is a non-hold behaviour: a hold-order ship now pins
      // in place when blind (see engine.movement-modes "hold orders"). These
      // mobile ships use the default engage range so they genuinely close on the
      // enemy and acquire them within visual range.
      doctrine: { base: {}, rules: [] },
      classification: "frigate",
    };
  }

  it("a sensorless ship is blind beyond its visual radius — no omniscient fallback", () => {
    // A module-less ship has no sensor cones, only its innate visual circle of
    // ~5000 m. An enemy at 6000 m is invisible: zero contacts. This is the whole
    // point of faithful fog — there is no full-visibility escape hatch for such
    // ships, and the innate 5000 m baseline does not stretch to 6000 m.
    const result = runBattle(
      inputs([mobile("a1", "attacker", 0), mobile("d1", "defender", 6000)]),
    );
    expect(contactsOf(result, 0, "a1")).toEqual([]);
  });

  it("a blind fleet advances to contact and acquires the enemy it could not initially see", () => {
    // Two blind ships deploy 10 200 m apart (±5100 m) — far outside each
    // other's ~5000 m innate visual range, so at tick 0 neither sees the other.
    // They must steer toward the opposing deployment centroid, close the distance,
    // and eventually detect each other within visual range.
    const result = runBattle({
      ships: [mobile("a1", "attacker", -5100), mobile("d1", "defender", 5100)],
      attackerFleetId: "fa",
      defenderFleetId: "fd",
      anomalies: [],
      seed: 7,
      // Enough ticks for the blind ships to close the 10 200 m gap to within
      // visual range under the corrected per-tick acceleration (thrust 540).
      maxTicks: 800,
    });

    // Initially blind.
    expect(contactsOf(result, 0, "a1")).toEqual([]);
    // By the end of the run the attacker has closed and acquired the defender.
    const everSawEnemy = result.frames.some((f) =>
      (f.awareness?.contacts ?? []).some(
        (c) => c.observerId === "a1" && c.enemyId === "d1",
      ),
    );
    expect(everSawEnemy, "the blind attacker should advance to contact and detect d1").toBe(true);
    // And it genuinely moved toward the enemy (its x increased from -5100).
    const lastFrame = result.frames[result.frames.length - 1];
    const finalX = lastFrame?.ships.find((s) => s.instanceId === "a1")?.x ?? -5100;
    expect(finalX).toBeGreaterThan(-5100);
  });
});

describe("engine.awareness — occlusion", () => {
  it("a black-hole disc on the sight line blocks detection; an off-axis enemy is seen", () => {
    // The black hole sits at the origin (radius 2 km). a1 at (-16 km,0) looking
    // at d1 at (16 km,0) is blocked straight through the disc. d2 at
    // (16 km,16 km) is seen — its sight line clears the disc.
    // Re-baselined for km combat (Phase 5): the horizon is now 2 km so the
    // ships sit well outside it at km-scale distances.
    const result = runBattle(
      inputs(
        [
          ship("a1", "attacker", -16_000, 0, [...core(), moduleOf("se", sensor(50_000), 1, 0)]),
          ship("d1", "defender", 16_000, 0, [...core(), moduleOf("se", sensor(50_000), 1, 0)]),
          ship("d2", "defender", 16_000, 16_000, [...core(), moduleOf("se", sensor(50_000), 1, 0)]),
        ],
        ["blackHole"],
      ),
    );
    const seen = contactsOf(result, 0, "a1");
    expect(seen).not.toContain("d1");
    expect(seen).toContain("d2");
  });
});

