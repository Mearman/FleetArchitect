import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/domain/grid";
import { mulberry32 } from "@/domain/simulation/rng";
import {
  computeForceAndLateral,
  computeMovementInputs,
  type ForceAndLateral,
  type MovementInputs,
} from "@/domain/simulation/engine/movement-dynamics";
import {
  computeForceAndLateralReference,
  computeMovementInputsReference,
} from "@/domain/simulation/engine/movement.reference";
import { toSimShip } from "@/domain/simulation/engine/setup";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { ModuleEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";
import type { SimModule, SimShip } from "@/domain/simulation/engine/types";

/**
 * Equivalence between the fused movement-capabilities scan
 * (`computeMovementInputs`, one module pass) and the reference (the four
 * separate scans it replaces: `maxCommandableTorque`, `geometricTorque`,
 * `availableThrust`'s lateral half, `afterburnerMultipliers`). Each accumulator
 * is a single running sum in module-array order, so the fused pass is
 * byte-identical to the four separate scans; this test pins that.
 *
 * The afterburner firing side effects (`techActive`/`techCooldown`) are
 * load-bearing, so the summary captures them and the fixtures exercise ready,
 * already-active, and mixed modules.
 */

const OPEN_EDGES: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };

function stats(over: Partial<ShipStats> = {}): ShipStats {
  return {
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
    deflectorCapacity: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    thrust: 0,
    turnRate: 0,
    weapons: [],
    ...over,
    compartments: 0,
    airtightCompartments: 0,
  };
}

function moduleOf(slotId: string, effect: ModuleEffect, col: number, row: number, mass = 5): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    x: col * CELL_SIZE,
    y: row * CELL_SIZE,
    maxSurfaceHp: 0,
    maxSubstrateHp: 5_000,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    surface: "bare",
    edges: OPEN_EDGES,
    mass,
    powerDraw: 0,
    crewRequired: 0,
    effect,
    command: false,
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: "facing" in effect && typeof effect.facing === "number" ? effect.facing : 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

function combatShip(id: string, modules: ResolvedModule[]): CombatShip {
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side: "attacker",
    stats: stats(),
    position: { x: 0, y: 0 },
    facing: 0,
    doctrine: { base: {}, rules: [] },
    classification: "frigate",
    modules,
  };
}

function resolveToSim(ship: CombatShip): SimShip {
  const rng = mulberry32(7);
  return toSimShip(ship, rng);
}

type AfterburnerTech = { slotId: string; techActive: number; techCooldown: number };

/** The post-call afterburner firing state — the load-bearing side effect. */
function afterburnerTech(ship: SimShip): AfterburnerTech[] {
  if (ship.modules === undefined) throw new Error(`${ship.instanceId} has no modules`);
  return ship.modules
    .filter((m) => m.effect.kind === "afterburner")
    .map((m) => ({ slotId: m.slotId, techActive: m.techActive, techCooldown: m.techCooldown }));
}

/** Run both implementations on independent deep clones and assert identical
 *  capabilities AND afterburner tech state. Returns the fused result for
 *  sanity checks (the caller confirms the scan actually did something). */
function assertEquivalent(ship: SimShip, shouldThrust: boolean): {
  ref: MovementInputs;
  opt: MovementInputs;
} {
  const refShip = structuredClone(ship);
  const optShip = structuredClone(ship);
  const ref = computeMovementInputsReference(refShip, shouldThrust);
  const opt = computeMovementInputs(optShip, shouldThrust);
  expect(opt.mct, "mct").toBe(ref.mct);
  expect(opt.geoTorque, "geoTorque").toBe(ref.geoTorque);
  expect(opt.latBudget, "latBudget").toBe(ref.latBudget);
  expect(opt.boost.thrust, "boost.thrust").toBe(ref.boost.thrust);
  expect(opt.boost.turn, "boost.turn").toBe(ref.boost.turn);
  // Afterburner firing side effects must match too.
  const refTech = afterburnerTech(refShip);
  const optTech = afterburnerTech(optShip);
  expect(optTech.length, "afterburner count").toBe(refTech.length);
  for (let i = 0; i < refTech.length; i += 1) {
    const r = refTech[i];
    const o = optTech[i];
    if (r === undefined || o === undefined) throw new Error("tech summary missing");
    expect(o.slotId, "afterburner slot order").toBe(r.slotId);
    expect(o.techActive, `techActive for ${r.slotId}`).toBe(r.techActive);
    expect(o.techCooldown, `techCooldown for ${r.slotId}`).toBe(r.techCooldown);
  }
  return { ref, opt };
}

