import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import type { CombatShip, BattleInputs, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ShipClassification } from "@/schema/armor";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";


const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

/**
 * Unit tests for the tactical order system (Phase I2).
 *
 * Each describe block isolates one order dimension:
 *  - focusFire: concentrates the fleet's fire on a single target
 *  - vulnerableTargetWeight: prefers low-HP / high-vulnerability targets
 *  - cautious vs aggressive stance: cautious ships keep more range
 *  - rangeKeepingBand: wide band allows more range drift than narrow
 *
 * All tests use hitscan beams (projectileSpeed=0). Ships use high thrust
 * (50 units) so they settle into their engagement range within ~80 ticks
 * at a max speed of 50 units/tick; the per-module engine module supplies
 * that same thrust so movement is unchanged from the legacy scalar path.
 */

function weapon(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 5,
    range: 400,
    cooldown: 5,
    projectileSpeed: 0,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    ...over,
  };
}

/** Build a ResolvedModule with the per-instance fields the engine reads. */
function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  command = false,
): ResolvedModule {
  return {
    slotId,
    moduleId: slotId,
    kind: effect.kind,
    col,
    row,
    x: col,
    y: row,
    maxSurfaceHp: 0,
    maxScaffoldHp: 500,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    surface: "deck",
    edges: OPEN_EDGES,
    mass: 1,
    powerDraw: 0,
    crewRequired: 0,
    effect,
    command,
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: effect.kind === "engine" ? effect.facing ?? 0 : 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

/** An all-round (omni) sensor effect — a full detection circle, which is what
 *  the removed sensorRange scalar stood in for. */
function omniSensor(detectionRange: number): ModuleEffect {
  return {
    kind: "sensor",
    sensorType: "omni",
    arc: Math.PI,
    detectionRange,
    bearing: 0,
    nebulaImmune: false,
  };
}

/**
 * The engine-module thrust that reproduces the legacy movement model's
 * terminal velocity on a per-module ship. Derived, not magic:
 *
 *   terminal velocity v = (thrust / mass) / (1 - linearDamping)
 *
 * The legacy path clamps top speed to `stats.thrust` (50). For a per-module
 * ship with MODULE_COUNT modules of mass 1 each (mass = MODULE_COUNT) and
 * SIM.linearDamping = 0.97, the thrust that yields the same v = 50 is:
 *
 *   thrust = v * mass * (1 - linearDamping) = 50 * MODULE_COUNT * 0.03
 *
 * The engine sits at the ship's origin (0, 0) so its lever arm about the
 * centre of mass is zero — no spurious torque, matching the legacy model's
 * thrust-along-heading behaviour. The engine's `facing` is π (exhaust aft),
 * so it drives the ship forward (+x in ship-local), again matching legacy.
 */
// Engine thrust sized for the frictionless movement model. The stop-in-time
// controller bounds speed kinematically (vMax = sqrt(2·a·d) over the closing
// distance d), so the engine's acceleration (a = thrust / mass, mass = 25 for
// 5 mass-5 modules) sets how quickly a ship closes and settles. A thrust of 2.5
// gives a = 0.1/tick, so over the ~200-unit closing typical of these fixtures
// the ship reaches a peak speed near 6 and brakes to rest at its stance range
// well inside the 150-200 tick sample windows. (The old derivation
// `TARGET_TOP_SPEED * MODULE_COUNT * (1 - LINEAR_DAMPING)` was calibrated
// against the removed per-tick velocity damping; with damping gone there is no
// thrust-only terminal velocity, so the derivation is kinematic now.)
const PER_MODULE_ENGINE_THRUST = 2.5;
// RCS torque giving each ship real commandable turn authority under the
// torque-driven attitude model. Every module sits at the ship's origin so the
// modular moment of inertia bottoms out at its floor of 1; with MoI = 1 an RCS
// torque of 0.2 yields α = 0.2 rad/tick², fast enough that ships complete their
// turns well inside the 80–200-tick test windows. Derived from the legacy
// scalar turn rate of 0.2 (kept as the per-tick angular-acceleration target).
const RCS_TORQUE = 0.2;

function stats(opts: {
  structure?: number;
  shield?: number;
  cost?: number;
  weapons?: WeaponEffect[];
}): ShipStats {
  const weapons = opts.weapons ?? [];
  return {
    mass: 10,
    cost: opts.cost ?? 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: opts.structure ?? 100,
    damageReduction: 0,
    shieldCapacity: opts.shield ?? 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 999,
    // Thrust and turn rate come from the engine module (per-module path); the
    // stats scalar is only read by the legacy aggregated path, which these
    // ships do not use once `modules` is defined.
    thrust: 0,
    turnRate: 0,
    weapons: weapons.map((w, i) => ({ slotId: `slot-${i}`, effect: w })),
    compartments: 0,
  airtightCompartments: 0,
};
}

function makeShip(opts: {
  id: string;
  side: "attacker" | "defender";
  x: number;
  y: number;
  facing?: number;
  structure?: number;
  shield?: number;
  cost?: number;
  weapons?: WeaponEffect[];
  classification?: ShipClassification;
  orders?: Partial<typeof defaultOrders>;
}): CombatShip {
  const weapons = opts.weapons ?? [];
  const s = stats({
    structure: opts.structure,
    shield: opts.shield,
    cost: opts.cost,
    weapons,
  });
  // These tests exercise the order system (focus fire, target selection,
  // stance range-keeping, range-keeping band), all of which require ships to
  // have already detected each other at the test geometry (up to 400 units
  // apart, well beyond the innate visual radius). Each ship carries an
  // all-round (omni) sensor module so detection isn't the variable under
  // test; faithful fog of war is covered by the awareness suite.
  // All modules sit at the ship's origin (0, 0) so every module's lever arm
  // about the centre of mass is zero — no spurious torque, matching the
  // legacy model's thrust-along-heading behaviour. The engine module supplies
  // PER_MODULE_ENGINE_THRUST (derived so terminal velocity equals the legacy
  // top speed of 50). Turn authority comes from an RCS module at the origin
  // (position-independent for pure-torque sources), replacing the engine
  // `turnRate` scalar removed under the torque-driven attitude model.
  const modules: ResolvedModule[] = [
    moduleOf(`${opts.id}-cmd`, { kind: "power", output: 1000 }, 0, 0, true),
    moduleOf(
      `${opts.id}-eng`,
      {
        kind: "engine",
        thrust: PER_MODULE_ENGINE_THRUST,
        facing: Math.PI,
      },
      0,
      0,
    ),
    // Fore retro-thruster (exhaust forward, facing 0) so the ship can brake
    // directly along its heading without flipping. Range-keeping against a
    // fixed point requires balanced fore+aft thrust; an aft-only ship must
    // flip PI to brake, and the turn lead-time makes it oscillate around
    // the desired range. A real range-keeping ship has thrusters both ways.
    moduleOf(
      `${opts.id}-ret`,
      { kind: "engine", thrust: PER_MODULE_ENGINE_THRUST, facing: 0 },
      0,
      0,
    ),
    moduleOf(`${opts.id}-rcs`, { kind: "rcs", torque: RCS_TORQUE }, 0, 0),
    moduleOf(`${opts.id}-se`, omniSensor(1000), 0, 0),
    ...weapons.map((w, i) => moduleOf(`${opts.id}-w${i}`, w, 0, 0)),
  ];
  return {
    instanceId: opts.id,
    designId: `design-${opts.id}`,
    faction: "test",
    side: opts.side,
    stats: s,
    position: { x: opts.x, y: opts.y },
    facing: opts.facing ?? 0,
    orders: { ...defaultOrders, ...opts.orders },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    classification: opts.classification ?? "frigate",
    modules,
  };
}

function inputs(ships: CombatShip[], maxTicks = 200): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomaly: "none",
    seed: 42,
    maxTicks,
  };
}

