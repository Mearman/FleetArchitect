import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { toSimShip } from "@/domain/simulation/engine/setup";
import { availableThrust, shipForceAndTorque } from "@/domain/simulation/engine/physics";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ModuleEffect, EngineEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";


const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

/**
 * Per-cell directional thrusters: each engine's `facing` (radians, ship-local)
 * is its EXHAUST direction — where the nozzle/flame points. By Newton's third
 * law the thrust on the ship is opposite the exhaust, so a force vector of
 * `-(cos facing, sin facing) · thrust`. Its (x, y) on the hull gives the lever
 * arm for the torque calculation.
 *
 * These tests assert on the force/torque PRIMITIVE directly — `shipForceAndTorque`
 * with `thrustMode: "all"` and `availableThrust` — rather than observing a ship
 * chase a target through `runBattle`. Under frictionless movement, engine firing
 * is controller-mediated: the translation controller fires only the engines whose
 * local force serves the commanded prograde/retrograde axis, so a side-only or
 * forward-exhaust engine never fires when the ship is simply closing on a target.
 * Routing these geometric assertions through a battle would therefore test the
 * firing policy, not the force math. Building a SimShip and calling the primitive
 * directly isolates the per-cell force/torque computation, which is what each test
 * here is actually about.
 *
 * Expected behaviours verified here:
 *   - A rear-mounted engine (exhaust aft, `facing` ≈ π) drives the ship
 *     forward (+x) along its heading, just like the legacy scalar model.
 *   - An engine whose exhaust points forward (`facing` = 0) pushes the ship
 *     backward (−x) — a reverse/braking thruster.
 *   - A side-mounted engine (exhaust ≈ ±π/2) strafes the ship opposite its
 *     exhaust direction.
 *   - Two opposing engines cancel linear thrust (zero net force) and
 *     produce no torque when symmetrically placed.
 *   - Unbalanced engines (one on each side, asymmetric positions) spin the
 *     ship — net torque is non-zero.
 *   - Non-hull modular ships without an explicit facing default to facing = 0
 *     (exhaust forward), so the un-faced engine pushes the ship backward.
 *   - The model is deterministic — running the same battle twice yields
 *     identical frames.
 */

/** Build an engine effect with a given ship-local facing (radians). */
function engine(thrust: number, facing: number): EngineEffect {
  return { kind: "engine", thrust, facing };
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
    maxSurfaceHp: 0,
    maxScaffoldHp: maxHp,
    surface: "deck",
    edges: OPEN_EDGES,
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
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
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
    compartments: 0,
  airtightCompartments: 0,
};
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "test",
    side,
    stats,
    position,
    facing,
    orders,
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
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
    compartments: 0,
  airtightCompartments: 0,
};
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "test",
    side: "defender",
    stats,
    position: { x, y },
    facing: 0,
    orders: { ...defaultOrders, engageRange: "hold" },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
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

/**
 * Build a SimShip (with mass, CoM, and MoI derived by recomputeAggregates) from
 * a module set, so the force/torque primitive can be exercised directly. The rng
 * is unused for these crewless, weaponless fixtures (it only staggers weapon
 * cooldowns), so a constant 0 is fine and keeps the build deterministic.
 */
function simShipOf(modules: ResolvedModule[], facing = 0) {
  return toSimShip(modularShip("s1", "attacker", modules, { x: 0, y: 0 }, facing), () => 0);
}

