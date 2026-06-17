import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ModuleEffect, PointDefenseEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Point-defence weapons: a modular defender carrying an alive, powered,
 * online PD module intercepts incoming missiles and torpedoes before they
 * reach the hull. A defender with no PD module (or one whose PD module has
 * been destroyed / unpowered / cooled down) takes the hit normally.
 *
 * Per-tick per-module hit chance is 0.4 (SIM.pdHitChancePerModule); multiple
 * PD modules stack as 1 - (1 - p)^n, capped at 0.95. We pick numbers that
 * keep the test deterministic without brushing the cap.
 */

function missileLauncher(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "missile",
    damage: 50,
    range: 500,
    cooldown: 20,
    projectileSpeed: 8,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0.2,
    spread: 0,
    facing: 0,
    ...over,
  };
}

/** A modest PD module: short range, instant refire, moderate per-tick chance. */
function pdModule(over: Partial<PointDefenseEffect> = {}): PointDefenseEffect {
  return {
    kind: "pointDefense",
    damage: 10,
    range: 120,
    cooldown: 0,
    hitChance: 0.4,
    tracking: 0,
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
  powerDraw = 0,
  command = false,
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    repairRate: 0,
    x,
    y,
    maxHp,
    mass,
    powerDraw,
    effect,
    command,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: 0,
    weaponFacing: 0,
  };
}

/** A modular attacker with a single missile launcher + reactor (command). */
function modularAttacker(id: string): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf("w1", missileLauncher(), 12, 0, 50, 5, 8),
    moduleOf("p1", { kind: "power", output: 40 }, 0, -12, 20, 5, 0, true),
    moduleOf("e1", { kind: "engine", thrust: 0.4, turnRate: 0.05 }, 0, 12, 20, 5, 0),
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
    thrust: 0.9,
    turnRate: 0.15,
    weapons: [],
  };
  return {
    instanceId: id,
    designId: `d-${id}`,
    side: "attacker",
    stats,
    position: { x: 0, y: 0 },
    facing: 0,
    orders: { ...defaultOrders, engageRange: "hold" },
    classification: "frigate",
    modules,
  };
}

/** A modular defender with a single PD module + reactor (command). */
function modularDefender(id: string, withPd: boolean): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf("p1", { kind: "power", output: 40 }, 0, -12, 20, 5, 0, true),
    moduleOf("e1", { kind: "engine", thrust: 0.4, turnRate: 0.05 }, 0, 12, 20, 5, 0),
  ];
  if (withPd) {
    modules.push(moduleOf("pd1", pdModule(), 0, 0, 30, 4, 5));
  }
  const stats: ShipStats = {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    // Very high structure: if PD works, the defender should not be taking
    // any meaningful damage at all. The attacker can fire a steady stream of
    // missiles (cooldown 20 ticks, ~180 ticks of battle), so damage below
    // ~half the structure means PD intercepted most of them.
    structure: 9999,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    thrust: 0.9,
    turnRate: 0.15,
    weapons: [],
  };
  return {
    instanceId: id,
    designId: `d-${id}`,
    side: "defender",
    stats,
    position: { x: 80, y: 0 },
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

/** The defender's current structure in a frame. */
function structureOf(
  frame: { ships: { instanceId: string; structure: number }[] },
  id: string,
): number | undefined {
  return frame.ships.find((s) => s.instanceId === id)?.structure;
}

describe("engine.point-defense", () => {
  it("a defender with a point-defense module takes far less missile damage than one without", () => {
    const withPd = runBattle(inputs([modularAttacker("a1"), modularDefender("d1", true)]));
    const withoutPd = runBattle(inputs([modularAttacker("a2"), modularDefender("d2", false)]));

    const pdLast = withPd.frames.at(-1);
    const bareLast = withoutPd.frames.at(-1);
    if (pdLast === undefined || bareLast === undefined) throw new Error("no frames");
    const pdStruct = structureOf(pdLast, "d1") ?? 0;
    const bareStruct = structureOf(bareLast, "d2") ?? 0;

    // Sanity: the undefended defender took meaningful damage — otherwise
    // the comparison proves nothing.
    expect(bareStruct, "undefended defender should be taking missile hits").toBeLessThan(9999);
    // The PD defender should be visibly better off — at minimum, it should
    // not have lost MORE structure than the bare defender. With a 0.4
    // per-tick per-module chance and several ticks of missile flight
    // through PD range, the PD defender should take strictly less damage.
    expect(
      pdStruct,
      "PD-protected defender should take less damage than the undefended one",
    ).toBeGreaterThan(bareStruct);
  });

  it("missiles do not reach a defender covered by a point-defense module", () => {
    // Run a short battle with PD defence and inspect every frame's
    // projectile list. Every missile that survives to the defender's
    // position would have its kind reported by the snapshot. If PD is
    // doing its job, no projectile of any kind is observed flying toward
    // the defender at the position range where PD is active.
    const result = runBattle(inputs([modularAttacker("a1"), modularDefender("d1", true)]));
    // PD module sits at the defender (x=80). Its range is 120. A missile
    // aimed at x=80 spawned at x=6 (muzzle offset) crosses PD range while
    // travelling from x≈0 to x≈80. If any missile reaches within 80 ± 16
    // (frigate radius) of the defender, PD failed.
    const defenderX = 80;
    const hitRadius = 16;
    const survivedMissile = result.frames.find((f) =>
      f.projectiles.some(
        (p) => p.kind === "missile" && Math.abs(p.x - defenderX) <= hitRadius,
      ),
    );
    expect(
      survivedMissile,
      "no missile should reach the PD-defended defender",
    ).toBeUndefined();
  });

  it("PD intercepts on the first tick the projectile enters range", () => {
    // Spawn a missile that is already inside PD range by deploying the
    // attacker right next to the defender. The very first tick after the
    // attacker fires should see the projectile destroyed.
    const close = modularAttacker("a1");
    close.position = { x: 60, y: 0 }; // attacker at x=60, defender at x=80
    const defender = modularDefender("d1", true);
    const result = runBattle(inputs([close, defender]));
    // Within the first ~30 ticks (one missile + flight time), the defender
    // should not be taking damage — every projectile the attacker spawns
    // is in PD range from tick 1.
    const early = result.frames.slice(0, 30);
    const defenderId = defender.instanceId;
    const damagedEarly = early.some((f) => {
      const s = structureOf(f, defenderId) ?? 9999;
      return s < 9999;
    });
    expect(damagedEarly, "no missile should land while the defender has live PD").toBe(
      false,
    );
  });

  it("is deterministic when point defense is in play", () => {
    const mk = () => runBattle(inputs([modularAttacker("a1"), modularDefender("d1", true)]));
    const a = mk();
    const b = mk();
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });
});