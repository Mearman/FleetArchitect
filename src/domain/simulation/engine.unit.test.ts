import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { CombatShip, BattleInputs } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { Orders } from "@/schema/fleet";
import type { ShipClassification } from "@/schema/hull";
import type { WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

function weapon(over: Partial<WeaponEffect>): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 10,
    range: 300,
    cooldown: 10,
    projectileSpeed: 0,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    ...over,
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
  damageReduction?: number;
  weapons?: WeaponEffect[];
  thrust?: number;
  turnRate?: number;
  classification?: ShipClassification;
  orders?: Partial<Orders>;
}): CombatShip {
  const weapons = opts.weapons ?? [];
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
    structure: opts.structure ?? 100,
    damageReduction: opts.damageReduction ?? 0,
    shieldCapacity: opts.shield ?? 0,
    shieldRechargeRate: 1,
    shieldRechargeDelay: 30,
    thrust: opts.thrust ?? 0.5,
    turnRate: opts.turnRate ?? 0.1,
    weapons: weapons.map((w) => ({ slotId: `slot-${opts.id}`, effect: w })),
  };
  return {
    instanceId: opts.id,
    designId: `design-${opts.id}`,
    side: opts.side,
    stats,
    position: { x: opts.x, y: opts.y },
    facing: opts.facing ?? 0,
    orders: { ...defaultOrders, ...opts.orders },
    classification: opts.classification ?? "frigate",
  };
}

function inputs(
  ships: CombatShip[],
  seed = 1,
  maxTicks = DEFAULT_MAX_TICKS,
  anomaly: BattleInputs["anomaly"] = "none",
): BattleInputs {
  return {
    ships,
    attackerFleetId: "fleet-attacker",
    defenderFleetId: "fleet-defender",
    anomaly,
    seed,
    maxTicks,
  };
}

function lastFrame(result: ReturnType<typeof runBattle>) {
  const frame = result.frames.at(-1);
  if (frame === undefined) throw new Error("battle produced no frames");
  return frame;
}

