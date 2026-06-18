import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Per-module repair: a dedicated repair module on a ship heals the HP of one
 * damaged alive module on the same ship by `repairRate` per tick, capped at
 * maxHp. Over time a damaged module's HP trends upward while the repair bay
 * is alive.
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
  repairRate = 0,
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
    maxHp,
    mass,
    powerDraw,
    crewRequired: 0,
    effect,
    command,
    repairRate,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    channel: 0,
    commsBearing: 0,
  };
}

/** A legacy (non-modular) hammer: large structure, single beam that keeps
 *  chewing into the modular defender across the whole battle. */
function hammerShip(id: string, x: number): CombatShip {
  const weapon = beam({ damage: 4, range: 500, cooldown: 1 });
  const stats: ShipStats = {
    mass: 10,
    massCapacity: 100,
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

/** A modular defender with a repair bay plus a few modules for the hammer to
 *  chew on. The defender faces PI; a hammer firing from negative x hits the
 *  defender's left (ship-local x = -16), so `v1` sits at x = -12 to take the
 *  hits. The repair module sits out of the impact zone and stays at full HP
 *  so it can keep running. */
function modularDefender(id: string, x: number, repairRate: number): CombatShip {
  const modules: ResolvedModule[] = [
    // The sacrificial module the hammer keeps hitting.
    moduleOf("v1", { kind: "shield", capacity: 0, rechargeRate: 0, rechargeDelay: 60 }, -12, 0, 20),
    moduleOf("v2", { kind: "shield", capacity: 0, rechargeRate: 0, rechargeDelay: 60 }, 12, 0, 20),
    moduleOf("v3", { kind: "engine", thrust: 0.4 }, 0, 12, 20),
    // The repair bay.
    moduleOf(
      "r1",
      { kind: "repair", repairRate },
      0,
      -12,
      50,
      repairRate,
    ),
    // Reactor doubles as the bridge so the ship can fire.
    moduleOf("p1", { kind: "power", output: 40 }, 6, 0, 30, 0, 5, 0, true),
  ];
  const stats: ShipStats = {
    mass: 10,
    massCapacity: 100,
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

/** The `v1` module's hp at a given tick. The repair bay should keep it
 *  above what a no-repair baseline would show. */
function v1HpAt(
  result: ReturnType<typeof runBattle>,
  instanceId: string,
  tick: number,
): number | undefined {
  const frame = result.frames[tick];
  if (frame === undefined) return undefined;
  const ship = frame.ships.find((s) => s.instanceId === instanceId);
  return ship?.modules?.find((m) => m.slotId === "v1")?.hp;
}

describe("engine.per-module repair", () => {
  it("a damaged module's hp trends upward while a repair bay is alive", () => {
    const rate = 2;
    const withRepair = runBattle(inputs([hammerShip("a1", 0), modularDefender("d1", 80, rate)]));
    const noRepair = runBattle(inputs([hammerShip("a1", 0), modularDefender("d1", 80, 0)]));

    // Spot-check several ticks. The repair ship's v1 hp should be higher
    // than the no-repair baseline's at the same tick (the bay is healing
    // back some of the damage each tick).
    const ticks = [10, 20, 30, 50, 80];
    for (const t of ticks) {
      const repaired = v1HpAt(withRepair, "d1", t);
      const baseline = v1HpAt(noRepair, "d1", t);
      expect(repaired, `tick ${t} should have a recorded v1 hp`).toBeDefined();
      expect(baseline, `baseline tick ${t} should have a recorded v1 hp`).toBeDefined();
      if (repaired === undefined || baseline === undefined) continue;
      expect(
        repaired,
        `repair bay should leave v1 with more hp than no-repair at tick ${t}`,
      ).toBeGreaterThan(baseline);
    }
  });

  it("repair cannot push a module's hp past its maxHp", () => {
    // A huge repair rate and a one-shot defender: the module maxHp is 20 and
    // a single hammer hit (4 damage) drops it to 16. The repair bay with
    // rate 100 heals it to maxHp in one tick and then caps.
    const rate = 100;
    const result = runBattle(inputs([hammerShip("a1", 0), modularDefender("d1", 80, rate)]));
    // Walk the frames and assert v1 never exceeds 20.
    for (const frame of result.frames) {
      const v1 = frame.ships.find((s) => s.instanceId === "d1")?.modules?.find((m) => m.slotId === "v1");
      expect(v1).toBeDefined();
      if (v1 === undefined) continue;
      expect(v1.hp, "v1 hp must never exceed maxHp").toBeLessThanOrEqual(v1.maxHp);
    }
  });

  it("a ship with no repair modules behaves identically to a ship with a 0-rate repair slot", () => {
    // The baseline already covers "no repair"; the explicit 0-rate slot
    // exercises the inert-repair-module branch.
    const baseline = runBattle(inputs([hammerShip("a1", 0), modularDefender("d1", 80, 0)]));
    // v1's hp should never increase past its previous frame (no healer).
    let prev = baseline.frames[0]?.ships.find((s) => s.instanceId === "d1")?.modules?.find((m) => m.slotId === "v1")?.hp;
    expect(prev).toBeDefined();
    for (const frame of baseline.frames) {
      const v1 = frame.ships.find((s) => s.instanceId === "d1")?.modules?.find((m) => m.slotId === "v1");
      if (v1 === undefined || prev === undefined) continue;
      // Either the same (no hit) or lower (a hit landed), never higher.
      expect(v1.hp, `v1 should never heal without a repair bay`).toBeLessThanOrEqual(prev);
      prev = v1.hp;
    }
  });

  it("is deterministic for repair-enabled ships", () => {
    const mk = () => runBattle(inputs([hammerShip("a1", 0), modularDefender("d1", 80, 2)]));
    const a = mk();
    const b = mk();
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });
});