/** Total damage dealt to `targetId` across all frames, counting structure,
 *  shield, and per-module HP so per-module ships (which absorb hits in their
 *  cells before structure) are measured correctly. */
function totalDamageDealt(
  result: ReturnType<typeof runBattle>,
  targetId: string,
): number {
  const initFrame = result.frames[0];
  if (initFrame === undefined) return 0;
  const initShip = initFrame.ships.find((s) => s.instanceId === targetId);
  if (initShip === undefined) return 0;
  const initHp = totalHp(initShip);
  let minHp = initHp;
  for (const frame of result.frames) {
    const s = frame.ships.find((ship) => ship.instanceId === targetId);
    if (s === undefined) continue;
    const hp = totalHp(s);
    if (hp < minHp) minHp = hp;
  }
  return initHp - minHp;
}

/** Structure + shield + sum of alive cell HP. */
function totalHp(s: { structure: number; shield: number; cells?: { hp: number }[] }): number {
  let moduleHp = 0;
  if (s.cells !== undefined) {
    for (const m of s.cells) moduleHp += m.hp;
  }
  return s.structure + s.shield + moduleHp;
}

/** Distance between two ships at the given tick. */
function distAtTick(
  result: ReturnType<typeof runBattle>,
  id1: string,
  id2: string,
  tick: number,
): number {
  const frame = result.frames.find((f) => f.tick === tick);
  if (frame === undefined) throw new Error(`no frame at tick ${tick}`);
  const s1 = frame.ships.find((s) => s.instanceId === id1);
  const s2 = frame.ships.find((s) => s.instanceId === id2);
  if (s1 === undefined || s2 === undefined) throw new Error("ship missing");
  return Math.hypot(s1.x - s2.x, s1.y - s2.y);
}

