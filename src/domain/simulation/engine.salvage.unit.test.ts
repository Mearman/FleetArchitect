import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Salvage mechanics: deterministic debris collection and hull claiming.
 *
 * Scenario under test: a heavily-armed attacker and a lightly-built defender
 * deployed ~40 m apart — already inside the 50 m salvage range. The attacker's
 * beam overwhelms the defender's weapon and engine cells in the opening ticks
 * while its high-HP command cell survives, so the defender becomes a derelict —
 * every weapon and drive disabled, no crew aboard, command intact — and the
 * attacker, sitting within salvage range, claims the hull. The claimed hull then
 * drifts inert.
 *
 * Both ships hold station (`engageRange: "hold"`), so positions stay fixed and
 * the attacker is in claim range from tick 1. No crew-quarters cells means
 * neither ship has crew, so the "no remaining crew" claim precondition holds for
 * the defender the moment its weapon and engine die.
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
    damage: 30,
    range: 500,
    cooldown: 1,
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
  x: number,
  y: number,
  maxHp: number,
  command = false,
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    x,
    y,
    maxSurfaceHp: 0,
    maxSubstrateHp: maxHp,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    surface: "deck",
    edges: OPEN_EDGES,
    mass: 5,
    powerDraw: 0,
    crewRequired: 0,
    effect,
    command,
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
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
    structure: 5000,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    thrust: 0,
    turnRate: 0,
    weapons: [],
    compartments: 0,
    airtightCompartments: 0,
    ...over,
  };
}

/** A heavily-armed attacker: a single high-damage beam, deployed close to the
 *  defender so it both overwhelms it quickly and sits inside salvage range. */
function attackerShip(id: string, x: number): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf("aCmd", { kind: "hull" }, 0, 0, 0, 0, 1_000_000, true),
    moduleOf("aGun", beam({ damage: 5000, range: 500, cooldown: 1 }), 0, 1, 0, 1, 1_000_000),
  ];
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "test",
    side: "attacker",
    stats: baseStats({ weapons: [] }),
    position: { x, y: 0 },
    facing: 0,
    orders: { ...defaultOrders, engageRange: "hold" },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    classification: "frigate",
    modules,
  };
}

/**
 * A lightly-built defender: a high-HP command cell that survives the battle, a
 * low-HP weapon cell, and a low-HP engine cell. The attacker's beam destroys the
 * weapon and engine in the opening ticks, leaving an intact command — so the
 * hull is disarmed and immobilised but still tracked (not killed outright), the
 * exact derelict state hull-claiming acts on. No crew-quarters cell, so the
 * defender has no crew.
 */
function defenderShip(id: string, x: number): CombatShip {
  // A connected vertical column (col 0, rows 0-2), defender unrotated (facing 0).
  // A hand-built fixture carries no chamfered outline, so a hitscan beam fired
  // along +x at y = 0 falls back to the bounding-circle edge near ship-local
  // (radius, 0) — closest to the row-0 cell. The low-HP weapon (row 0) sits there
  // and is destroyed first; one overwhelming hit kills it and spills its remainder
  // into the next-nearest cell, the low-HP engine (row 1), destroying that too;
  // the residual then spills into the high-HP command cell furthest from the
  // impact (row 2), which survives. The result is a disarmed, immobilised, still-
  // tracked hull — the exact derelict state a salvager claims. The column stays
  // 4-connected throughout (the command cell at row 2 keeps the graph whole).
  const modules: ResolvedModule[] = [
    moduleOf("dGun", beam({ damage: 1, range: 50, cooldown: 1 }), 0, 0, 0, 0, 10),
    moduleOf("dEng", { kind: "engine", thrust: 100 }, 0, 1, 0, 1, 10),
    moduleOf("dCmd", { kind: "hull" }, 0, 2, 0, 2, 1_000_000, true),
  ];
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "test",
    side: "defender",
    stats: baseStats({ thrust: 100 }),
    position: { x, y: 0 },
    facing: 0,
    orders: { ...defaultOrders, engageRange: "hold" },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    classification: "frigate",
    modules,
  };
}

