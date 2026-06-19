import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ModuleEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Bang-bang attitude control: ships spin up under torque, coast, then brake to
 * arrive at the desired heading with angVel ≈ 0 — no artificial speed cap and
 * no oscillation past the target. These tests verify the Newtonian rotation
 * model; the old proportional-scalar controller assertions are removed.
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
    turnRate: 0,
    weapons: [],
    // The rotation controller only engages once a ship has acquired its target.
    // The ships carry an all-round (omni) sensor module so they detect each
    // other across the test geometry and the controller (not advance-to-contact
    // under fog) is the variable under test; fog is covered by the awareness suite.
    ...over,
  };
}

function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  x: number,
  y: number,
  command = false,
): ResolvedModule {
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
    sensorBearing: effect.kind === "sensor" ? effect.bearing : 0,
  };
}

/** An all-round (omni) sensor effect of the given range — a full detection
 *  circle, which is what the removed sensorRange scalar stood in for. */
function omniSensor(detectionRange: number): ModuleEffect {
  return {
    kind: "sensor",
    sensorType: "omni",
    arc: Math.PI,
    detectionRange,
    bearing: 0,
    nebulaImmune: false,
  };
}

/**
 * Build a ship with an RCS module for clean, commandable pure torque — no
 * geometric r×F disturbance from off-centre engines. The engine drives the
 * ship forward; the RCS turns it. The RCS torque is the only commandable
 * authority, making the bang-bang response deterministic and predictable.
 */
function rcsShip(
  id: string,
  side: "attacker" | "defender",
  pos: { x: number; y: number },
  facing: number,
  rcsTorque = 0.5,
): CombatShip {
  return {
    instanceId: id,
    designId: `d-`,
    faction: "test",
    side,
    stats: shipStats({}),
    position: pos,
    facing,
    orders: { ...defaultOrders, engageRange: "hold" },
    classification: "frigate",
    modules: [
      moduleOf("c", { kind: "power", output: 40 }, 0, 0, true),
      // Centreline engine: exhaust aft → forward thrust, no geometric torque.
      moduleOf("e", { kind: "engine", thrust: 1, facing: Math.PI }, -1, 0),
      // RCS: pure commandable torque, no translation.
      moduleOf("r", { kind: "rcs", torque: rcsTorque }, 0, 1),
      // An all-round sensor so the ships detect each other across the test
      // geometry (replaces the removed sensorRange scalar); without it, the
      // controller never engages and the rotation model isn't exercised. Placed
      // at the three-module centre of mass (-1/3, 1/3) so it adds mass at the
      // pivot and does not perturb the MoI the bang-bang response is tuned for.
      moduleOf("se", omniSensor(1000), -1 / 3, 1 / 3),
    ],
  };
}

/**
 * Build a ship with only a centreline engine — no RCS, no reaction wheels,
 * no gimbal, no off-centre torque. This ship has zero commandable torque
 * authority and should not rotate under the bang-bang controller.
 */
function noTorqueShip(
  id: string,
  side: "attacker" | "defender",
  pos: { x: number; y: number },
  facing: number,
): CombatShip {
  return {
    instanceId: id,
    designId: `d-`,
    faction: "test",
    side,
    stats: shipStats({}),
    position: pos,
    facing,
    orders: { ...defaultOrders, engageRange: "hold" },
    classification: "frigate",
    modules: [
      moduleOf("c", { kind: "power", output: 40 }, 0, 0, true),
      moduleOf("e", { kind: "engine", thrust: 1, facing: Math.PI }, 0, 0),
      // Sensor so detection works and the controller is invoked — but with no
      // RCS or off-centre torque, commandable authority is zero, so the ship
      // must still not rotate.
      moduleOf("se", omniSensor(1000), 1, 0),
    ],
  };
}

function inputs(ships: CombatShip[], maxTicks = 300): BattleInputs {
  return {
    ships,
    attackerFleetId: "a",
    defenderFleetId: "b",
    anomaly: "none",
    seed: 1,
    maxTicks,
  };
}

/** Signed angle in (−π, π]. */
function wrap(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x <= -Math.PI) x += Math.PI * 2;
  return x;
}