// A high-output reactor keeps every consumer powered, manned, and charged so the
// scan under test is the only thing varying.
const REACTOR: ModuleEffect = { kind: "power", output: 1_000 };
const gimbalEngine = (facing: number): ModuleEffect => ({
  kind: "engine",
  thrust: 100,
  facing,
  gimbalArc: 0.4,
});
const fixedEngine = (facing: number): ModuleEffect => ({ kind: "engine", thrust: 100, facing });
const AB_READY: ModuleEffect = { kind: "afterburner", thrustBoost: 1.5, turnBoost: 1.2, duration: 5, cooldown: 10 };
const AB_ACTIVE: ModuleEffect = { kind: "afterburner", thrustBoost: 1.5, turnBoost: 1.2, duration: 5, cooldown: 10 };

function getModule(ship: SimShip, slotId: string): SimModule {
  if (ship.modules === undefined) throw new Error(`${ship.instanceId} has no modules`);
  const m = ship.modules.find((mod) => mod.slotId === slotId);
  if (m === undefined) throw new Error(`slot ${slotId} not found on ${ship.instanceId}`);
  return m;
}

describe("engine.movement-dynamics — reference vs optimised movement-capabilities equivalence", () => {
  it("gimbal and fixed engines thrusting: gimbal authority + geometric torque identical", () => {
    const resolved = resolveToSim(
      combatShip("engines", [
        moduleOf("r1", REACTOR, 0, 0),
        // Off-centreline gimballed engine (contributes to mct AND geoTorque).
        moduleOf("g1", gimbalEngine(Math.PI), 2, 1),
        // Off-centreline fixed engine (contributes to geoTorque only, no gimbalArc).
        moduleOf("f1", fixedEngine(Math.PI), -2, 1),
      ]),
    );
    const { opt } = assertEquivalent(resolved, true);
    // Sanity: both torque channels are non-zero (off-centreline rear engines).
    expect(opt.mct, "gimbal engine yields commandable authority").toBeGreaterThan(0);
    expect(opt.geoTorque, "both engines yield geometric disturbance").not.toBe(0);
  });

  it("lateral engines while not thrusting: lateral budget has no shouldThrust gate", () => {
    // Exhaust at ±π/2 ⇒ force is mostly ∓y ⇒ lateral. One each side so the
    // symmetric `min(plus, minus)` budget is non-zero. shouldThrust=false, so
    // geoTorque/mct stay 0 but the lateral budget is still computed.
    const resolved = resolveToSim(
      combatShip("lateral", [
        moduleOf("r1", REACTOR, 0, 0),
        moduleOf("lat1", fixedEngine(Math.PI / 2), 1, 0),
        moduleOf("lat2", fixedEngine(-Math.PI / 2), -1, 0),
      ]),
    );
    const { opt } = assertEquivalent(resolved, false);
    expect(opt.latBudget, "lateral budget is ungated by shouldThrust").toBeGreaterThan(0);
    expect(opt.geoTorque, "geometric torque is shouldThrust-gated").toBe(0);
    expect(opt.mct, "no gimbal authority without thrust").toBe(0);
  });

  it("RCS and reaction wheel: commandable torque identical, no linear force", () => {
    const resolved = resolveToSim(
      combatShip("attitude", [
        moduleOf("r1", REACTOR, 0, 0),
        moduleOf("rcs1", { kind: "rcs", torque: 7 }, 1, 0),
        moduleOf("rw1", { kind: "reactionWheel", torque: 11 }, 0, 1),
      ]),
    );
    const { opt } = assertEquivalent(resolved, false);
    expect(opt.mct, "rcs + wheel torque sum into commandable authority").toBe(18);
    expect(opt.geoTorque, "no engines ⇒ no geometric torque").toBe(0);
  });

  it("ready afterburner with movement intent: fires and boosts identically", () => {
    const resolved = resolveToSim(
      combatShip("ab-fire", [moduleOf("r1", REACTOR, 0, 0), moduleOf("a1", AB_READY, 1, 0)]),
    );
    const { opt } = assertEquivalent(resolved, true);
    expect(opt.boost.thrust, "fired afterburner boosts thrust").toBe(1.5);
    // Sanity: the module actually fired (side effect).
    const sanity = structuredClone(resolved);
    computeMovementInputs(sanity, true);
    expect(getModule(sanity, "a1").techActive, "ready afterburner fires").toBe(5);
  });

  it("already-active afterburner: boosts without re-firing identically", () => {
    const resolved = resolveToSim(
      combatShip("ab-active", [moduleOf("r1", REACTOR, 0, 0), moduleOf("a1", AB_ACTIVE, 1, 0)]),
    );
    getModule(resolved, "a1").techActive = 3; // mid-window
    const { opt } = assertEquivalent(resolved, true);
    expect(opt.boost.thrust, "active afterburner boosts").toBe(1.5);
    // techActive unchanged by the scan (the tick loop decrements it elsewhere).
    const sanity = structuredClone(resolved);
    computeMovementInputs(sanity, true);
    expect(getModule(sanity, "a1").techActive, "active module not re-fired").toBe(3);
  });

  it("mixed ship (gimbal engine + rcs + afterburner) thrusting: all channels identical", () => {
    const resolved = resolveToSim(
      combatShip("mixed", [
        moduleOf("r1", REACTOR, 0, 0),
        moduleOf("g1", gimbalEngine(Math.PI), 2, 0),
        moduleOf("rcs1", { kind: "rcs", torque: 5 }, 1, 1),
        moduleOf("a1", AB_READY, -1, 0),
      ]),
    );
    const { opt } = assertEquivalent(resolved, true);
    expect(opt.mct, "gimbal + rcs authority").toBeGreaterThan(5);
    expect(opt.geoTorque, "engine geometric torque").not.toBe(0);
    expect(opt.boost.thrust, "afterburner boost").toBe(1.5);
  });

  it("fuel-starved engine: contributes nothing on any channel identically", () => {
    const resolved = resolveToSim(
      combatShip("starved", [
        moduleOf("r1", REACTOR, 0, 0),
        moduleOf("g1", gimbalEngine(Math.PI), 2, 0),
      ]),
    );
    getModule(resolved, "g1").fuelStarved = true;
    const { opt } = assertEquivalent(resolved, true);
    expect(opt.mct, "starved engine gives no gimbal authority").toBe(0);
    expect(opt.geoTorque, "starved engine gives no geometric torque").toBe(0);
    expect(opt.latBudget, "starved engine gives no lateral budget").toBe(0);
  });
});

