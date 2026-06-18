import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ModuleEffect, EngineEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Per-cell directional thrusters: each engine's `facing` (radians,
 * ship-local) determines which direction its thrust vector points, and its
 * (x, y) on the hull gives the lever arm for the torque calculation.
 *
 * Expected behaviours verified here:
 *   - A rear-mounted engine (`facing` ≈ π) thrusts the ship forward along
 *     its heading, just like the legacy scalar model.
 *   - A side-mounted engine (`facing` ≈ ±π/2) strafes the ship
 *     perpendicular to its facing.
 *   - Two opposing engines cancel linear thrust (zero net force) and
 *     produce no torque when symmetrically placed.
 *   - Unbalanced engines (one on each side, asymmetric positions) spin the
 *     ship — angVel becomes non-zero.
 *   - Non-hull modular ships without an explicit facing on their engine
 *     default to facing = 0 (forward), preserving legacy behaviour.
 *   - The model is deterministic — running the same battle twice yields
 *     identical frames.
 */

/** Build an engine effect with a given ship-local facing (radians). */
function engine(thrust: number, facing: number): EngineEffect {
  return { kind: "engine", thrust, turnRate: 0, facing };
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
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: effect.kind === "engine" ? effect.facing ?? 0 : 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
  };
}

/** A simple modular ship factory. Modules are added directly so each test
 *  can choose its engine placement and facings. The ship is a frigate
 *  with enough mass that acceleration is small and easy to read in frames. */
function modularShip(
  id: string,
  side: "attacker" | "defender",
  modules: ResolvedModule[],
  position: { x: number; y: number },
  facing: number,
  orders = defaultOrders,
): CombatShip {
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
    thrust: modules
      .filter((m) => m.effect.kind === "engine")
      .reduce((s, m) => s + (m.effect.kind === "engine" ? m.effect.thrust : 0), 0),
    turnRate: 0,
    weapons: [],
  };
  return {
    instanceId: id,
    designId: `d-${id}`,
    side,
    stats,
    position,
    facing,
    orders,
    classification: "frigate",
    modules,
  };
}

/** A stationary target at a given position — used to give modular ships
 *  something to chase so the per-tick movement loop actually runs. The
 *  target is held in place by giving it zero thrust and `hold` orders. */
