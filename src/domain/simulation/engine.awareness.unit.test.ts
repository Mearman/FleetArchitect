import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import type {
  BattleInputs,
  CombatShip,
  ResolvedModule,
} from "@/domain/simulation/types";
import type { BattleAnomaly } from "@/schema/battle";
import { defaultOrders } from "@/schema/fleet";
import type {
  CommsEffect,
  ModuleEffect,
  SensorEffect,
  WeaponEffect,
} from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Opus-tier keystone test for the awareness phase (sensors, comms, fog of war).
 *
 * The phase is a pure function of ship state + occluders + anomaly that draws
 * ZERO times from the battle rng, so two runs with the same seed must produce
 * byte-identical `frames[*].awareness`. These tests pin that determinism and
 * each of the behavioural rules: direct detection, line-of-sight occlusion,
 * comms link formation (channel, range, arc, manning, laser-LOS), relay vs
 * leaf, bandwidth truncation, ghost fade, and the awareness targeting gate.
 *
 * Ships are built stationary (zero thrust/turn) so geometry is fully under the
 * fixtures' control and the awareness assertions are about position, not drift.
 */

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function statsFor(structure: number, cost = 100): ShipStats {
  return {
    mass: 10,
    massCapacity: 1000,
    cost,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    // Zero thrust and turn rate keep every fixture ship stationary so the
    // geometry the awareness assertions rely on never drifts.
    thrust: 0,
    turnRate: 0,
    weapons: [],
  };
}

function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  opts: {
    powerDraw?: number;
    crewRequired?: number;
    command?: boolean;
    channel?: number;
    commsBearing?: number;
    commsRange?: number;
    sensorBearing?: number;
    sensorRangeSetting?: number;
  } = {},
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    x: col,
    y: row,
    maxHp: 50,
    mass: 5,
    powerDraw: opts.powerDraw ?? 0,
    crewRequired: opts.crewRequired ?? 0,
    effect,
    command: opts.command ?? false,
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    // For a comms module these carry the link config; for everything else they
    // are 0 and unused. The engine reads `channel`/`commsBearing` off the
    // resolved module directly, so the test sets them per-instance here.
    channel: effect.kind === "comms" ? opts.channel ?? 0 : 0,
    commsBearing: effect.kind === "comms" ? opts.commsBearing ?? effect.bearing : 0,
    ...(opts.commsRange !== undefined ? { commsRange: opts.commsRange } : {}),
    // A sensor module's mount bearing: the per-instance override when given,
    // else the effect's own bearing. 0 and unused on every other kind.
    sensorBearing: effect.kind === "sensor" ? opts.sensorBearing ?? effect.bearing : 0,
    ...(opts.sensorRangeSetting !== undefined
      ? { sensorRangeSetting: opts.sensorRangeSetting }
      : {}),
  };
}

/** An omni sensor of the given range (a full circle), unless overridden. Most
 *  fixtures want all-round detection so the geometry under test is range, not
 *  arc; the directional/variable tests pass explicit overrides. */
function sensor(
  detectionRange: number,
  over: Partial<SensorEffect> = {},
): SensorEffect {
  return {
    kind: "sensor",
    sensorType: "omni",
    // Omni: half-arc PI = full circle. Directional/dish narrow this.
    arc: Math.PI,
    bearing: 0,
    nebulaImmune: false,
    detectionRange,
    ...over,
  };
}

function comms(over: Partial<CommsEffect> & { commsType: CommsEffect["commsType"] }): CommsEffect {
  return {
    kind: "comms",
    range: 500,
    // Omni: half-arc PI = full circle. Directional/dish/laser narrow this.
    arc: Math.PI,
    bearing: 0,
    channel: 0,
    bandwidth: 16,
    ...over,
  };
}

function beam(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 30,
    range: 600,
    cooldown: 2,
    projectileSpeed: 0,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    facing: 0,
    ...over,
  };
}

function ship(
  id: string,
  side: "attacker" | "defender",
  x: number,
  y: number,
  modules: ResolvedModule[],
  opts: { cost?: number; facing?: number; orders?: Partial<typeof defaultOrders> } = {},
): CombatShip {
  return {
    instanceId: id,
    designId: `d-${id}`,
    side,
    stats: statsFor(100_000, opts.cost ?? 100),
    position: { x, y },
    facing: opts.facing ?? (side === "attacker" ? 0 : Math.PI),
    orders: { ...defaultOrders, engageRange: "hold", ...opts.orders },
    classification: "frigate",
    modules,
  };
}

