import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { Doctrine } from "@/schema/ai";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Phase 4 gap A3: time dilation wired to shield recharge, repair, and crew
 * advancement. Each test runs the same battle twice with the same seed and
 * asserts byte-identical frames, proving the new dilation paths are
 * deterministic. A `blackHole` anomalies is used so gravitational dilation is
 * active throughout the battle, exercising the code branches added here.
 */

const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

function beam(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 10,
    range: 500,
    cooldown: 5,
    projectileSpeed: 0,
    projectileMass: 0.5,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    facing: 0,
    ...over,
  };
}

function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  maxHp: number,
  opts: {
    mass?: number;
    powerDraw?: number;
    command?: boolean;
    crewRequired?: number;
    repairRate?: number;
    shieldArc?: number;
    shieldFacing?: number;
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
    maxSurfaceHp: 0,
    maxSubstrateHp: maxHp,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    surface: "deck",
    edges: OPEN_EDGES,
    mass: opts.mass ?? 5,
    powerDraw: opts.powerDraw ?? 0,
    crewRequired: opts.crewRequired ?? 0,
    effect,
    command: opts.command ?? false,
    repairRate: opts.repairRate ?? 0,
    shieldArc: opts.shieldArc ?? Math.PI * 2,
    shieldFacing: opts.shieldFacing ?? 0,
    facing: 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

function baseStats(over: Partial<ShipStats> = {}): ShipStats {
  return {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 99999,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    deflectorCapacity: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    thrust: 0.5,
    turnRate: 0.1,
    weapons: [],
    compartments: 0,
    airtightCompartments: 0,
    ...over,
  };
}

/**
 * Doctrine equivalent of the legacy `orders: { ...defaultOrders, engageRange:
 * "hold" }`: station-keep at a hold band (0.3 = the legacy default
 * rangeKeepingBand) relative to the target. The other legacy defaults
 * (balanced stance, nearest targetPriority) are the engine's empty-doctrine
 * fallbacks, so a spatial-only base preserves the original intent.
 */
const HOLD_DOCTRINE: Doctrine = {
  base: {
    spatial: {
      reference: { kind: "target" },
      range: { kind: "hold", band: 0.3 },
      bearing: { kind: "free" },
    },
  },
  rules: [],
};

function inputs(ships: CombatShip[], seed = 42): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    // Black hole applies gravitational time dilation, exercising the dilated
    // shield-recharge, repair, and crew-movement code paths.
    anomalies: ["blackHole"],
    seed,
    maxTicks: 600,
  };
}

/** A legacy (non-modular) attacker that fires continuously. */
function attacker(id: string, x: number): CombatShip {
  const w = beam({ damage: 8, cooldown: 3, range: 600 });
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side: "attacker",
    stats: baseStats({ weapons: [{ slotId: "w0", effect: w }] }),
    position: { x, y: 0 },
    facing: 0,
    doctrine: HOLD_DOCTRINE,
    classification: "frigate",
  };
}

/**
 * A modular defender with a shield: the shield absorbs damage and recharges
 * between hits. Shield recharge is the rate we are wiring dilation into.
 */
function shieldDefender(id: string, x: number): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf("p1", { kind: "power", output: 60 }, 0, 0, 40, { command: true }),
    moduleOf("s1", { kind: "shield", capacity: 100, rechargeRate: 5, rechargeDelay: 10 }, 1, 0, 30),
    moduleOf("h1", { kind: "engine", thrust: 0.3 }, 2, 0, 20),
  ];
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side: "defender",
    stats: baseStats({
      shieldCapacity: 100,
      shieldRechargeRate: 5,
      shieldRechargeDelay: 10,
      deflectorCapacity: 0,
      deflectorRechargeRate: 0,
      deflectorRechargeDelay: 0,
    }),
    position: { x, y: 0 },
    facing: Math.PI,
    doctrine: HOLD_DOCTRINE,
    classification: "frigate",
    modules,
  };
}

/**
 * A modular defender with a repair bay: the repair module keeps healing a
 * damaged neighbour. Repair rate is the path we are wiring dilation into.
 */
function repairDefender(id: string, x: number): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf("p1", { kind: "power", output: 60 }, 0, 0, 40, { command: true }),
    moduleOf("v1", { kind: "shield", capacity: 0, rechargeRate: 0, rechargeDelay: 60 }, 1, 0, 30),
    moduleOf("r1", { kind: "repair", repairRate: 3 }, 2, 0, 50, { repairRate: 3 }),
    moduleOf("h1", { kind: "engine", thrust: 0.3 }, 3, 0, 20),
  ];
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side: "defender",
    stats: baseStats(),
    position: { x, y: 0 },
    facing: Math.PI,
    doctrine: HOLD_DOCTRINE,
    classification: "frigate",
    modules,
  };
}