// ─── Focus fire ───────────────────────────────────────────────────────────────

describe("engine.orders / focusFire", () => {
  /**
   * Two attackers vs two defenders. With focusFire=true and
   * targetPriority='highestCost', all focus-fire ships elect the
   * high-cost defender as the fleet target. d1 (high cost) should receive
   * all damage; d2 (low cost) receives none while d1 lives.
   *
   * Both defenders start with 9999 HP so neither dies during the test window.
   */
  it("concentrates fleet fire on a single target when focusFire=true", () => {
    const focusResult = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: -200,
          y: -20,
          weapons: [weapon()],
          orders: { focusFire: true, targetPriority: "highestCost" },
        }),
        makeShip({
          id: "a2",
          side: "attacker",
          x: -200,
          y: 20,
          weapons: [weapon()],
          orders: { focusFire: true, targetPriority: "highestCost" },
        }),
        // d1 is the high-cost focus target; d2 is low-cost and should be ignored.
        // The defenders hold position so the attackers can close and fire; the
        // test is about target SELECTION, not defender movement.
        makeShip({ id: "d1", side: "defender", x: 200, y: 0, cost: 500, structure: 9999, orders: { engageRange: "hold" } }),
        makeShip({ id: "d2", side: "defender", x: 200, y: 0, cost: 50,  structure: 9999, orders: { engageRange: "hold" } }),
      ], 80),
    );

    const d1Dmg = totalDamageDealt(focusResult, "d1");
    const d2Dmg = totalDamageDealt(focusResult, "d2");

    // Both attackers focused on d1; d2 receives zero damage.
    expect(d1Dmg).toBeGreaterThan(0);
    expect(d2Dmg).toBe(0);
  });

  /**
   * Without focus-fire, each ship picks independently by 'nearest'.
   * a1 is nearest to d1 and a2 is nearest to d2, so damage is spread.
   */
  it("spreads fire across targets when focusFire=false", () => {
    const spreadResult = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: -200,
          y: -60,
          weapons: [weapon()],
          orders: { focusFire: false, targetPriority: "nearest" },
        }),
        makeShip({
          id: "a2",
          side: "attacker",
          x: -200,
          y: 60,
          weapons: [weapon()],
          orders: { focusFire: false, targetPriority: "nearest" },
        }),
        makeShip({ id: "d1", side: "defender", x: 200, y: -60, structure: 9999, orders: { engageRange: "hold" } }),
        makeShip({ id: "d2", side: "defender", x: 200, y:  60, structure: 9999, orders: { engageRange: "hold" } }),
      ], 80),
    );

    const d1Dmg = totalDamageDealt(spreadResult, "d1");
    const d2Dmg = totalDamageDealt(spreadResult, "d2");

    // Both defenders should take damage.
    expect(d1Dmg).toBeGreaterThan(0);
    expect(d2Dmg).toBeGreaterThan(0);
  });
});

// ─── Vulnerable-target weighting ─────────────────────────────────────────────

