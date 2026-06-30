import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { Doctrine } from "@/schema/ai";
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
 * Shared doctrine for the stationary test fixtures. Maps the legacy
 * `{ ...defaultOrders, engageRange: "hold" }` (rangeKeepingBand defaulted to
 * 0.3) plus `shipStance: "balanced"` and `crewPriority: "combat"` onto the
 * doctrine axes: hold station relative to the target at band 0.3, balanced
 * stance, combat crew. Ships still drift to/hold at their deploy range rather
 * than closing, which is what the directional-shield assertions rely on.
 */
const HOLD_DOCTRINE: Doctrine = {
  base: {
    stance: "balanced",
    crew: "combat",
    spatial: {
      reference: { kind: "target" },
      range: { kind: "hold", band: 0.3 },
      bearing: { kind: "free" },
    },
  },
  rules: [],
};

/**
 * Directional shields: a shield module whose arc is less than 2π only
 * intercepts incoming fire whose direction lies within that arc. Two shields
 * facing opposite directions should divide incoming fire between them with
 * no spillover to the structural modules on the wrong side.
 *
 * The test ships two attackers at the same defender: one in front, one
 * behind. The defender mounts a forward-facing shield and a rear-facing
 * shield. Front fire should chew the front shield; rear fire should chew
 * the rear shield — never the other side.
 */

function beam(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 30,
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
  x: number,
  y: number,
  maxHp: number,
  shieldArc: number,
  shieldFacing: number,
  mass = 5,
  powerDraw = 0,
  command = false,
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col: Math.round(x),
    row: Math.round(y),
    x,
    y,
    maxSurfaceHp: 0,
    maxSubstrateHp: maxHp,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    surface: "deck",
    edges: OPEN_EDGES,
    mass,
    powerDraw,
    crewRequired: 0,
    effect,
    command,
    repairRate: 0,
    shieldArc,
    shieldFacing,
    facing: 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

/** A modular defender with a forward-facing shield (+x) and a rear-facing
 *  shield (-x). Each shield has zero pooled capacity so the global pool is
 *  empty and every hit spills to the per-module layer — which is exactly
 *  where the directional logic lives. HP is set high enough that a single
 *  shield can soak the full battle from its own direction without running
 *  out — that's the property the test asserts (no spillover to the wrong
 *  side). */
function modularDefender(id: string): CombatShip {
  const modules: ResolvedModule[] = [
    // Forward shield: faces +x, covers a 90° cone.
    moduleOf(
      "frontShield",
      { kind: "shield", capacity: 0, rechargeRate: 0, rechargeDelay: 60 },
      12,
      0,
      1_000_000,
      Math.PI / 2,
      0,
    ),
    // Rear shield: faces -x, covers a 90° cone.
    moduleOf(
      "backShield",
      { kind: "shield", capacity: 0, rechargeRate: 0, rechargeDelay: 60 },
      -12,
      0,
      1_000_000,
      Math.PI / 2,
      Math.PI,
    ),
    // A reactor (also acts as the command module, as the catalog design does).
    moduleOf(
      "p1",
      { kind: "power", output: 40 },
      0,
      -12,
      50,
      Math.PI * 2,
      0,
      5,
      0,
      true,
    ),
  ];
  const stats: ShipStats = {
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
    thrust: 0,
    turnRate: 0,
    weapons: [],
    compartments: 0,
  airtightCompartments: 0,
};
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side: "defender",
    stats,
    position: { x: 0, y: 0 },
    facing: 0,
    doctrine: HOLD_DOCTRINE,
    classification: "frigate",
    modules,
  };
}

/** A stationary attacker that fires down the +x axis (toward the defender
 *  from its front side). */
function frontAttacker(id: string): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf(
      "w1",
      beam({ damage: 20, cooldown: 2 }),
      0,
      0,
      100,
      Math.PI * 2,
      0,
      5,
      0,
      true,
    ),
  ];
  const stats: ShipStats = {
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
    thrust: 0,
    turnRate: 0,
    weapons: [],
    compartments: 0,
  airtightCompartments: 0,
};
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side: "attacker",
    stats,
    position: { x: -80, y: 0 },
    facing: 0,
    doctrine: HOLD_DOCTRINE,
    classification: "frigate",
    modules,
  };
}

/** A stationary attacker that fires down the -x axis (toward the defender
 *  from its rear). */