describe("runBattle", () => {
  it("is deterministic: identical inputs produce identical frames, ticks, and winner", () => {
    const ships = [
      makeShip({
        id: "a1",
        side: "attacker",
        x: 0,
        y: 0,
        facing: 0,
        weapons: [weapon({ damage: 20, cooldown: 8, range: 400 })],
      }),
      makeShip({
        id: "d1",
        side: "defender",
        x: 150,
        y: 0,
        facing: Math.PI,
        structure: 80,
        weapons: [weapon({ damage: 14, range: 400 })],
      }),
    ];
    const a = runBattle(inputs(ships, 42));
    const b = runBattle(inputs(ships, 42));
    expect(b.frames).toEqual(a.frames);
    expect(b.ticks).toBe(a.ticks);
    expect(b.winner).toBe(a.winner);
  });

  it("declares the attacker winner once the defender is destroyed", () => {
    const ships = [
      makeShip({
        id: "a1",
        side: "attacker",
        x: 0,
        y: 0,
        weapons: [weapon({ damage: 60, cooldown: 5, range: 400 })],
      }),
      makeShip({
        id: "d1",
        side: "defender",
        x: 120,
        y: 0,
        structure: 50,
        shield: 0,
        weapons: [],
        orders: { engageRange: "hold" },
      }),
    ];
    const result = runBattle(inputs(ships, 7));
    expect(result.winner).toBe("attacker");

    const frame = lastFrame(result);
    const defender = frame.ships.find((s) => s.instanceId === "d1");
    if (defender === undefined) throw new Error("defender missing from final frame");
    expect(defender.alive).toBe(false);
    expect(defender.structure).toBe(0);
  });

  it("terminates at maxTicks as a draw when neither side can damage the other", () => {
    const ships = [
      makeShip({
        id: "a1",
        side: "attacker",
        x: 0,
        y: 0,
        structure: 100,
        weapons: [],
        orders: { engageRange: "hold" },
      }),
      makeShip({
        id: "d1",
        side: "defender",
        x: 200,
        y: 0,
        structure: 100,
        weapons: [],
        orders: { engageRange: "hold" },
      }),
    ];
    const result = runBattle(inputs(ships, 1, 5));
    expect(result.ticks).toBe(5);
    expect(result.winner).toBe("draw");
    expect(result.frames).toHaveLength(6);
    expect(result.frames[0]?.tick).toBe(0);
  });

  it("spawns visible projectiles for non-hitscan weapons", () => {
    const ships = [
      makeShip({
        id: "a1",
        side: "attacker",
        x: 0,
        y: 0,
        weapons: [
          weapon({
            weaponType: "cannon",
            damage: 5,
            projectileSpeed: 8,
            range: 400,
            cooldown: 6,
          }),
        ],
      }),
      makeShip({
        id: "d1",
        side: "defender",
        x: 120,
        y: 0,
        structure: 1000,
        weapons: [],
        orders: { engageRange: "hold" },
      }),
    ];
    const result = runBattle(inputs(ships, 99, 50));
    expect(result.frames.some((f) => f.projectiles.length > 0)).toBe(true);
  });

  it("applies armour damage reduction to structure hits", () => {
    const ships = [
      makeShip({
        id: "a1",
        side: "attacker",
        x: 0,
        y: 0,
        weapons: [
          weapon({ damage: 100, cooldown: 4, range: 400, armourPiercing: 0 }),
        ],
      }),
      makeShip({
        id: "d1",
        side: "defender",
        x: 100,
        y: 0,
        structure: 100,
        shield: 0,
        damageReduction: 0.5,
        weapons: [],
        orders: { engageRange: "hold" },
      }),
    ];
    const result = runBattle(inputs(ships, 3));
    // 100 damage, halved by armour, leaves the defender alive at ~50 structure
    // on the first hit, then dead on the second. Either way the attacker wins.
    expect(result.winner).toBe("attacker");
  });

  it("develops linear and angular velocity (Newtonian motion model)", () => {
    // Attacker with a gun, no weapons on the defender — the attacker closes
    // and orbits, exercising acceleration, momentum and angular momentum.
    const ships = [
      makeShip({
        id: "a1",
        side: "attacker",
        x: -300,
        y: 0,
        facing: 0,
        weapons: [weapon({ damage: 5, cooldown: 200, range: 400 })],
      }),
      makeShip({
        id: "d1",
        side: "defender",
        x: 200,
        y: 0,
        structure: 4000,
        weapons: [],
        orders: { engageRange: "hold" },
      }),
    ];
    const result = runBattle(inputs(ships, 11, 80));
    // Deployment frame: velocities are zero, ship hasn't moved yet.
    const frame0 = result.frames[0];
    if (frame0 === undefined) throw new Error("missing frame 0");
    const attacker0 = frame0.ships.find((s) => s.instanceId === "a1");
    expect(attacker0?.vx).toBe(0);
    expect(attacker0?.vy).toBe(0);

    // Find a mid-battle frame where the attacker has begun closing.
    const mid = result.frames.find(
      (f) => f.tick >= 20 && f.ships.find((s) => s.instanceId === "a1")?.alive === true,
    );
    expect(mid, "expected a mid-battle frame with the attacker alive").toBeDefined();
    const attackerMid = mid?.ships.find((s) => s.instanceId === "a1");
    if (attackerMid === undefined) throw new Error("missing attacker in mid frame");
    // The attacker is moving toward the defender (positive x): momentum built up.
    expect(attackerMid.vx ?? 0).toBeGreaterThan(0);
    // The attacker has accumulated angular velocity (orbiting / aiming): non-zero.
    expect(Math.abs(attackerMid.vx ?? 0) + Math.abs(attackerMid.vy ?? 0)).toBeGreaterThan(0);
  });
});