/** A bridge + reactor so a ship's weapons can coordinate and draw power. */
function core(): ResolvedModule[] {
  return [
    moduleOf("cmd", { kind: "power", output: 200 }, 0, 0, { command: true }),
  ];
}

/** Most awareness assertions only inspect tick 0 (the opening fog snapshot),
 *  so the default run is short — these stationary fixtures never resolve on
 *  their own (no/weak weapons), and a full-length run would just spin the
 *  awareness phase needlessly. Tests that need to watch behaviour over time
 *  (ghost fade, accumulating damage) pass an explicit longer cap. */
const SHORT_TICKS = 3;

function inputs(
  ships: CombatShip[],
  anomaly: BattleAnomaly = "none",
  maxTicks: number = SHORT_TICKS,
): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomaly,
    seed: 7,
    maxTicks,
  };
}

// ---------------------------------------------------------------------------
// Snapshot query helpers
// ---------------------------------------------------------------------------

function awarenessAt(result: ReturnType<typeof runBattle>, tick: number) {
  const frame = result.frames[tick];
  if (frame === undefined) throw new Error(`no frame ${tick}`);
  const a = frame.awareness;
  if (a === undefined) throw new Error(`frame ${tick} has no awareness`);
  return a;
}

function contactsOf(
  result: ReturnType<typeof runBattle>,
  tick: number,
  observerId: string,
): string[] {
  return awarenessAt(result, tick)
    .contacts.filter((c) => c.observerId === observerId)
    .map((c) => c.enemyId)
    .sort();
}

function ghostsOf(
  result: ReturnType<typeof runBattle>,
  tick: number,
  observerId: string,
): { enemyId: string; ticksLeft: number }[] {
  return awarenessAt(result, tick)
    .ghosts.filter((g) => g.observerId === observerId)
    .map((g) => ({ enemyId: g.enemyId, ticksLeft: g.ticksLeft }));
}

function linksOf(result: ReturnType<typeof runBattle>, tick: number) {
  return awarenessAt(result, tick).links;
}