function inputs(ships: CombatShip[]): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomaly: "none",
    seed: 1,
    // A short cap: the defender's command survives, so the battle never
    // terminates by side-death — bound it so the test runs fast. The claim
    // happens within the first handful of ticks.
    maxTicks: 120,
  };
}

/** Deploy attacker at the origin, defender 40 m away — inside the 50 m salvage
 *  range, so the attacker can claim the disarmed hull without moving. */
function scenario(): BattleInputs {
  return inputs([attackerShip("att", 0), defenderShip("def", 40)]);
}

/**
 * A fully fragile defender: the same column, but the command cell is low-HP too,
 * so the attacker's beam destroys the whole hull. A destroyed hull spawns a
 * drifting debris fragment, which the attacker — sitting within salvage range —
 * sweeps up, so its `salvageMass` ends positive. Exercises the debris-collection
 * path (the claiming path is exercised by `defenderShip` above).
 */
function fragileDefenderShip(id: string, x: number): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf("dGun", beam({ damage: 1, range: 50, cooldown: 1 }), 0, 0, 0, 0, 10),
    moduleOf("dEng", { kind: "engine", thrust: 100 }, 0, 1, 0, 1, 10),
    moduleOf("dCmd", { kind: "hull" }, 0, 2, 0, 2, 10, true),
  ];
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "test",
    side: "defender",
    stats: baseStats({ thrust: 100 }),
    position: { x, y: 0 },
    facing: 0,
    orders: { ...defaultOrders, engageRange: "hold" },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    classification: "frigate",
    modules,
  };
}

/**
 * Deploy the attacker beside two fully fragile defenders. The attacker destroys
 * one (spawning a drifting fragment), and because the other defender is still
 * alive the battle does not terminate — so on a later tick the attacker, still
 * within salvage range of the wreckage, sweeps it up. A single defender would let
 * the battle end the instant it died, before any collection tick runs.
 */
function debrisScenario(): BattleInputs {
  return inputs([
    attackerShip("att", 0),
    fragileDefenderShip("def1", 40),
    fragileDefenderShip("def2", 45),
  ]);
}

describe("engine.salvage", () => {
  it("claims a disarmed, decrewed enemy hull within salvage range", () => {
    const result = runBattle(scenario());

    expect(result.salvage, "a salvage summary should be produced").toBeDefined();
    const entry = result.salvage?.find((s) => s.shipId === "att");
    expect(entry, "the attacker should have a salvage entry").toBeDefined();
    expect(entry?.claimedHulls).toContain("def");
  });

  it("the claimed hull stops thrusting and drifts inert", () => {
    const result = runBattle(scenario());
    // The defender has an engine but holds station; once claimed it must not
    // suddenly start moving. Its position stays fixed across every frame.
    const defXs = new Set(
      result.frames
        .map((f) => f.ships.find((s) => s.instanceId === "def")?.x)
        .filter((x): x is number => x !== undefined),
    );
    expect(defXs.size, "a claimed (and held) hull should not move").toBe(1);
  });

  it("collects drifting debris from a destroyed enemy within salvage range", () => {
    const result = runBattle(debrisScenario());
    const entry = result.salvage?.find((s) => s.shipId === "att");
    expect(entry, "the attacker should have collected salvage").toBeDefined();
    expect(entry?.salvageMass).toBeGreaterThan(0);
  });

  it("is deterministic (two same-seed runs are byte-identical, claim included)", () => {
    const a = runBattle(scenario());
    const b = runBattle(scenario());
    // Byte-identical frames and identical salvage summary across runs.
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
    expect(b.salvage).toEqual(a.salvage);
    // Sanity: the claim genuinely happened in the deterministic run.
    expect(a.salvage?.find((s) => s.shipId === "att")?.claimedHulls).toContain("def");
  });

  it("debris collection is deterministic (two same-seed runs byte-identical)", () => {
    const a = runBattle(debrisScenario());
    const b = runBattle(debrisScenario());
    expect(b.frames).toEqual(a.frames);
    expect(b.salvage).toEqual(a.salvage);
    expect(a.salvage?.find((s) => s.shipId === "att")?.salvageMass).toBeGreaterThan(0);
  });
});