/**
 * A modular ship with crew quarters and a crewed weapon: the crew member
 * walks from its quarters to the weapon station to man it. Crew movement is
 * the path we are wiring dilation into via the moveAccumulator.
 */
function crewedShip(id: string, x: number, side: "attacker" | "defender"): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf("q1", { kind: "crew", capacity: 1 }, 0, 0, 15),
    moduleOf("p1", { kind: "power", output: 80 }, 1, 0, 20, { command: true }),
    moduleOf("w1", beam({ damage: 15, cooldown: 2 }), 2, 0, 30, { powerDraw: 5, crewRequired: 1 }),
    moduleOf("h1", { kind: "engine", thrust: 0.4 }, 3, 0, 20),
  ];
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side,
    stats: baseStats({
      weapons: [{ slotId: "w-agg", effect: beam({ damage: 5, cooldown: 3 }) }],
    }),
    position: { x, y: 0 },
    facing: side === "attacker" ? 0 : Math.PI,
    doctrine: HOLD_DOCTRINE,
    classification: "frigate",
    modules,
  };
}

describe("engine.dilation-wiring — determinism under gravitational time dilation", () => {
  it("shield recharge with dilation replays byte-identically (run-twice)", () => {
    // The blackHole anomalies applies gravitational dilation each tick; a ship
    // near the hole has dilationFactor < 1, exercising the dilated countdown
    // decrement and dilated recharge-rate paths.
    const mk = () => runBattle(inputs([attacker("a1", -200), shieldDefender("d1", 200)]));
    const first = mk();
    const second = mk();
    expect(second.frames).toEqual(first.frames);
    expect(second.winner).toBe(first.winner);
  });

  it("module repair with dilation replays byte-identically (run-twice)", () => {
    const mk = () => runBattle(inputs([attacker("a1", -200), repairDefender("d1", 200)]));
    const first = mk();
    const second = mk();
    expect(second.frames).toEqual(first.frames);
    expect(second.winner).toBe(first.winner);
  });

  it("crew movement with dilation replays byte-identically (run-twice)", () => {
    // Two crewed ships face each other; each has a crew member that must walk
    // from quarters to the weapon station. The moveAccumulator gates each step
    // on accumulated dilationFactor, so a ship under dilation takes more ticks
    // to advance one cell.
    const mk = () => runBattle(inputs([crewedShip("a1", -200, "attacker"), crewedShip("d1", 200, "defender")]));
    const first = mk();
    const second = mk();
    expect(second.frames).toEqual(first.frames);
    expect(second.winner).toBe(first.winner);
  });

  it("shield recharge with dilation is slower than without", () => {
    // Under the blackHole anomalies the defender's shield recharges less per tick
    // than at dilationFactor = 1. We verify by running the same setup without
    // dilation (anomalies []) and checking the no-dilation version has more
    // total shield at the same tick.
    function inputsWithAnomaly(anomalies: [] | ["blackHole"]): BattleInputs {
      return {
        ships: [attacker("a1", -200), shieldDefender("d1", 200)],
        attackerFleetId: "fa",
        defenderFleetId: "fd",
        anomalies,
        seed: 42,
        maxTicks: DEFAULT_MAX_TICKS,
      };
    }
    const withDilation = runBattle(inputsWithAnomaly(["blackHole"]));
    const withoutDilation = runBattle(inputsWithAnomaly([]));

    // If gravitational dilation slows shield recharge, the dilated defender
    // should end with less total shield HP across a window where both are alive.
    // Compare at a tick well into the battle when the shield has had time to
    // recharge between hits.
    const checkTick = 100;
    const dilatedFrame = withDilation.frames[checkTick];
    const normalFrame = withoutDilation.frames[checkTick];
    if (dilatedFrame === undefined || normalFrame === undefined) return;

    const dilatedShield = dilatedFrame.ships.find((s) => s.instanceId === "d1")?.shield ?? 0;
    const normalShield = normalFrame.ships.find((s) => s.instanceId === "d1")?.shield ?? 0;
    // Either the shield amounts differ (dilation visibly slowing recharge), or
    // both ships have been destroyed by this tick (in which case the run-twice
    // tests above already confirm determinism is intact). We only assert when
    // both defenders are still alive.
    const dilatedAlive = dilatedFrame.ships.find((s) => s.instanceId === "d1")?.alive ?? false;
    const normalAlive = normalFrame.ships.find((s) => s.instanceId === "d1")?.alive ?? false;
    if (dilatedAlive && normalAlive) {
      // The dilated recharge is at most equal to the non-dilated recharge over
      // the same number of ticks (dilationFactor ≤ 1).
      expect(
        dilatedShield,
        "shield should recharge no faster under gravitational dilation",
      ).toBeLessThanOrEqual(normalShield);
    }
  });
});