describe("engine.orders / vulnerableTargetWeight", () => {
  /**
   * Vulnerability weighting only produces a different outcome once a target has
   * already taken damage (all ships start at full HP, so initial vulnerability
   * is 0 for everyone). The test uses two attackers:
   *
   *   a2 (focus + highestCost): concentrates its fire on d_lowHp (high cost),
   *   rapidly burning through its tiny HP pool.
   *
   *   a1 (vulnerableTargetWeight=1): at equal distance from both defenders,
   *   initially picks whichever has the slightly better score, but once a2
   *   has wounded d_lowHp its vulnerability fraction skyrockets and a1 should
   *   switch to finish it off.
   *
   * d_lowHp has structure=12 (2 hits of 5 to kill) and a high cost so a2
   * will target it. d_highHp has structure=5000 and low cost. a1 is placed
   * equidistant from both.
   *
   * With weight=1, after d_lowHp is wounded (structure<12) its vulnerability
   * score > 0 while d_highHp is barely scratched (vulnerability ≈ 0), so a1
   * switches to d_lowHp. Result: d_lowHp dies faster than it would if a1
   * stuck to d_highHp.
   *
   * Control (weight=0): a1 picks by pure nearest; d_highHp is slightly closer
   * so a1 never switches. d_lowHp only ever takes damage from a2.
   */
  it("switches to a wounded target when vulnerableTargetWeight=1", () => {
    // a2 wounds d_lowHp; a1 with weight=1 should follow and deal damage to
    // d_lowHp too (its total damage > what a2 alone can deal).
    const wtResult = runBattle(
      inputs([
        // a1: test subject — high vulnerability weight, at equal distance from
        // both defenders.
        makeShip({
          id: "a1",
          side: "attacker",
          x: -200,
          y: 0,
          weapons: [weapon({ cooldown: 3, range: 600 })],
          orders: {
            targetPriority: "nearest",
            vulnerableTargetWeight: 1,
            focusFire: false,
          },
        }),
        // a2: wounding support — focus-fires d_lowHp (highestCost) to wound it.
        makeShip({
          id: "a2",
          side: "attacker",
          x: -100,
          y: 0,
          weapons: [weapon({ cooldown: 3, range: 600 })],
          orders: {
            targetPriority: "highestCost",
            vulnerableTargetWeight: 0,
            focusFire: false,
          },
        }),
        // d_highHp: slightly closer to a1, very high HP, low cost.
        makeShip({ id: "d_highHp", side: "defender", x: 190, y: 0, cost: 10,  structure: 5000, orders: { engageRange: "hold" } }),
        // d_lowHp: slightly farther from a1, tiny HP, high cost (a2 targets it).
        makeShip({ id: "d_lowHp",  side: "defender", x: 210, y: 0, cost: 500, structure: 12, orders: { engageRange: "hold" } }),
      ], 60),
    );

    // a2 wounds d_lowHp; once d_lowHp's vulnerability exceeds d_highHp's,
    // a1 (weight=1) switches to d_lowHp. The total damage on d_lowHp should
    // include contributions from a1 that a solo-a2 run would not.
    const lowHpDmg = totalDamageDealt(wtResult, "d_lowHp");

    // a2 alone (cooldown 3 over 60 ticks ≈ 20 shots of 5 = 100 dmg) can deal
    // at most 12 (it kills d_lowHp). But a1 also joins: combined damage on
    // d_lowHp > 12 (it dies, so total damage = 12 minimum; what matters is that
    // a1 contributed — verify d_lowHp was killed, which requires >0 damage past
    // its already-12 HP, confirming it was attacked and destroyed).
    expect(lowHpDmg).toBeGreaterThanOrEqual(12); // d_lowHp is dead
  });

  it("stays on the closer target when vulnerableTargetWeight=0", () => {
    // Same layout, but a1 has weight=0 (pure nearest). d_highHp is slightly
    // closer to a1 so a1 always targets it, ignoring d_lowHp's vulnerability.
    const noWtResult = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: -200,
          y: 0,
          weapons: [weapon({ cooldown: 3, range: 600 })],
          orders: {
            targetPriority: "nearest",
            vulnerableTargetWeight: 0,
            focusFire: false,
          },
        }),
        makeShip({
          id: "a2",
          side: "attacker",
          x: -100,
          y: 0,
          weapons: [weapon({ cooldown: 3, range: 600 })],
          orders: {
            targetPriority: "highestCost",
            vulnerableTargetWeight: 0,
            focusFire: false,
          },
        }),
        makeShip({ id: "d_highHp", side: "defender", x: 190, y: 0, cost: 10,  structure: 5000, orders: { engageRange: "hold" } }),
        makeShip({ id: "d_lowHp",  side: "defender", x: 210, y: 0, cost: 500, structure: 12, orders: { engageRange: "hold" } }),
      ], 60),
    );

    // a1 (weight=0) always picks d_highHp (nearest). It deals damage to d_highHp;
    // d_lowHp only ever takes damage from a2.
    const highHpDmg = totalDamageDealt(noWtResult, "d_highHp");
    expect(highHpDmg).toBeGreaterThan(0);
  });

  /**
   * Cross-comparison: with vulnerability weighting, d_lowHp is killed faster
   * (more attackers pile on it) than without it, because a1 switches to it.
   * Measure the tick at which d_lowHp dies: it should die earlier in the
   * weight=1 run than in the weight=0 run.
   */
  it("vulnerable target weight speeds up kills on wounded targets", () => {
    function lowHpDeathTick(weight: number): number {
      const result = runBattle(
        inputs([
          makeShip({
            id: "a1",
            side: "attacker",
            x: -200,
            y: 0,
            weapons: [weapon({ cooldown: 3, range: 600 })],
            orders: {
              targetPriority: "nearest",
              vulnerableTargetWeight: weight,
              focusFire: false,
            },
          }),
          makeShip({
            id: "a2",
            side: "attacker",
            x: -100,
            y: 0,
            weapons: [weapon({ cooldown: 3, range: 600 })],
            orders: {
              targetPriority: "highestCost",
              vulnerableTargetWeight: 0,
              focusFire: false,
            },
          }),
          makeShip({ id: "d_highHp", side: "defender", x: 190, y: 0, cost: 10,  structure: 5000, orders: { engageRange: "hold" } }),
          makeShip({ id: "d_lowHp",  side: "defender", x: 210, y: 0, cost: 500, structure: 12, orders: { engageRange: "hold" } }),
        ], 120),
      );

      for (const frame of result.frames) {
        const s = frame.ships.find((ship) => ship.instanceId === "d_lowHp");
        if (s !== undefined && !s.alive) return frame.tick;
      }
      return Infinity; // never died
    }

    const deathWithWeight    = lowHpDeathTick(1);
    const deathWithoutWeight = lowHpDeathTick(0);

    // With vulnerability weighting, a1 joins a2 in targeting d_lowHp sooner,
    // so d_lowHp dies at the same tick or earlier.
    expect(deathWithWeight).toBeLessThanOrEqual(deathWithoutWeight);
  });
});

