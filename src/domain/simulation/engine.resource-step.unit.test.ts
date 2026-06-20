import { describe, expect, it } from "vitest";
import { makeResourceState, resourceStep } from "./engine/resource-step";
import type { SimModule, SimShip } from "./engine/types";
import type { ModuleEffect, PowerPlantEffect, EngineEffect } from "@/schema/module";
import { CABIN_TEMPERATURE_K, STANDARD_CELL_GAS_MASS_KG } from "./engine/lifesupport";
import { SPACE_TEMPERATURE_K } from "./engine/thermal";

/** A minimal engine effect for test modules. */
function engineEffect(thrust: number): EngineEffect {
  return { kind: "engine", thrust, gimbalArc: 0 };
}
function reactorEffect(output: number): PowerPlantEffect {
  return { kind: "power", output };
}

/** Build a SimModule at (col, row) with the given effect and deck surface. */
function moduleAt(col: number, row: number, effect: ModuleEffect, surface: "deck" | "armor" | "bare" = "deck"): SimModule {
  return {
    slotId: `cell-${col}-${row}`,
    moduleId: "m",
    kind: effect.kind,
    col,
    row,
    x: col,
    y: row,
    surface,
    edges: { n: "wall", e: col === 0 ? "wall" : "open", s: "wall", w: col === 1 ? "wall" : "open", doorStates: {} },
    surfaceHp: 100,
    maxSurfaceHp: 100,
    hp: 100,
    maxHp: 100,
    mass: 1,
    powerDraw: effect.kind === "power" ? 0 : 10,
    effect,
    cooldown: 0,
    ammo: 0,
    ammoStored: 0,
    charge: 100,
    alive: true,
    powered: true,
    manned: true,
    crewRequired: 0,
    command: false,
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    turretAngle: 0,
    channel: 0,
    commsBearing: 0,
    dishAngle: 0,
    sensorBearing: 0,
    techCooldown: 0,
    techActive: 0,
    reactiveCharge: 0,
    mineCooldown: 0,
    boardingCooldown: 0,
    exploded: false,
  };
}

/** Build a minimal two-cell modular ship (engine + reactor) for resource tests. */
function shipWith(over: Partial<SimShip> = {}): SimShip {
  const modules: SimModule[] = [
    moduleAt(0, 0, engineEffect(1000)),
    moduleAt(1, 0, reactorEffect(1_000_000)),
  ];
  return {
    instanceId: "s1",
    faction: "test",
    side: "attacker",
    classification: "frigate",
    x: 0,
    y: 0,
    facing: 0,
    velX: 0,
    velY: 0,
    angVel: 0,
    dilationFactor: 1,
    structure: 100,
    maxStructure: 100,
    shield: 0,
    maxShield: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 0,
    shieldRegenCountdown: 0,
    shieldAdaptiveRamp: 0,
    shieldUntouchedTicks: 0,
    auraRangeBonus: 0,
    auraAccuracyBonus: 0,
    armourReduction: 0,
    thrust: 1000,
    turnRate: 0,
    mass: 1000,
    comX: 0,
    comY: 0,
    momentOfInertia: 1,
    radius: 1,
    cost: 0,
    weapons: [],
    weaponCooldowns: [],
    orders: {
      stance: "balanced",
      targetPriority: "nearest",
      engageRange: "medium",
      retreatThreshold: 0,
      focusFire: false,
      vulnerableTargetWeight: 0,
      formationKeeping: 0,
      rangeKeepingBand: 0.3,
    },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    aiHoldFire: false,
    target: undefined,
    alive: true,
    ghosts: [],
    awareness: new Map(),
    lastFiredTick: Number.NEGATIVE_INFINITY,
    modules,
    crew: [],
    ...over,
  };
}

describe("engine.resource-step", () => {
  it("makeResourceState seeds thermal at cabin temperature", () => {
    const ship = shipWith();
    const state = makeResourceState(ship);
    expect(state).not.toBeUndefined();
    if (state === undefined) return;
    // Both cells start at cabin temperature.
    expect(state.thermal.every((t) => t === CABIN_TEMPERATURE_K)).toBe(true);
  });

  it("makeResourceState seeds deck-cell atmosphere at standard gas mass", () => {
    const ship = shipWith();
    const state = makeResourceState(ship);
    if (state === undefined) return;
    // Both modules are deck surface, so both carry standard gas mass.
    expect(state.atmosphere.every((m) => m === STANDARD_CELL_GAS_MASS_KG)).toBe(true);
  });

  it("makeResourceState seeds propellant at engine cells from the rocket equation", () => {
    const ship = shipWith();
    const state = makeResourceState(ship);
    if (state === undefined) return;
    // Engine is at cell index 0 (col 0, row 0). Reactor at index 1.
    expect(state.propellant[0]).toBeGreaterThan(0);
    expect(state.propellant[1]).toBe(0);
  });

  it("resourceStep advances thermal toward radiator equilibrium and stays finite", () => {
    const ship = shipWith();
    const state = makeResourceState(ship);
    if (state === undefined) return;
    ship.resource = state;
    const before = state.thermal[0];
    for (let i = 0; i < 100; i++) resourceStep(ship);
    const after = state.thermal[0];
    // A reactor shedding heat through radiators moves away from the initial
    // cabin temperature toward a higher equilibrium (it is being heated).
    expect(Number.isFinite(after)).toBe(true);
    expect(after).not.toBe(before);
    // Thermal never drops below space temperature physically.
    expect(state.thermal.every((t) => t >= SPACE_TEMPERATURE_K - 1e-6)).toBe(true);
  });

  it("resourceStep keeps propellant and atmosphere non-negative", () => {
    const ship = shipWith();
    const state = makeResourceState(ship);
    if (state === undefined) return;
    ship.resource = state;
    for (let i = 0; i < 50; i++) resourceStep(ship);
    expect(state.propellant.every((m) => m >= -1e-9)).toBe(true);
    expect(state.atmosphere.every((m) => m >= -1e-9)).toBe(true);
  });

  it("resourceStep clamps the power buffer to its capacity", () => {
    const ship = shipWith();
    const state = makeResourceState(ship);
    if (state === undefined) return;
    ship.resource = state;
    const capacity = state.powerBuffer.capacityJoules;
    for (let i = 0; i < 50; i++) resourceStep(ship);
    // Reactor output far exceeds module draw, so the buffer stays at capacity.
    expect(state.powerBuffer.energy).toBeLessThanOrEqual(capacity + 1e-6);
    expect(state.powerBuffer.energy).toBeGreaterThanOrEqual(0);
  });

  it("resourceStep is deterministic: two identical runs produce identical state", () => {
    const run = (): ResourceStateSnapshot => {
      const ship = shipWith();
      const state = makeResourceState(ship);
      if (state === undefined) throw new Error("no state");
      ship.resource = state;
      for (let i = 0; i < 20; i++) resourceStep(ship);
      return {
        thermal: [...state.thermal],
        propellant: [...state.propellant],
        atmosphere: [...state.atmosphere],
        energy: state.powerBuffer.energy,
      };
    };
    const a = run();
    const b = run();
    expect(b).toEqual(a);
  });
});

interface ResourceStateSnapshot {
  thermal: number[];
  propellant: number[];
  atmosphere: number[];
  energy: number;
}

