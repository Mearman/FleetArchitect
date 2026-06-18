import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ModuleEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Rotation feel: a ship turning to a new heading should accelerate its spin up
 * to a bounded angular speed, then decelerate to arrive ON the target heading
 * without flying past it and oscillating back and forth. The old controller
 * (proportional error fed into a damped accumulator) snapped to a huge angular
 * velocity and wobbled onto its heading — ships pirouetted unnaturally.
 *
 * These tests pin the realistic behaviour: bounded angular velocity and no
 * meaningful overshoot when settling on a target heading.
 */

function shipStats(over: Partial<ShipStats>): ShipStats {
  return {
    mass: 10,
    massCapacity: 100,
    cost: 0,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 100,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 0,
    damageReduction: 0,
    thrust: 1,
    turnRate: 0.02,
    weapons: [],
    // These tests exercise the rotation controller, which only engages once a
    // ship has acquired its target and is steering toward it. Give the ships a
    // long sensor reach so they detect each other across the test geometry and
    // the controller (not advance-to-contact under fog) is the variable under
    // test; faithful fog of war is covered by the awareness suite.
    sensorRange: 1000,
    ...over,
  };
}

function moduleOf(slotId: string, effect: ModuleEffect, x: number, y: number, command = false): ResolvedModule {
  return {
    slotId,
    moduleId: slotId,
    kind: effect.kind,
    col: Math.round(x),
    row: Math.round(y),
    x,
    y,
    maxHp: 50,
    mass: 5,
    powerDraw: 0,
    crewRequired: 0,
    effect,
    command,
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: effect.kind === "engine" ? (effect.facing ?? 0) : 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    channel: effect.kind === "comms" ? effect.channel : 0,
    commsBearing: effect.kind === "comms" ? effect.bearing : 0,
  };
}

function turner(id: string, side: "attacker" | "defender", pos: { x: number; y: number }, facing: number): CombatShip {
  return {
    instanceId: id,
    designId: `d-${id}`,
    side,
    stats: shipStats({ turnRate: 0.02 }),
    position: pos,
    facing,
    orders: { ...defaultOrders, engageRange: "hold" },
    classification: "frigate",
    modules: [
      moduleOf("c", { kind: "power", output: 40 }, 0, 0, true),
      // Rear-mounted engine (exhaust aft) so the ship can drive forward; turn
      // rate is what governs the angular accel cap under test.
      moduleOf("e", { kind: "engine", thrust: 1, turnRate: 0.02, facing: Math.PI }, -1, 0),
    ],
  };
}

function inputs(ships: CombatShip[]): BattleInputs {
  return { ships, attackerFleetId: "a", defenderFleetId: "b", anomaly: "none", seed: 1, maxTicks: 200 };
}

/** Signed angle in (-π, π]. */
function wrap(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x <= -Math.PI) x += Math.PI * 2;
  return x;
}

describe("rotation feel", () => {
  // Ship at origin facing +x; its target sits directly behind it, so it must
  // turn ~180° to bring its guns (and heading) to bear. The target is on
  // "hold" too so it stays put and the geometry is stable.
  function turn180() {
    const s = turner("s1", "attacker", { x: 0, y: 0 }, 0);
    const t = turner("t1", "defender", { x: -600, y: 0 }, Math.PI);
    const res = runBattle(inputs([s, t]));
    const facings = res.frames.map((f) => f.ships.find((x) => x.instanceId === "s1")?.facing ?? 0);
    return facings;
  }

  it("keeps angular velocity bounded (no violent snap)", () => {
    const facings = turn180();
    let maxAngVel = 0;
    for (let i = 1; i < facings.length; i += 1) {
      const a = facings[i];
      const b = facings[i - 1];
      if (a === undefined || b === undefined) continue;
      maxAngVel = Math.max(maxAngVel, Math.abs(wrap(a - b)));
    }
    // turnRate is 0.02 rad/tick of angular acceleration. A believable max
    // angular speed is a small multiple of that, not the ~0.7 rad/tick
    // (≈40°/tick) the old proportional controller produced.
    expect(maxAngVel, `peak angVel ${maxAngVel.toFixed(3)} rad/tick is too high`).toBeLessThan(0.25);
  });

  it("settles on the target heading without oscillating past it", () => {
    const facings = turn180();
    // The target bearing from the ship is π (directly behind). Once the ship
    // has turned most of the way, it must converge monotonically — never swing
    // past the target and come back. Measure the signed error to the target
    // bearing over the second half of the run; it must not change sign
    // repeatedly (that is the wobble we are eliminating).
    const targetBearing = Math.PI;
    let signChanges = 0;
    let prevSign = 0;
    for (const f of facings) {
      const err = wrap(targetBearing - f);
      const sign = Math.sign(err);
      if (sign !== 0 && prevSign !== 0 && sign !== prevSign) signChanges += 1;
      if (sign !== 0) prevSign = sign;
    }
    // A clean ease-in/ease-out crosses the target at most once. The old
    // controller oscillated, flipping sign many times.
    expect(signChanges, `heading oscillated ${signChanges} times around the target`).toBeLessThanOrEqual(1);
  });

  it("actually reaches the target heading", () => {
    const facings = turn180();
    const last = facings[facings.length - 1] ?? 0;
    const err = Math.abs(wrap(Math.PI - last));
    expect(err, `final heading error ${err.toFixed(3)} rad`).toBeLessThan(0.1);
  });
});