function dummy(id: string, x: number, y = 0): CombatShip {
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
    structure: 1_000_000,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    thrust: 0,
    turnRate: 0,
    weapons: [],
  };
  return {
    instanceId: id,
    designId: `d-${id}`,
    side: "defender",
    stats,
    position: { x, y },
    facing: 0,
    orders: { ...defaultOrders, engageRange: "hold" },
    classification: "frigate",
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

/** Linear velocity of the named ship in the given frame. */
function velOf(
  frame: { ships: { instanceId: string; vx?: number; vy?: number }[] },
  id: string,
): { vx: number; vy: number } {
  const s = frame.ships.find((x) => x.instanceId === id);
  if (s === undefined) throw new Error(`no ship ${id}`);
  return { vx: s.vx ?? 0, vy: s.vy ?? 0 };
}

/** Angular velocity of the named ship in the given frame. */
function angVelOf(
  frame: { ships: { instanceId: string; facing?: number }[] },
  id: string,
  tick: number,
): number {
  // Snapshot frames don't carry angVel directly; reconstruct from facing
  // differences across consecutive frames.
  void frame;
  void id;
  void tick;
  return 0;
}

describe("engine.cellthrust", () => {
  it("a forward-thrusting engine (facing 0) accelerates the ship along its heading", () => {
    // Ship faces +x (facing = 0). Engine anywhere with `facing` = 0
    // produces a force vector along +x in ship-local; rotated by
    // ship.facing = 0, the world force is also +x, so the ship accelerates
    // toward +x. This is the legacy default and the Cosmoteer "rear-
    // mounted" engine (the nozzle points backward, the ship is pushed
    // forward).
    const modules: ResolvedModule[] = [
      moduleOf("c1", { kind: "power", output: 40 }, 0, 0, 100, 5, 0, true),
      moduleOf("e1", engine(1.0, 0), -10, 0, 100),
    ];
    const ship = modularShip("s1", "attacker", modules, { x: 0, y: 0 }, 0);
    const result = runBattle(inputs([ship, dummy("d1", 200)]));
    // After 50 ticks the ship should have positive vx (moving toward +x).
    const mid = result.frames[50];
    if (mid === undefined) throw new Error("no frame at tick 50");
    const v = velOf(mid, "s1");
    expect(v.vx, "facing=0 engine should accelerate ship along +x").toBeGreaterThan(0);
    // No sideways thrust → no perpendicular velocity component.
    expect(Math.abs(v.vy), "no sideways thrust expected").toBeLessThan(Math.abs(v.vx));
  });

  it("a side-thrusting engine (facing π/2) strafes the ship perpendicular to facing", () => {
    // Ship faces +x. Engine on the right (x = +10) with facing = π/2
    // produces a force vector along +y in ship-local → world +y after
    // facing = 0. So the ship strafes upward.
    const modules: ResolvedModule[] = [
      moduleOf("c1", { kind: "power", output: 40 }, 0, 0, 100, 5, 0, true),
      moduleOf("e1", engine(1.0, Math.PI / 2), 10, 0, 100),
    ];
    const ship = modularShip("s1", "attacker", modules, { x: 0, y: 0 }, 0);
    const result = runBattle(inputs([ship, dummy("d1", 200, 0)]));
    const mid = result.frames[50];
    if (mid === undefined) throw new Error("no frame at tick 50");
    const v = velOf(mid, "s1");
    // Side thrust produces perpendicular velocity; longitudinal velocity
    // is small or zero (engine not pointing along facing).
    expect(Math.abs(v.vy), "side engine should produce a vy component").toBeGreaterThan(
      Math.abs(v.vx) / 2,
    );
  });

  it("two opposing engines cancel linear thrust and produce no torque when symmetric", () => {
    // Two engines on the centreline (y = 0): one with facing 0 (pushes
    // toward +x), one with facing π (pushes toward -x). Net force is
    // zero; both engines sit on the centreline so they produce no
    // perpendicular lever arm and therefore no torque either.
    const modules: ResolvedModule[] = [
      moduleOf("c1", { kind: "power", output: 40 }, 0, 0, 100, 5, 0, true),
      moduleOf("eF", engine(1.0, 0), 10, 0, 100),
      moduleOf("eB", engine(1.0, Math.PI), -10, 0, 100),
    ];
    const ship = modularShip("s1", "attacker", modules, { x: 0, y: 0 }, 0);
    const result = runBattle(inputs([ship, dummy("d1", 200)]));
    const mid = result.frames[50];
    if (mid === undefined) throw new Error("no frame at tick 50");
    const v = velOf(mid, "s1");
    // Net force is zero → velocity should stay near zero.
    expect(Math.abs(v.vx), "opposing engines should cancel longitudinal thrust").toBeLessThan(0.05);
    expect(Math.abs(v.vy), "opposing centreline engines should not strafe").toBeLessThan(0.05);
    // Also check facing hasn't drifted (no torque either).
    const initial = result.frames[0];
    if (initial === undefined) throw new Error("no frame 0");
    const f0 = initial.ships.find((s) => s.instanceId === "s1");
    const fN = mid.ships.find((s) => s.instanceId === "s1");
    if (f0 === undefined || fN === undefined) throw new Error("ship missing");
    expect(
      Math.abs((fN.facing ?? 0) - (f0.facing ?? 0)),
      "no torque → no rotation",
    ).toBeLessThan(0.05);
  });

  it("unbalanced side engines spin the ship (facing drifts over time)", () => {
    // Two engines on opposite sides of the centreline, equal thrust
    // magnitude but different lever arms along x. The forces are equal
    // and opposite (cancel linear) but the perpendicular lever arms
    // are different → non-zero torque.
    //
    // Engine on left (x = -5, y = +5) facing -π/2 → force along -y in
    // world; lever arm y=+5 gives τ = (-5)(-F) - (5)(0) = +5F
    // (counter-clockwise spin).
    //
    // Engine on right (x = +10, y = -5) facing +π/2 → force along +y in
    // world; lever arm y=-5 gives τ = (+10)(+F) - (-5)(0) = +10F.
    //
    // Both contribute positive (counter-clockwise) torque → facing
    // drifts positive over time.
    const modules: ResolvedModule[] = [
      moduleOf("c1", { kind: "power", output: 40 }, 0, 0, 100, 5, 0, true),
      moduleOf("eL", engine(1.0, -Math.PI / 2), -5, 5, 100),
      moduleOf("eR", engine(1.0, Math.PI / 2), 10, -5, 100),
    ];
    const ship = modularShip("s1", "attacker", modules, { x: 0, y: 0 }, 0);
    const result = runBattle(inputs([ship, dummy("d1", 200)]));
    // Reconstruct angular drift from consecutive facing values.
    const a = result.frames[10]?.ships.find((s) => s.instanceId === "s1");
    const b = result.frames[20]?.ships.find((s) => s.instanceId === "s1");
    if (a === undefined || b === undefined) throw new Error("missing frames");
    const deltaFacing = normaliseDiff((b.facing ?? 0) - (a.facing ?? 0));
    expect(Math.abs(deltaFacing), "unbalanced engines should spin the ship").toBeGreaterThan(0);
    void angVelOf; // silence unused warning
  });

  it("non-hull modular ships default engine facing to 0 when omitted", () => {
    // Engine declared without an explicit `facing` should default to 0
    // (forward), giving the same thrust behaviour as the legacy scalar
    // model: the ship accelerates along its heading.
    const modules: ResolvedModule[] = [
      moduleOf("c1", { kind: "power", output: 40 }, 0, 0, 100, 5, 0, true),
      moduleOf(
        "e1",
        { kind: "engine", thrust: 1.0, turnRate: 0 }, // no facing field
        -10,
        0,
        100,
      ),
    ];
    const ship = modularShip("s1", "attacker", modules, { x: 0, y: 0 }, 0);
    const result = runBattle(inputs([ship, dummy("d1", 200)]));
    const mid = result.frames[50];
    if (mid === undefined) throw new Error("no frame at tick 50");
    const v = velOf(mid, "s1");
    expect(v.vx, "default-facing engine (forward) thrusts along +x").toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const modules: ResolvedModule[] = [
      moduleOf("c1", { kind: "power", output: 40 }, 0, 0, 100, 5, 0, true),
      moduleOf("eL", engine(1.0, -Math.PI / 2), -5, 5, 100),
      moduleOf("eR", engine(1.0, Math.PI / 2), 10, -5, 100),
    ];
    const mk = () =>
      runBattle(inputs([
        modularShip("s1", "attacker", modules, { x: 0, y: 0 }, 0),
        dummy("d1", 200),
      ]));
    const a = mk();
    const b = mk();
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });
});

/** Smallest signed difference between two angles, wrapped to (-π, π]. */
function normaliseDiff(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}
