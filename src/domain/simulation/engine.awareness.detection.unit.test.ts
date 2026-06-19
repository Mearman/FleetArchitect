import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import type {
  CombatShip,
} from "@/domain/simulation/types";
import type { BattleAnomaly } from "@/schema/battle";
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
import { defaultOrders } from "@/schema/fleet";

// ---------------------------------------------------------------------------
// 1. Determinism
// ---------------------------------------------------------------------------

describe("engine.awareness — determinism", () => {
  function mixedBattle(anomaly: BattleAnomaly) {
    return runBattle(
      inputs(
        [
          ship("a1", "attacker", -100, 0, [...core(), moduleOf("se", sensor(300), 1, 0), moduleOf("co", comms({ commsType: "omni" }), -1, 0)]),
          ship("a2", "attacker", -100, 40, [...core(), moduleOf("se", sensor(300), 1, 0), moduleOf("co", comms({ commsType: "omni" }), -1, 0)]),
          ship("d1", "defender", 100, 0, [...core(), moduleOf("se", sensor(300), 1, 0)]),
          ship("d2", "defender", 100, 40, [...core(), moduleOf("se", sensor(300), 1, 0)]),
        ],
        anomaly,
        // A moderate run exercises many awareness ticks (these ships carry no
        // weapons, so the battle would otherwise run to the full cap).
        30,
      ),
    );
  }

  it("two runs produce byte-identical awareness in an asteroid field", () => {
    const a = mixedBattle("asteroidField");
    const b = mixedBattle("asteroidField");
    expect(b.frames.map((f) => f.awareness)).toEqual(a.frames.map((f) => f.awareness));
  });

  it("two runs produce byte-identical awareness in a nebula", () => {
    const a = mixedBattle("nebula");
    const b = mixedBattle("nebula");
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
    // Visual 140 + no sensor bonus on a1 means a1 sees only within ~140 wu; the
    // enemy sits at 400. a1 has a comms unit so it is on the fog path but blind.
    const result = runBattle(
      inputs([
        ship("a1", "attacker", 0, 0, [...core(), moduleOf("co", comms({ commsType: "omni" }), 1, 0)]),
        ship("d1", "defender", 400, 0, [...core(), moduleOf("se", sensor(50), 1, 0)]),
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
    // and range 600. Both defenders sit 300 wu away — well within range — but
    // at different bearings: d1 straight ahead (bearing 0, inside the arc) and
    // d2 at ~90° (bearing PI/2, far outside the 0.4 arc). The cone sees d1, not
    // d2 — the enemy at the same range is missed purely on angle.
    const result = runBattle(
      inputs([
        ship("a1", "attacker", 0, 0, [
          ...core(),
          moduleOf("se", sensor(600, { sensorType: "directional", arc: 0.4, bearing: 0 }), 1, 0),
        ]),
        ship("d1", "defender", 300, 0, [...core()]),
        ship("d2", "defender", 0, 300, [...core()]),
      ]),
    );
    const seen = contactsOf(result, 0, "a1");
    expect(seen).toContain("d1");
    expect(seen).not.toContain("d2");
  });

  it("an omni sensor detects enemies all around, regardless of bearing", () => {
    // The same geometry as above but with an omni sensor (full circle): both
    // d1 (ahead) and d2 (abeam) are inside the 600 wu range and both are seen.
    const result = runBattle(
      inputs([
        ship("a1", "attacker", 0, 0, [...core(), moduleOf("se", sensor(600), 1, 0)]),
        ship("d1", "defender", 300, 0, [...core()]),
        ship("d2", "defender", 0, 300, [...core()]),
      ]),
    );
    expect(contactsOf(result, 0, "a1").sort()).toEqual(["d1", "d2"]);
  });

  it("a directional sensor's cone rotates with the ship's facing", () => {
    // Identical directional sensor (arc 0.4, mount bearing 0) on two ships that
    // face different ways. The enemy sits straight up (+y, bearing PI/2). The
    // ship facing +y (facing PI/2) sweeps its cone onto the enemy and sees it;
    // the ship facing +x (facing 0) points its cone away and misses — the world
    // cone bearing is mount + ship.facing.
    const build = (facing: number): CombatShip[] => [
      ship("a1", "attacker", 0, 0, [
        ...core(),
        moduleOf("se", sensor(600, { sensorType: "directional", arc: 0.4, bearing: 0 }), 1, 0),
      ], { facing }),
      ship("d1", "defender", 0, 300, [...core()]),
    ];
    const facingEnemy = runBattle(inputs(build(Math.PI / 2)));
    const facingAway = runBattle(inputs(build(0)));
    expect(contactsOf(facingEnemy, 0, "a1")).toContain("d1");
    expect(contactsOf(facingAway, 0, "a1")).not.toContain("d1");
  });

  it("a crewed dish only contributes detection when manned", () => {
    // A long-range dish (range 800) with crewRequired 1 and no crew aboard is
    // never manned, so it contributes no cone: a1 sees only its 140 wu visual
    // circle and misses the enemy at 400 wu. The identical dish with
    // crewRequired 0 (always manned) sweeps its cone onto the enemy.
    const build = (crewRequired: number): CombatShip[] => [
      ship("a1", "attacker", 0, 0, [
        ...core(),
        moduleOf("se", sensor(800, { sensorType: "dish", arc: 0.3, bearing: 0 }), 1, 0, { crewRequired }),
      ]),
      ship("d1", "defender", 400, 0, [...core()]),
    ];
    const unmanned = runBattle(inputs(build(1)));
    const crewless = runBattle(inputs(build(0)));
    expect(contactsOf(unmanned, 0, "a1")).not.toContain("d1");
    expect(contactsOf(crewless, 0, "a1")).toContain("d1");
  });

  it("a variable sensor trades range against arc with its range dial", () => {
    // One variable sensor effect: at minRange 200 the arc is widest (maxArc 0.6),
    // at maxRange 700 narrowest (minArc 0.1), interpolating linearly. The enemy
    // sits at bearing atan2(90, 300) ≈ 0.291 rad, distance ≈ 313 wu.
    //   - Dialled to 700: arc = 0.1 (< 0.291) — off-axis enemy outside the cone.
    //   - Dialled to 200: arc = 0.6 (covers 0.291) but range 200 < 313 — too short.
    //   - Dialled to 400: t = 0.4 so arc = 0.6 + (0.1 - 0.6)*0.4 = 0.4 (> 0.291)
    //     AND range 400 > 313 — the only setting that both reaches and covers it.
    const variable = sensor(400, {
      sensorType: "variable",
      arc: 0.4,
      bearing: 0,
      minRange: 200,
      maxRange: 700,
      minArc: 0.1,
      maxArc: 0.6,
    });
    const build = (rangeSetting: number): CombatShip[] => [
      ship("a1", "attacker", 0, 0, [
        ...core(),
        moduleOf("se", variable, 1, 0, { sensorRangeSetting: rangeSetting }),
      ]),
      ship("d1", "defender", 300, 90, [...core()]),
    ];
    // Long range => narrow arc: off-axis enemy missed.
    expect(contactsOf(runBattle(inputs(build(700))), 0, "a1")).not.toContain("d1");
    // Short range => wide arc but out of range: missed.
    expect(contactsOf(runBattle(inputs(build(200))), 0, "a1")).not.toContain("d1");
    // Mid range => arc wide enough and range covers it: detected.
    expect(contactsOf(runBattle(inputs(build(400))), 0, "a1")).toContain("d1");
  });

  it("nebula attenuates a non-immune sensor cone but not an immune one", () => {
    // Two attackers each with an omni sensor of range 300 looking at an enemy at
    // 250 wu. In a nebula the non-immune sensor's range halves to 150 (< 250) so
    // it loses the contact; the nebula-immune sensor keeps full 300 and holds it.
    const build = (nebulaImmune: boolean): CombatShip[] => [
      ship("a1", "attacker", 0, 0, [
        ...core(),
        moduleOf("se", sensor(300, { nebulaImmune }), 1, 0),
      ]),
      ship("d1", "defender", 250, 0, [...core()]),
    ];
    const plain = runBattle(inputs(build(false), "nebula"));
    const immune = runBattle(inputs(build(true), "nebula"));
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
          "none",
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
      thrust: 0.6,
      turnRate: 0.2,
      weapons: [],
        compartments: 0,
    airtightCompartments: 0,
};
    return {
      instanceId: id,
      designId: `d-`,
      faction: "test",
      side,
      stats,
      position: { x, y: 0 },
      facing: side === "attacker" ? 0 : Math.PI,
      // Advance-to-contact is a non-hold behaviour: a hold-order ship now pins
      // in place when blind (see engine.movement-modes "hold orders"). These
      // mobile ships use the default engage range so they genuinely close on the
      // enemy and acquire them within visual range.
      orders: { ...defaultOrders },
      classification: "frigate",
    };
  }

  it("a sensorless ship is blind beyond its visual radius — no omniscient fallback", () => {
    // A module-less ship has no sensor cones, only its innate visual circle. An
    // enemy at 400 wu is invisible: zero contacts. This is the whole point of
    // faithful fog — there is no full-visibility escape hatch for such ships.
    const result = runBattle(
      inputs([mobile("a1", "attacker", 0), mobile("d1", "defender", 400)]),
    );
    expect(contactsOf(result, 0, "a1")).toEqual([]);
  });

  it("a blind fleet advances to contact and acquires the enemy it could not initially see", () => {
    // Two blind ships deploy 800 wu apart — far outside each other's 140 wu
    // visual range, so at tick 0 neither sees the other. They must steer toward
    // the opposing deployment centroid, close the distance, and eventually
    // detect each other within visual range.
    const result = runBattle({
      ships: [mobile("a1", "attacker", -400), mobile("d1", "defender", 400)],
      attackerFleetId: "fa",
      defenderFleetId: "fd",
      anomaly: "none",
      seed: 7,
      // Enough ticks for the blind ships to close the 800 wu gap to within
      // visual range (they reach contact by ~tick 600 at thrust 0.6).
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
    // And it genuinely moved toward the enemy (its x increased from -400).
    const lastFrame = result.frames[result.frames.length - 1];
    const finalX = lastFrame?.ships.find((s) => s.instanceId === "a1")?.x ?? -400;
    expect(finalX).toBeGreaterThan(-400);
  });
});

describe("engine.awareness — occlusion", () => {
  it("a black-hole disc on the sight line blocks detection; an off-axis enemy is seen", () => {
    // The black hole sits at the origin (radius 24). a1 at (-200,0) looking at
    // d1 at (200,0) is blocked straight through the disc. d2 at (200,200) is
    // seen — its sight line clears the disc.
    const result = runBattle(
      inputs(
        [
          ship("a1", "attacker", -200, 0, [...core(), moduleOf("se", sensor(600), 1, 0)]),
          ship("d1", "defender", 200, 0, [...core(), moduleOf("se", sensor(600), 1, 0)]),
          ship("d2", "defender", 200, 200, [...core(), moduleOf("se", sensor(600), 1, 0)]),
        ],
        "blackHole",
      ),
    );
    const seen = contactsOf(result, 0, "a1");
    expect(seen).not.toContain("d1");
    expect(seen).toContain("d2");
  });
});