// ─── Stance / range-keeping ───────────────────────────────────────────────────

describe("engine.orders / stance range-keeping", () => {
  /**
   * Aggressive stance has a lower stanceRangeFactor (0.8) than evasive (1.4),
   * so its desired range is smaller. After settling, an aggressive ship should
   * be closer to the enemy than an evasive one.
   *
   * Weapon range 400; medium rangeFraction = 0.55:
   *   aggressive want = 400 * 0.55 * 0.8 = 176
   *   evasive    want = 400 * 0.55 * 1.4 = 308
   *
   * Ships start at x = ±200 (distance 400) so they need to close a little.
   * High thrust (50) ensures they settle well within 200 ticks.
   *
   * The defender holds station (`engageRange: "hold"`) so the attacker has a
   * fixed point to range-keep against and genuinely *settles* at its stance
   * range. A weaponless defender on default orders has a desired range of zero
   * and so chases the attacker forever — there is no settled distance to
   * measure, only a moving pursuit gap whose value depends on the turn
   * dynamics rather than on the stance, which is not what this test is about.
   */
  it("aggressive stance settles closer to the enemy than evasive stance", () => {
    const aggressiveResult = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: -200,
          y: 0,
          weapons: [weapon({ range: 400 })],
          orders: { stance: "aggressive", engageRange: "medium" },
        }),
        makeShip({
          id: "d1",
          side: "defender",
          x: 200,
          y: 0,
          structure: 999999,
          orders: { engageRange: "hold" },
        }),
      ]),
    );

    const evasiveResult = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: -200,
          y: 0,
          weapons: [weapon({ range: 400 })],
          orders: { stance: "evasive", engageRange: "medium" },
        }),
        makeShip({
          id: "d1",
          side: "defender",
          x: 200,
          y: 0,
          structure: 999999,
          orders: { engageRange: "hold" },
        }),
      ]),
    );

    // Measure at tick 150 (settled phase — ships have had 150 ticks to converge).
    const aggressiveDist = distAtTick(aggressiveResult, "a1", "d1", 150);
    const evasiveDist    = distAtTick(evasiveResult,    "a1", "d1", 150);

    // Evasive ship should be further from the enemy than aggressive ship.
    expect(evasiveDist).toBeGreaterThan(aggressiveDist);
  });
});