describe("engine.movement-dynamics — force+lateral fusion equivalence", () => {
  /** Run the fused force+lateral scan and the two-scan reference on independent
   *  clones and assert every field matches byte-for-byte. */
  function assertForceEquivalent(
    ship: SimShip,
    turnSign: number,
    engineFire: boolean,
    thrustMode: "all" | "prograde" | "retrograde",
    lateralCmd: number,
  ): ForceAndLateral {
    const ref = computeForceAndLateralReference(
      structuredClone(ship),
      turnSign,
      engineFire,
      thrustMode,
      lateralCmd,
    );
    const opt = computeForceAndLateral(
      structuredClone(ship),
      turnSign,
      engineFire,
      thrustMode,
      lateralCmd,
    );
    expect(opt.fx, "fx").toBe(ref.fx);
    expect(opt.fy, "fy").toBe(ref.fy);
    expect(opt.torque, "torque").toBe(ref.torque);
    expect(opt.latFx, "latFx").toBe(ref.latFx);
    expect(opt.latFy, "latFy").toBe(ref.latFy);
    expect(opt.latTorque, "latTorque").toBe(ref.latTorque);
    return opt;
  }

  it("gimbal + fore/aft engines thrusting: engine force + gimbal torque, no lateral", () => {
    const resolved = resolveToSim(
      combatShip("fa-engines", [
        moduleOf("r1", REACTOR, 0, 0),
        moduleOf("g1", gimbalEngine(Math.PI), 2, 1),
        moduleOf("f1", fixedEngine(Math.PI), -2, 1),
      ]),
    );
    const opt = assertForceEquivalent(resolved, 1, true, "all", 0);
    expect(opt.fx, "rear engines push forward").not.toBe(0);
    expect(opt.latFy, "fore/aft engines contribute no lateral").toBe(0);
  });

  it("thrustMode filter selects opposite engines between prograde and retrograde", () => {
    const resolved = resolveToSim(
      combatShip("thrustmode", [
        moduleOf("r1", REACTOR, 0, 0),
        moduleOf("fwd", fixedEngine(Math.PI), 1, 0), // exhaust aft ⇒ +x force (prograde)
        moduleOf("aft", fixedEngine(0), -1, 0), // exhaust fwd ⇒ -x force (retrograde)
      ]),
    );
    const prograde = assertForceEquivalent(resolved, 0, true, "prograde", 0);
    const retrograde = assertForceEquivalent(resolved, 0, true, "retrograde", 0);
    expect(Math.sign(prograde.fx), "prograde vs retrograde flip the fired engine").not.toBe(
      Math.sign(retrograde.fx),
    );
  });

  it("lateral engine is double-counted: engine force AND damper channel", () => {
    // Exhaust at -π/2 ⇒ force +y (lyUnit = 1). With engineFire + thrustMode
    // "all" it contributes to fy (engine force), and with lateralCmd = 1 it also
    // contributes to latFy (damper) — the intentional double-count the fusion
    // must preserve as two separate running sums.
    const resolved = resolveToSim(
      combatShip("lateral-dbl", [
        moduleOf("r1", REACTOR, 0, 0),
        moduleOf("lat", fixedEngine(-Math.PI / 2), 1, 0),
      ]),
    );
    const opt = assertForceEquivalent(resolved, 0, true, "all", 1);
    expect(opt.fy, "lateral engine contributes to engine force").not.toBe(0);
    expect(opt.latFy, "lateral engine contributes to damper channel").not.toBe(0);
  });

  it("RCS: commandable torque (turnSign * torque), no linear force", () => {
    const resolved = resolveToSim(
      combatShip("rcs", [
        moduleOf("r1", REACTOR, 0, 0),
        moduleOf("rcs1", { kind: "rcs", torque: 9 }, 1, 0),
      ]),
    );
    const opt = assertForceEquivalent(resolved, 1, false, "all", 0);
    expect(opt.torque, "rcs torque = turnSign * effect.torque").toBe(9);
    expect(opt.fx).toBe(0);
    expect(opt.fy).toBe(0);
  });

  it("fuel-starved engine contributes nothing on either channel", () => {
    const resolved = resolveToSim(
      combatShip("fa-starved", [
        moduleOf("r1", REACTOR, 0, 0),
        moduleOf("lat", fixedEngine(-Math.PI / 2), 1, 0),
      ]),
    );
    getModule(resolved, "lat").fuelStarved = true;
    const opt = assertForceEquivalent(resolved, 0, true, "all", 1);
    expect(opt.fy).toBe(0);
    expect(opt.latFy).toBe(0);
  });
});