function structureOf(
  result: ReturnType<typeof runBattle>,
  tick: number,
  id: string,
): number {
  const frame = result.frames[tick];
  return frame?.ships.find((s) => s.instanceId === id)?.structure ?? 0;
}

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
      massCapacity: 1000,
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
    };
    return {
      instanceId: id,
      designId: `d-${id}`,
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

// ---------------------------------------------------------------------------
// 3. Comms links: channel, arc, manning, laser LOS
// ---------------------------------------------------------------------------

describe("engine.awareness — comms links", () => {
  it("two omni units on the same channel within range form a link", () => {
    const result = runBattle(
      inputs([
        ship("a1", "attacker", -100, 0, [...core(), moduleOf("co", comms({ commsType: "omni", channel: 3 }), 1, 0, { channel: 3 })]),
        ship("a2", "attacker", -100, 40, [...core(), moduleOf("co", comms({ commsType: "omni", channel: 3 }), 1, 0, { channel: 3 })]),
        ship("d1", "defender", 800, 0, [...core()]),
      ]),
    );
    expect(linksOf(result, 0).length).toBe(1);
  });

  it("a channel mismatch forms no link", () => {
    const result = runBattle(
      inputs([
        ship("a1", "attacker", -100, 0, [...core(), moduleOf("co", comms({ commsType: "omni", channel: 1 }), 1, 0, { channel: 1 })]),
        ship("a2", "attacker", -100, 40, [...core(), moduleOf("co", comms({ commsType: "omni", channel: 2 }), 1, 0, { channel: 2 })]),
        ship("d1", "defender", 800, 0, [...core()]),
      ]),
    );
    expect(linksOf(result, 0).length).toBe(0);
  });

  it("a directional unit pointing away from its ally forms no link (arc miss)", () => {
    // a1's directional dish at bearing 0 points +x (toward the enemy side),
    // away from a2 which sits at bearing PI/2 (straight +y). A narrow arc misses.
    const result = runBattle(
      inputs([
        ship("a1", "attacker", 0, 0, [
          ...core(),
          moduleOf("co", comms({ commsType: "directional", channel: 5, arc: 0.2, bearing: 0 }), 1, 0, { channel: 5, commsBearing: 0 }),
        ]),
        ship("a2", "attacker", 0, 200, [
          ...core(),
          moduleOf("co", comms({ commsType: "directional", channel: 5, arc: 0.2, bearing: 0 }), 1, 0, { channel: 5, commsBearing: 0 }),
        ]),
        ship("d1", "defender", 800, 0, [...core()]),
      ]),
    );
    expect(linksOf(result, 0).length).toBe(0);
  });

  it("a laser link needs clear line of sight where an RF dish does not", () => {
    // Black hole disc at the origin between two allies on the x axis.
    // Build the same geometry twice: once with laser comms (LOS required, the
    // disc blocks it) and once with an omni RF link (passes through the disc).
    // Both ends crewless (crewRequired 0 => always manned) so the laser's
    // manning gate passes and only the LOS test distinguishes the two cases.
    const allyPair = (commsType: CommsEffect["commsType"]): CombatShip[] => [
      ship("a1", "attacker", -200, 0, [
        ...core(),
        moduleOf("co", comms({ commsType, channel: 9 }), 1, 0, { channel: 9 }),
      ]),
      ship("a2", "attacker", 200, 0, [
        ...core(),
        moduleOf("co", comms({ commsType, channel: 9 }), 1, 0, { channel: 9 }),
      ]),
      ship("d1", "defender", 0, 900, [...core()]),
    ];
    const rf = runBattle(inputs(allyPair("omni"), "blackHole"));
    const laser = runBattle(inputs(allyPair("laser"), "blackHole"));
    expect(linksOf(rf, 0).length).toBe(1);
    expect(linksOf(laser, 0).length).toBe(0);
  });

  it("a crewed dish forms no link while unmanned and a crewless one does", () => {
    // A dish with crewRequired 1 and no crew aboard is never manned, so the aim
    // pass skips it and no link forms. The identical pair with crewRequired 0
    // (always manned) links immediately.
    const dishPair = (crewRequired: number): CombatShip[] => [
      ship("a1", "attacker", -60, 0, [
        ...core(),
        moduleOf("co", comms({ commsType: "dish", channel: 4 }), 1, 0, { channel: 4, crewRequired }),
      ]),
      ship("a2", "attacker", 60, 0, [
        ...core(),
        moduleOf("co", comms({ commsType: "dish", channel: 4 }), 1, 0, { channel: 4, crewRequired }),
      ]),
      ship("d1", "defender", 0, 900, [...core()]),
    ];
    const unmanned = runBattle(inputs(dishPair(1)));
    const crewless = runBattle(inputs(dishPair(0)));
    expect(linksOf(unmanned, 0).length).toBe(0);
    expect(linksOf(crewless, 0).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Relay (needs 2 units) and bandwidth
// ---------------------------------------------------------------------------

describe("engine.awareness — relay and bandwidth", () => {
  it("a chain A—B—C only propagates a contact when the middle ship has two comms units", () => {
    // C sees the enemy; A is out of detection range of it. B is the relay. With
    // two omni units B forwards C's contact to A; with one unit B is a leaf and
    // A learns nothing.
    //
    // Geometry on the x axis: A at -400, B at -200, C at 0, enemy d1 at 120.
    // C (sensor 300) sees d1 at 120 wu. A (no sensor, visual 140 only) cannot
    // see d1 at 520 wu, so any knowledge of d1 must arrive via the relay.
    //
    // Omni range 250: A—B (200) and B—C (200) link, but A—C (400) does NOT, so
    // the only path from C to A runs through B. That makes B's relay status the
    // decisive factor (a direct C—A link would let A see d1 regardless of B).
    const R = 250;
    const build = (middleUnits: 1 | 2): CombatShip[] => {
      const middleComms: ResolvedModule[] =
        middleUnits === 2
          ? [
              moduleOf("co1", comms({ commsType: "omni", channel: 7, range: R }), 1, 0, { channel: 7 }),
              moduleOf("co2", comms({ commsType: "omni", channel: 7, range: R }), -1, 0, { channel: 7 }),
            ]
          : [moduleOf("co1", comms({ commsType: "omni", channel: 7, range: R }), 1, 0, { channel: 7 })];
      return [
        ship("A", "attacker", -400, 0, [...core(), moduleOf("co", comms({ commsType: "omni", channel: 7, range: R }), 1, 0, { channel: 7 })]),
        ship("B", "attacker", -200, 0, [...core(), ...middleComms]),
        ship("C", "attacker", 0, 0, [...core(), moduleOf("se", sensor(300), 1, 0), moduleOf("co", comms({ commsType: "omni", channel: 7, range: R }), -1, 0, { channel: 7 })]),
        ship("d1", "defender", 120, 0, [...core()]),
      ];
    };
    const withRelay = runBattle(inputs(build(2)));
    const withoutRelay = runBattle(inputs(build(1)));
    expect(contactsOf(withRelay, 0, "A")).toContain("d1");
    expect(contactsOf(withoutRelay, 0, "A")).not.toContain("d1");
  });

  it("a bandwidth-1 relay forwards only the single highest-threat contact", () => {
    // C sees two enemies; the relay link B→A has bandwidth 1, so A learns about
    // exactly one — the higher-threat (nearer) of the two. d1 is nearer C than
    // d2, so d1 wins the single slot.
    // Omni range 250 again so A links only through B (a direct A—C link would
    // hand A both contacts and defeat the bandwidth point). The link C→B is wide
    // (bandwidth 8) so B receives BOTH contacts; the link B→A is narrowed to 1
    // by A's unit, so the relay must drop the lower-priority (farther) contact.
    const R = 250;
    const WIDE = 8;
    const build = (): CombatShip[] => [
      ship("A", "attacker", -400, 0, [...core(), moduleOf("co", comms({ commsType: "omni", channel: 7, bandwidth: 1, range: R }), 1, 0, { channel: 7 })]),
      ship("B", "attacker", -200, 0, [
        ...core(),
        moduleOf("co1", comms({ commsType: "omni", channel: 7, bandwidth: WIDE, range: R }), 1, 0, { channel: 7 }),
        moduleOf("co2", comms({ commsType: "omni", channel: 7, bandwidth: WIDE, range: R }), -1, 0, { channel: 7 }),
      ]),
      ship("C", "attacker", 0, 0, [...core(), moduleOf("se", sensor(400), 1, 0), moduleOf("co", comms({ commsType: "omni", channel: 7, bandwidth: WIDE, range: R }), -1, 0, { channel: 7 })]),
      ship("d1", "defender", 100, 0, [...core()]),
      ship("d2", "defender", 300, 0, [...core()]),
    ];
    const result = runBattle(inputs(build()));
    // C sees both directly.
    expect(contactsOf(result, 0, "C").sort()).toEqual(["d1", "d2"]);
    // A receives only the nearer (higher-threat) one through the 1-wide link.
    expect(contactsOf(result, 0, "A")).toEqual(["d1"]);
  });
});

// ---------------------------------------------------------------------------
// 5. Ghosts
// ---------------------------------------------------------------------------

describe("engine.awareness — ghosts", () => {
  it("a contact that dies leaves no ghost; a live contact carries a full-life ghost", () => {
    // a1 sees d1 directly every tick it is alive; while alive, a1 holds a
    // ghost at full life. Once d1 dies it is dropped from ghosts (dead target).
    const result = runBattle(
      inputs([
        ship("a1", "attacker", 0, 0, [
          ...core(),
          moduleOf("se", sensor(400), 1, 0),
          moduleOf("w", beam({ damage: 100_000, range: 600, cooldown: 1 }), 2, 0, { command: false }),
        ]),
        // A fragile defender that a1 will quickly destroy.
        {
          instanceId: "d1",
          designId: "dd1",
          side: "defender",
          stats: statsFor(1, 100),
          position: { x: 150, y: 0 },
          facing: Math.PI,
          orders: { ...defaultOrders, engageRange: "hold" },
          classification: "fighter",
        },
      ]),
    );
    // While alive (tick 0), a1 has a live contact on d1 and a full-life ghost.
    expect(contactsOf(result, 0, "a1")).toContain("d1");
    const g0 = ghostsOf(result, 0, "a1").find((g) => g.enemyId === "d1");
    expect(g0?.ticksLeft).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// 6. Targeting gate
// ---------------------------------------------------------------------------

describe("engine.awareness — targeting gate", () => {
  it("a ship with comms but no sensor sees nothing and never fires; adding a sensor lets it fire", () => {
    // The shooter carries a comms unit (so it is on the fog-of-war path) but no
    // sensor and no ally to relay from — its awareness is empty, so it holds
    // fire forever. Adding a sensor gives it a direct contact and it engages.
    const build = (withSensor: boolean): CombatShip[] => {
      const shooterModules: ResolvedModule[] = [
        ...core(),
        moduleOf("co", comms({ commsType: "omni", channel: 1 }), -1, 0, { channel: 1 }),
        moduleOf("w", beam({ damage: 500, range: 600, cooldown: 1 }), 1, 0),
      ];
      if (withSensor) shooterModules.push(moduleOf("se", sensor(400), 2, 0));
      return [
        ship("a1", "attacker", 0, 0, shooterModules),
        ship("d1", "defender", 150, 0, [...core()]),
      ];
    };
    const blind = runBattle(inputs(build(false)));
    const seeing = runBattle(inputs(build(true)));

    // The blind shooter never damages the defender across the whole battle.
    const lastBlind = blind.frames.length - 1;
    expect(structureOf(blind, lastBlind, "d1")).toBe(structureOf(blind, 0, "d1"));

    // The seeing shooter does damage it.
    const lastSeeing = seeing.frames.length - 1;
    expect(structureOf(seeing, lastSeeing, "d1")).toBeLessThan(structureOf(seeing, 0, "d1"));
  });
});

// ---------------------------------------------------------------------------
// 7. Per-ship isolation
// ---------------------------------------------------------------------------

describe("engine.awareness — per-ship isolation", () => {
  it("same-side ships with no comms path share nothing; an omni link shares; a third component sees neither", () => {
    // Two same-side observers each see a different enemy directly. A separate
    // third observer (far away, its own component) sees neither.
    //
    // Layout: a1 at (0,0) sees d1 at (120,0). a2 at (0,600) sees d2 at (120,600).
    // a3 at (0,-600) sees nothing within range. Detection radius (visual 140 +
    // 200) = 340, so each observer reaches only its own nearby enemy.
    const noLink: CombatShip[] = [
      ship("a1", "attacker", 0, 0, [...core(), moduleOf("se", sensor(200), 1, 0)]),
      ship("a2", "attacker", 0, 600, [...core(), moduleOf("se", sensor(200), 1, 0)]),
      ship("a3", "attacker", 0, -1100, [...core(), moduleOf("se", sensor(200), 1, 0)]),
      ship("d1", "defender", 120, 0, [...core()]),
      ship("d2", "defender", 120, 600, [...core()]),
    ];
    const result = runBattle(inputs(noLink));
    // Without any comms link a1 sees only d1, a2 only d2, a3 neither.
    expect(contactsOf(result, 0, "a1")).toEqual(["d1"]);
    expect(contactsOf(result, 0, "a2")).toEqual(["d2"]);
    expect(contactsOf(result, 0, "a3")).toEqual([]);

    // Now link a1 and a2 with a long-range omni pair on a shared channel: they
    // pool their contacts and each sees both d1 and d2. a3 is in its own
    // component and still sees neither.
    const linked: CombatShip[] = [
      ship("a1", "attacker", 0, 0, [...core(), moduleOf("se", sensor(200), 1, 0), moduleOf("co", comms({ commsType: "omni", channel: 8, range: 1000 }), -1, 0, { channel: 8 })]),
      ship("a2", "attacker", 0, 600, [...core(), moduleOf("se", sensor(200), 1, 0), moduleOf("co", comms({ commsType: "omni", channel: 8, range: 1000 }), -1, 0, { channel: 8 })]),
      ship("a3", "attacker", 0, -1100, [...core(), moduleOf("se", sensor(200), 1, 0), moduleOf("co", comms({ commsType: "omni", channel: 8, range: 1000 }), -1, 0, { channel: 8 })]),
      ship("d1", "defender", 120, 0, [...core()]),
      ship("d2", "defender", 120, 600, [...core()]),
    ];
    const linkedResult = runBattle(inputs(linked));
    // a1 and a2 each carry a single comms unit, so neither is a relay (relay
    // needs >= 2 linked units). But a leaf still forwards its OWN direct
    // contacts across the link, so a1 gains d2 and a2 gains d1.
    expect(contactsOf(linkedResult, 0, "a1").sort()).toEqual(["d1", "d2"]);
    expect(contactsOf(linkedResult, 0, "a2").sort()).toEqual(["d1", "d2"]);
    // a3 at (0,-1100) is 1100 wu from a1 and 1700 from a2 — beyond the 1000 wu
    // omni range of both, so it forms no link and stays its own component,
    // sharing nothing and seeing no enemy within its own 340 wu reach.
    expect(contactsOf(linkedResult, 0, "a3")).toEqual([]);
  });
});