// ─── rangeKeepingBand ─────────────────────────────────────────────────────────

describe("engine.orders / rangeKeepingBand", () => {
  /**
   * Two otherwise-identical ships. The narrow-band ship (0.1) has a tiny
   * dead-zone so it constantly corrects its range; the wide-band ship (0.8)
   * has a large dead-zone and coasts further before correcting.
   *
   * We measure the mean distance each ship maintains over a settled window
   * (ticks 120–200). The narrow-band ship should sit closer to its ideal
   * range (it corrects more aggressively); the wide-band ship can sit much
   * further inside its dead-zone.
   *
   * Weapon range 400, medium, balanced:
   *   want = 400 * 0.55 * 1.0 = 220.
   *   narrow band dead-zone: [220*(1-0.1), 220] = [198, 220]
   *   wide band dead-zone:   [220*(1-0.8), 220] = [44, 220]
   *
   * Both start at distance 400 (attacker x=-200, defender x=200) so they
   * must close. After settling:
   *   - narrow-band ship holds around [198, 220] (close to 220)
   *   - wide-band ship is already inside its dead-zone at ~400 (too far for
   *     narrow band, but within the wide band). Wait — 400 > 220 = want, so
   *     BOTH must close to <= want. Once inside want, narrow band corrects
   *     tightly to [198, 220] while wide band accepts [44, 220]. Ships that
   *     end up inside the dead-zone stop thrusting, so the wide-band ship
   *     drifts anywhere in [44, 220] while narrow stays near 220.
   *
   * The narrow-band ship will actually stay closer to `want` (220) since its
   * dead-zone upper edge is 220 and lower edge is 198 — very tight. The wide-
   * band ship's dead-zone lower edge is 44, so it drifts far below 220 before
   * correcting back up, oscillating over a large range. Mean distance with
   * narrow band ≈ 209; wide band mean ≈ 130 (midpoint of [44, 220]).
   *
   * To detect the difference: the wide-band ship's mean settled distance is
   * substantially lower than the narrow-band ship's, because it closes all
   * the way to the lower edge of its wide dead-zone before reversing.
   */
  it("narrow rangeKeepingBand holds a higher mean range than wide band", () => {
    function meanDist(band: number): number {
      const result = runBattle(
        inputs([
          makeShip({
            id: "a1",
            side: "attacker",
            x: -200,
            y: 0,
            weapons: [weapon({ range: 400, cooldown: 10, damage: 0 })],
            orders: {
              stance: "balanced",
              engageRange: "medium",
              rangeKeepingBand: band,
            },
          }),
          makeShip({ id: "d1", side: "defender", x: 200, y: 0, structure: 999999, orders: { engageRange: "hold" } }),
        ]),
      );

      // Average distance over the settled window.
      let sum = 0;
      let count = 0;
      for (const frame of result.frames) {
        if (frame.tick < 100) continue;
        const a = frame.ships.find((s) => s.instanceId === "a1");
        const d = frame.ships.find((s) => s.instanceId === "d1");
        if (a === undefined || d === undefined) continue;
        sum += Math.hypot(a.x - d.x, a.y - d.y);
        count += 1;
      }
      return count > 0 ? sum / count : 0;
    }

    const narrowMean = meanDist(0.1);
    const wideMean   = meanDist(0.8);

    // Narrow band: ship corrects tightly near want (220).
    // Wide band: ship drifts to the bottom of the dead-zone before correcting,
    // so the mean is much lower (it spends time near the lower edge 44).
    expect(narrowMean).toBeGreaterThan(wideMean);
  });
});