describe("engine.cellthrust", () => {
  it("a rear-mounted engine (exhaust aft, facing π) produces net local force +x", () => {
    // A rear engine's exhaust points aft (facing = π); by Newton's third law
    // the thrust on the ship is opposite the exhaust → +x in ship-local. This
    // is the Cosmoteer "rear-mounted" engine and how every real design mounts
    // its drives. Asserted on the primitive directly because in battle the
    // controller fires this engine only when the commanded thrust axis is
    // prograde — here we test the force math itself, with `thrustMode: "all"`.
    const ship = simShipOf([
      moduleOf("c1", { kind: "power", output: 40 }, 0, 0, 100, 5, 0, true),
      moduleOf("e1", engine(1.0, Math.PI), -10, 0, 100),
    ]);
    const { fx, fy } = shipForceAndTorque(ship, 0, true, "all");
    expect(fx, "rear-mounted (facing π) engine should push ship along +x").toBeGreaterThan(0);
    expect(Math.abs(fy), "no sideways force expected").toBeLessThan(Math.abs(fx) * 1e-9 + 1e-9);
    // availableThrust agrees: this is pure prograde thrust, no retrograde.
    const { prograde, retrograde } = availableThrust(ship);
    expect(prograde, "rear engine is forward thrust").toBeGreaterThan(0);
    expect(retrograde, "rear engine has no aft thrust").toBeCloseTo(0, 9);
  });

  it("a side-thrusting engine (facing π/2) produces net local force along -y", () => {
    // Engine on the right (x = +10) with exhaust facing = π/2 (+y). The thrust
    // on the ship is opposite the exhaust → −y in ship-local. So the ship
    // strafes downward (−y). Asserted on the primitive: in battle this side
    // engine never fires under a prograde/retrograde closing command.
    const ship = simShipOf([
      moduleOf("c1", { kind: "power", output: 40 }, 0, 0, 100, 5, 0, true),
      moduleOf("e1", engine(1.0, Math.PI / 2), 10, 0, 100),
    ]);
    const { fx, fy } = shipForceAndTorque(ship, 0, true, "all");
    expect(fy, "side engine (exhaust +y) should push ship along -y").toBeLessThan(0);
    expect(Math.abs(fx), "no longitudinal force from a pure side engine").toBeLessThan(
      Math.abs(fy) * 1e-9 + 1e-9,
    );
  });

  it("two opposing centreline engines cancel linear thrust and produce no torque", () => {
    // Two engines on the centreline (y = 0): one with facing 0 (force toward
    // -x), one with facing π (force toward +x). Net force is zero; both sit on
    // the centreline so they have no perpendicular lever arm and produce no
    // torque either. Asserted on the primitive — `thrustMode: "all"` fires both
    // so the cancellation is observable (the controller would fire only one).
    const ship = simShipOf([
      moduleOf("c1", { kind: "power", output: 40 }, 0, 0, 100, 5, 0, true),
      moduleOf("eF", engine(1.0, 0), 10, 0, 100),
      moduleOf("eB", engine(1.0, Math.PI), -10, 0, 100),
    ]);
    const { fx, fy, torque } = shipForceAndTorque(ship, 0, true, "all");
    expect(Math.abs(fx), "opposing engines should cancel longitudinal force").toBeLessThan(1e-9);
    expect(Math.abs(fy), "opposing centreline engines should not strafe").toBeLessThan(1e-9);
    expect(Math.abs(torque), "centreline engines produce no torque").toBeLessThan(1e-9);
  });

  it("unbalanced side engines produce a non-zero torque", () => {
    // Two engines on opposite sides of the centreline, equal thrust magnitude
    // but different lever arms. Asserted on the primitive directly because in
    // battle the controller fires neither when simply closing.
    //
    // Modules (all mass 5): command at (0,0), eL at (-5,+5), eR at (+10,-5),
    // so the CoM sits at (5/3, 0), not the origin.
    //
    // eL exhaust -π/2 → force +y; eR exhaust +π/2 → force -y. Both lever arms
    // about the CoM give a clockwise (negative) contribution, so the net
    // torque is non-zero and negative. The point of the test is that an
    // asymmetric fit spins the ship at all — the magnitude/sign falls out of
    // the geometry, so we assert a non-zero torque.
    const ship = simShipOf([
      moduleOf("c1", { kind: "power", output: 40 }, 0, 0, 100, 5, 0, true),
      moduleOf("eL", engine(1.0, -Math.PI / 2), -5, 5, 100),
      moduleOf("eR", engine(1.0, Math.PI / 2), 10, -5, 100),
    ]);
    const { torque } = shipForceAndTorque(ship, 0, true, "all");
    expect(Math.abs(torque), "unbalanced engines should produce a non-zero torque").toBeGreaterThan(0);
  });

  it("a default-facing engine (facing 0, exhaust forward) produces net local force -x", () => {
    // An engine declared without an explicit `facing` defaults to 0, i.e. its
    // exhaust points forward (+x), so the thrust on the ship is backward (−x).
    // A real forward-driving ship therefore must mount its engines facing π;
    // an un-faced engine is a reverse thruster. Asserted on the primitive — in
    // battle this engine never fires under a prograde closing command.
    const ship = simShipOf([
      moduleOf("c1", { kind: "power", output: 40 }, 0, 0, 100, 5, 0, true),
      moduleOf(
        "e1",
        { kind: "engine", thrust: 1.0 }, // no facing field → 0
        10,
        0,
        100,
      ),
    ]);
    const { fx } = shipForceAndTorque(ship, 0, true, "all");
    expect(fx, "default-facing engine (exhaust forward) pushes ship backward (−x)").toBeLessThan(0);
    // availableThrust agrees: pure retrograde thrust, no prograde.
    const { prograde, retrograde } = availableThrust(ship);
    expect(retrograde, "forward-exhaust engine is aft thrust").toBeGreaterThan(0);
    expect(prograde, "forward-exhaust engine has no forward thrust").toBeCloseTo(0, 9);
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