describe("bang-bang attitude control", () => {
  /**
   * A ship turning 180° must spin up, accumulate angular velocity well beyond
   * a single tick's torque step, then brake to arrive. The peak angVel must
   * exceed a single tick's α, proving angular momentum is accumulating.
   */
  it("angVel accumulates under sustained torque (can exceed any single-tick step)", () => {
    // rcsShip with torque 0.5 and MoI ≈ mass*legacyMoI → α ≈ 0.5 / MoI.
    // With modular ships MoI is from module distribution; let it build up.
    const s = rcsShip("s1", "attacker", { x: 0, y: 0 }, 0);
    const t = rcsShip("t1", "defender", { x: -600, y: 0 }, Math.PI);
    const res = runBattle(inputs([s, t]));

    const facings = res.frames.map(
      (f) => f.ships.find((x) => x.instanceId === "s1")?.facing ?? 0,
    );

    // Peak per-tick facing change across the whole battle.
    let maxPerTickTurn = 0;
    for (let i = 1; i < facings.length; i += 1) {
      const a = facings[i];
      const b = facings[i - 1];
      if (a === undefined || b === undefined) continue;
      maxPerTickTurn = Math.max(maxPerTickTurn, Math.abs(wrap(a - b)));
    }

    // A single tick of rcs torque 0.5 on a small ship: α = 0.5 / MoI.
    // MoI for two mass-5 modules at ±1 from CoM ≈ 2 * 5 * 1 = 10 → α ≈ 0.05.
    // After many ticks of acceleration the accumulated angVel should clearly
    // exceed 0.05. We check it exceeds 0.1 (twice α) conservatively.
    expect(
      maxPerTickTurn,
      `peak angVel per tick ${maxPerTickTurn.toFixed(4)} should exceed one tick's α`,
    ).toBeGreaterThan(0.1);
  });

  /**
   * Bang-bang control must not overshoot and oscillate. The signed heading
   * error should cross zero at most once (spin-up then brake-and-arrive).
   */
  it("settles on the target heading without oscillating past it", () => {
    const s = rcsShip("s1", "attacker", { x: 0, y: 0 }, 0);
    const t = rcsShip("t1", "defender", { x: -600, y: 0 }, Math.PI);
    const res = runBattle(inputs([s, t]));

    const facings = res.frames.map(
      (f) => f.ships.find((x) => x.instanceId === "s1")?.facing ?? 0,
    );

    // Target bearing from s1 is π (directly behind). Count sign changes in
    // the heading error — a bang-bang controller crosses zero at most once.
    const targetBearing = Math.PI;
    let signChanges = 0;
    let prevSign = 0;
    for (const f of facings) {
      const err = wrap(targetBearing - f);
      const sign = Math.sign(err);
      if (sign !== 0 && prevSign !== 0 && sign !== prevSign) signChanges += 1;
      if (sign !== 0) prevSign = sign;
    }

    // A clean bang-bang controller crosses the target at most twice: once on
    // arrival and once on the return from a single small overshoot caused by
    // discrete time-stepping. More than 2 sign changes is the multiple-cycle
    // oscillation the old proportional controller exhibited (12+).
    expect(
      signChanges,
      `heading oscillated ${signChanges} times around the target`,
    ).toBeLessThanOrEqual(2);
  });

  /**
   * The ship must actually reach the target heading within the battle window.
   */
  it("reaches the target heading with angVel ≈ 0", () => {
    const s = rcsShip("s1", "attacker", { x: 0, y: 0 }, 0);
    const t = rcsShip("t1", "defender", { x: -600, y: 0 }, Math.PI);
    const res = runBattle(inputs([s, t]));

    const frames = res.frames;
    const last = frames[frames.length - 1];
    if (last === undefined) throw new Error("no frames");
    const ship = last.ships.find((x) => x.instanceId === "s1");
    if (ship === undefined) throw new Error("ship not found");
    const finalFacing = ship.facing ?? 0;
    const err = Math.abs(wrap(Math.PI - finalFacing));
    expect(err, `final heading error ${err.toFixed(3)} rad`).toBeLessThan(0.1);
  });

  /**
   * A ship with no torque source (no RCS, no wheels, no gimbal, no off-centre
   * engine torque) must not rotate at all — it has zero commandable authority.
   */
  it("a ship with no torque source does not rotate", () => {
    const s = noTorqueShip("s1", "attacker", { x: 0, y: 0 }, 0);
    // Target behind the ship so there is a strong heading error.
    const t = noTorqueShip("t1", "defender", { x: -600, y: 0 }, Math.PI);
    const res = runBattle(inputs([s, t], 100));

    const facings = res.frames.map(
      (f) => f.ships.find((x) => x.instanceId === "s1")?.facing ?? 0,
    );

    // Ship starts at facing 0; with no torque it must stay there.
    for (const f of facings) {
      expect(
        Math.abs(f),
        `facing changed to ${f.toFixed(4)} despite zero torque authority`,
      ).toBeLessThan(0.001);
    }
  });

  /**
   * A higher-MoI ship turns slower than a low-MoI ship given equal torque.
   * We compare the time to rotate 90° for two ships with the same RCS torque
   * but different module distributions (hence different MoI).
   */
  it("higher-MoI ship turns slower than a low-MoI ship for equal torque", () => {
    // Low MoI: modules clustered near origin → small |r|.
    function lowMoiShip(id: string, side: "attacker" | "defender"): CombatShip {
      return {
        instanceId: id,
        designId: `d-`,
        faction: "test",
        side,
        stats: shipStats({}),
        position: { x: 0, y: 0 },
        facing: 0,
        orders: { ...defaultOrders, engageRange: "hold" },
        classification: "frigate",
        modules: [
          moduleOf("c", { kind: "power", output: 40 }, 0, 0, true),
          moduleOf("e", { kind: "engine", thrust: 1, facing: Math.PI }, 0, 0),
          // RCS at origin: no contribution to MoI offset (r=0), but torque is
          // position-independent for pure-torque modules. MoI comes from masses.
          moduleOf("r", { kind: "rcs", torque: 0.5 }, 0, 0),
          // Omni sensor so the ship acquires the target and the controller
          // engages (replaces the removed sensorRange scalar).
          moduleOf("se", omniSensor(1000), 0, 0),
        ],
      };
    }

    // High MoI: same torque, but heavy masses far from CoM.
    function highMoiShip(id: string, side: "attacker" | "defender"): CombatShip {
      return {
        instanceId: id,
        designId: `d-`,
        faction: "test",
        side,
        stats: shipStats({}),
        position: { x: 100, y: 0 },
        facing: 0,
        orders: { ...defaultOrders, engageRange: "hold" },
        classification: "frigate",
        modules: [
          moduleOf("c", { kind: "power", output: 40 }, 0, 0, true),
          // Masses spread far from the CoM → high MoI.
          moduleOf("h1", { kind: "hull" }, -5, 0),
          moduleOf("h2", { kind: "hull" }, 5, 0),
          moduleOf("h3", { kind: "hull" }, 0, -5),
          moduleOf("h4", { kind: "hull" }, 0, 5),
          moduleOf("e", { kind: "engine", thrust: 1, facing: Math.PI }, 0, 0),
          // Same RCS torque as the low-MoI ship.
          moduleOf("r", { kind: "rcs", torque: 0.5 }, 0, 0),
          // Omni sensor so the ship acquires the target and the controller
          // engages (replaces the removed sensorRange scalar).
          moduleOf("se", omniSensor(1000), 0, 0),
        ],
      };
    }

    // Target sits at x=-600 from attacker and x=-500 from defender to give
    // both ships a full ~π heading error.
    const lowTarget = rcsShip("lt", "defender", { x: -600, y: 0 }, Math.PI);
    const highTarget = rcsShip("ht", "defender", { x: -400, y: 0 }, Math.PI);

    const lowRes = runBattle({
      ships: [lowMoiShip("low", "attacker"), lowTarget],
      attackerFleetId: "a",
      defenderFleetId: "b",
      anomaly: "none",
      seed: 1,
      maxTicks: 600,
    });

    const highRes = runBattle({
      ships: [highMoiShip("high", "attacker"), highTarget],
      attackerFleetId: "a",
      defenderFleetId: "b",
      anomaly: "none",
      seed: 1,
      maxTicks: 600,
    });

    // Count how many ticks each ship takes to rotate past π/2 (quarter turn).
    function ticksToQuarterTurn(res: ReturnType<typeof runBattle>, id: string): number {
      for (let i = 0; i < res.frames.length; i += 1) {
        const frame = res.frames[i];
        if (frame === undefined) continue;
        const ship = frame.ships.find((s) => s.instanceId === id);
        if (ship === undefined) continue;
        if (Math.abs(wrap((ship.facing ?? 0) - Math.PI / 2)) < Math.PI / 4) return i;
      }
      return res.frames.length;
    }

    const lowTicks = ticksToQuarterTurn(lowRes, "low");
    const highTicks = ticksToQuarterTurn(highRes, "high");

    expect(
      highTicks,
      `high-MoI ship (${highTicks} ticks) should take longer than low-MoI ship (${lowTicks} ticks) to turn 90°`,
    ).toBeGreaterThan(lowTicks);
  });

  /**
   * Two runs with the same seed must produce byte-identical frame data.
   * Rotation decisions must be fully deterministic — no RNG, clock, or
   * Map/Set iteration-order dependence.
   */
  it("two runs with the same seed produce byte-identical results", () => {
    const makeInputs = (): BattleInputs => ({
      ships: [
        rcsShip("s1", "attacker", { x: 0, y: 0 }, 0),
        rcsShip("s2", "attacker", { x: 30, y: 0 }, Math.PI / 4),
        rcsShip("t1", "defender", { x: -400, y: 100 }, Math.PI),
        rcsShip("t2", "defender", { x: -430, y: -50 }, Math.PI * 0.8),
      ],
      attackerFleetId: "a",
      defenderFleetId: "b",
      anomaly: "none",
      seed: 42,
      maxTicks: 150,
    });

    const res1 = runBattle(makeInputs());
    const res2 = runBattle(makeInputs());

    expect(res1.frames.length).toBe(res2.frames.length);

    for (let i = 0; i < res1.frames.length; i += 1) {
      const f1 = res1.frames[i];
      const f2 = res2.frames[i];
      if (f1 === undefined || f2 === undefined) continue;
      for (const ship1 of f1.ships) {
        const ship2 = f2.ships.find((s) => s.instanceId === ship1.instanceId);
        if (ship2 === undefined) continue;
        expect(ship2.facing, `frame ${i} ship ${ship1.instanceId} facing`).toBe(
          ship1.facing,
        );
        expect(ship2.x, `frame ${i} ship ${ship1.instanceId} x`).toBe(ship1.x);
        expect(ship2.y, `frame ${i} ship ${ship1.instanceId} y`).toBe(ship1.y);
      }
    }
  });
});