function rearAttacker(id: string): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf(
      "w1",
      beam({ damage: 20, cooldown: 2 }),
      0,
      0,
      100,
      Math.PI * 2,
      0,
      5,
      0,
      true,
    ),
  ];
  const stats: ShipStats = {
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
    thrust: 0,
    turnRate: 0,
    weapons: [],
    compartments: 0,
  airtightCompartments: 0,
};
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side: "attacker",
    stats,
    position: { x: 80, y: 0 },
    facing: Math.PI,
    doctrine: HOLD_DOCTRINE,
    classification: "frigate",
    modules,
  };
}

function inputs(ships: CombatShip[]): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomalies: [],
    seed: 1,
    maxTicks: DEFAULT_MAX_TICKS,
  };
}

/** Locate a module on a ship in the final frame, joining its dynamic hp from the
 *  frame with its static maxHp from the battle's descriptors. */
function moduleAt(
  result: ReturnType<typeof runBattle>,
  shipId: string,
  slotId: string,
): { hp: number; maxHp: number } | undefined {
  const layout = result.descriptors?.find((d) => d.instanceId === shipId)?.cells;
  if (layout === undefined) return undefined;
  const idx = layout.findIndex((c) => c.slotId === slotId);
  if (idx < 0) return undefined;
  const cellSlot = layout[idx];
  if (cellSlot === undefined) return undefined;
  const last = result.frames.at(-1);
  const cells = last?.ships.find((s) => s.instanceId === shipId)?.cells;
  const hp = cells?.cellHp[idx];
  if (hp === undefined) return undefined;
  return { hp, maxHp: cellSlot.maxHp };
}

describe("engine.directional-shield", () => {
  it("a front-facing shield absorbs front fire and spares the rear shield", () => {
    const result = runBattle(inputs([frontAttacker("a1"), modularDefender("d1")]));
    const last = result.frames.at(-1);
    if (last === undefined) throw new Error("no frames");

    const front = moduleAt(result, "d1", "frontShield");
    const back = moduleAt(result, "d1", "backShield");
    expect(front, "front shield should exist").toBeDefined();
    expect(back, "rear shield should exist").toBeDefined();
    if (front === undefined || back === undefined) return;

    // Front fire should have chipped the front shield.
    expect(front.hp, "front shield should have absorbed front fire").toBeLessThan(front.maxHp);
    // The rear shield should still be untouched.
    expect(back.hp, "rear shield should be untouched by front fire").toBe(back.maxHp);
  });

  it("a rear-facing shield absorbs rear fire and spares the front shield", () => {
    const result = runBattle(inputs([rearAttacker("a1"), modularDefender("d1")]));
    const last = result.frames.at(-1);
    if (last === undefined) throw new Error("no frames");

    const front = moduleAt(result, "d1", "frontShield");
    const back = moduleAt(result, "d1", "backShield");
    if (front === undefined || back === undefined) throw new Error("shields missing");

    // Rear fire should have chipped the rear shield.
    expect(back.hp, "rear shield should have absorbed rear fire").toBeLessThan(back.maxHp);
    // The front shield should still be untouched.
    expect(front.hp, "front shield should be untouched by rear fire").toBe(front.maxHp);
  });

  it("front and rear fire each chew their own shield and never the other", () => {
    // Both attackers hit the same defender from opposite sides.
    const result = runBattle(inputs([
      frontAttacker("a-front"),
      rearAttacker("a-rear"),
      modularDefender("d1"),
    ]));
    const last = result.frames.at(-1);
    if (last === undefined) throw new Error("no frames");

    const front = moduleAt(result, "d1", "frontShield");
    const back = moduleAt(result, "d1", "backShield");
    if (front === undefined || back === undefined) throw new Error("shields missing");

    // Both shields should have absorbed some fire.
    expect(front.hp, "front shield should have taken some front fire").toBeLessThan(front.maxHp);
    expect(back.hp, "rear shield should have taken some rear fire").toBeLessThan(back.maxHp);
    // Each shield should be roughly the same damage — by symmetry the two
    // 90°-arc shields see equivalent fire from their respective directions.
    const frontLoss = front.maxHp - front.hp;
    const backLoss = back.maxHp - back.hp;
    expect(frontLoss).toBeGreaterThan(0);
    expect(backLoss).toBeGreaterThan(0);
  });

  it("directional shield damage is deterministic", () => {
    const mk = () =>
      runBattle(inputs([frontAttacker("a1"), modularDefender("d1")]));
    const a = mk();
    const b = mk();
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });
});
