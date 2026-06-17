import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Opus-tier keystone test: the per-module damage model. Each module on a ship
 * is an independently-destroyable part; the ship survives while its modules
 * die one by one, the snapshot carries per-module state, and the model stays
 * deterministic.
 */

function beam(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 30,
    range: 500,
    cooldown: 5,
    projectileSpeed: 0,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    ...over,
  };
}

function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  x: number,
  y: number,
  maxHp: number,
  mass = 5,
): ResolvedModule {
  return { slotId, moduleId: `mod-${slotId}`, kind: effect.kind, x, y, maxHp, mass, effect };
}

/** A legacy (non-modular) ship, used as the hammer that degrades a modular
 *  target without itself taking per-module damage. */
function hammerShip(id: string, x: number): CombatShip {
  const weapon = beam();
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
    thrust: 0.5,
    turnRate: 0.1,
    weapons: [{ slotId: "s", effect: weapon }],
  };
  return {
    instanceId: id,
    designId: `d-${id}`,
    side: "attacker",
    stats,
    position: { x, y: 0 },
    facing: 0,
    orders: { ...defaultOrders, engageRange: "hold" },
    classification: "frigate",
  };
}

/** A modular defender: a few low-HP modules on a tough hull. */
function modularDefender(id: string, x: number): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf("w1", beam({ damage: 1, range: 50 }), 12, 0, 20),
    moduleOf("s1", { kind: "shield", capacity: 0, rechargeRate: 0, rechargeDelay: 60 }, -12, 0, 20),
    moduleOf("e1", { kind: "engine", thrust: 0.4, turnRate: 0.05 }, 0, 12, 20),
    moduleOf("p1", { kind: "power", output: 40 }, 0, -12, 20),
  ];
  // stats.thrust includes the engine module's thrust; hullBaseThrust is
  // recovered as stats.thrust - sum(engine thrust).
  const stats: ShipStats = {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 2000,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    thrust: 0.9, // 0.5 hull base + 0.4 engine
    turnRate: 0.15,
    weapons: [],
  };
  return {
    instanceId: id,
    designId: `d-${id}`,
    side: "defender",
    stats,
    position: { x, y: 0 },
    facing: Math.PI,
    orders: { ...defaultOrders, engageRange: "hold" },
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
    maxTicks: DEFAULT_MAX_TICKS,
  };
}

describe("engine.per-module-damage", () => {
  it("modules are destroyed independently while the ship survives", () => {
    const result = runBattle(inputs([hammerShip("a1", 0), modularDefender("d1", 80)]));
    // Find a frame where the defender has a destroyed module but is still alive.
    const degrading = result.frames.find(
      (f) =>
        f.ships.find((s) => s.instanceId === "d1")?.alive === true &&
        (f.ships.find((s) => s.instanceId === "d1")?.modules ?? []).some((m) => !m.alive),
    );
    expect(degrading, "a module should be destroyed before the ship dies").toBeDefined();
    if (degrading === undefined) return;
    const defender = degrading.ships.find((s) => s.instanceId === "d1");
    expect(defender?.alive).toBe(true);
    expect(defender?.modules?.some((m) => !m.alive)).toBe(true);
  });

  it("the snapshot carries per-module hp and alive state", () => {
    const result = runBattle(inputs([hammerShip("a1", 0), modularDefender("d1", 80)]));
    const first = result.frames[0];
    if (first === undefined) throw new Error("no frames");
    const defender = first.ships.find((s) => s.instanceId === "d1");
    expect(defender?.modules).toBeDefined();
    expect(defender?.modules?.length).toBe(4);
    // At deployment every module is intact.
    expect(defender?.modules?.every((m) => m.alive && m.hp === m.hp)).toBe(true);
    expect(defender?.modules?.every((m) => m.hp > 0)).toBe(true);
  });

  it("is deterministic for modular ships", () => {
    const mk = () => runBattle(inputs([hammerShip("a1", 0), modularDefender("d1", 80)]));
    const a = mk();
    const b = mk();
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });

  it("eventually destroys the ship once modules and hull are depleted", () => {
    // A brutal hammer that chews through the modules then the hull.
    const result = runBattle(inputs([hammerShip("a1", 0), modularDefender("d1", 80)]));
    expect(result.winner).toBe("attacker");
    const last = result.frames.at(-1);
    const defender = last?.ships.find((s) => s.instanceId === "d1");
    expect(defender?.alive).toBe(false);
    // By death, all modules should be destroyed too.
    expect(defender?.modules?.every((m) => !m.alive)).toBe(true);
  });
});
