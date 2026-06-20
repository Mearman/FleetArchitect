/**
 * N14 determinism gate (Gap C4 — relativistic momentum): the closed-form
 * `p = gamma·m·v` integrator must be byte-identical across two same-seed runs,
 * AND must actually engage its relativistic branch (gamma > 1) when a ship is
 * driven to a meaningful fraction of c.
 *
 * The integrator (`relativisticMomentumStep`, wired into movement.ts) works in
 * momentum space: it re-derives `p = gamma(v)·m·v` from the live velocity, adds
 * the tick's force, then maps the new momentum back to a velocity bounded by c.
 * It is a fixed sequence of arithmetic with no loop, no root-finder, no RNG and
 * no clock — so the same inputs must yield the same outputs bit-for-bit, and a
 * whole battle that exercises it every tick must replay byte-identically.
 *
 * Two layers of proof:
 *  1. The pure function directly — closed-form determinism, the relativistic
 *     branch (gamma > 1.001), the c speed limit, and the Newtonian low-speed
 *     limit. No battle, no engine — the integrator in isolation.
 *  2. A full battle whose attacker carries enormous thrust and chases a target
 *     placed far away, so it accelerates past 0.1c within a few ticks while the
 *     gravity/collision/recoil writes around the integrator still run. Two runs
 *     with the same seed must produce byte-identical frames, and at least one
 *     ship must show gamma > 1.001 at some frame (the relativistic branch is
 *     genuinely active, not bypassed at sub-relativistic speed).
 *
 * Self-contained (no shared battle helper for the full-battle case) so the gate
 * cannot silently change when an unrelated helper does.
 */
import { describe, expect, it } from "vitest";

import { runBattle } from "@/domain/simulation/engine";
import { relativisticMomentumStep } from "@/domain/simulation/engine/relativistic-momentum";
import { SPEED_OF_LIGHT_M_PER_TICK } from "@/domain/simulation/engine/config";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { ModuleEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";
import type { CellEdges } from "@/schema/grid";
import { defaultOrders } from "@/schema/fleet";

const C = SPEED_OF_LIGHT_M_PER_TICK;

/** Lorentz factor of a speed (m/tick), for asserting the relativistic branch is
 *  active. Mirrors the integrator's own `1/sqrt(1 - (v/c)^2)`. */
function gammaOf(speed: number): number {
  const beta = speed / C;
  return 1 / Math.sqrt(1 - beta * beta);
}

describe("relativisticMomentumStep (N14) — the closed-form integrator", () => {
  it("is byte-identical for identical inputs (no RNG, no clock, no iteration)", () => {
    // A force large enough to drive a small mass relativistic in one tick.
    const a = relativisticMomentumStep(0, 0, 4_000_000 * 10, 0, 10);
    const b = relativisticMomentumStep(0, 0, 4_000_000 * 10, 0, 10);
    expect(b).toEqual(a);
  });

  it("engages the relativistic branch (gamma > 1.001) under heavy thrust", () => {
    // From rest, a force of 1e6·m over one tick gives Newtonian dv = 1e6 m/tick
    // ≈ 0.1c — well into the relativistic regime, so the mapped velocity must
    // be visibly below the Newtonian 1e6 (gamma scales it down) and its gamma
    // well above 1.001.
    const m = 10;
    const next = relativisticMomentumStep(0, 0, 1_000_000 * m, 0, m);
    const speed = Math.hypot(next.vx, next.vy);
    expect(gammaOf(speed)).toBeGreaterThan(1.001);
    // The relativistic velocity is strictly less than the Newtonian F/m.
    expect(speed).toBeLessThan(1_000_000);
  });

  it("never exceeds the speed of light, however large the force", () => {
    // A force vastly beyond anything physical. The closed form keeps the speed
    // bounded by c and finite (no Infinity, no NaN). At this extreme the
    // momentum so dwarfs `m·c` that `gamma = sqrt(1 + (p/mc)^2)` loses the `+1`
    // to float rounding and the speed SATURATES at exactly c (the float-
    // precision limit) — never above it. So the physical invariant is `<= c`,
    // with `=` reachable only in this saturated extreme; at any speed a real
    // battle produces it is strictly below.
    const next = relativisticMomentumStep(0, 0, 1e30, 1e30, 1);
    const speed = Math.hypot(next.vx, next.vy);
    expect(speed).toBeLessThanOrEqual(C);
    expect(Number.isFinite(speed)).toBe(true);
  });

  it("reduces to the Newtonian v + F/m at sub-relativistic speed (gamma -> 1)", () => {
    // A gentle force on a heavy ship: gamma is 1 to float precision, so the
    // relativistic velocity matches the Newtonian F/m closely.
    const m = 100;
    const fx = 5;
    const next = relativisticMomentumStep(0, 0, fx, 0, m);
    // Newtonian dv = fx / m.
    expect(next.vx).toBeCloseTo(fx / m, 12);
    expect(next.vy).toBe(0);
  });
});

// --- Full-battle determinism, with a fixture that genuinely reaches >0.1c ---

const OPEN_EDGES: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };

function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  command = false,
): ResolvedModule {
  return {
    slotId,
    moduleId: slotId,
    kind: effect.kind,
    col,
    row,
    x: col,
    y: row,
    maxSurfaceHp: 0,
    maxScaffoldHp: 50,
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
    facing: effect.kind === "engine" ? effect.facing ?? 0 : 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

/** A ship with a command, a sensor (so it acquires a distant target), an RCS,
 *  and a rear engine of the given thrust. Huge thrust drives it relativistic. */
function ship(opts: {
  id: string;
  side: "attacker" | "defender";
  x: number;
  thrust: number;
}): CombatShip {
  const stats: ShipStats = {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 500,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 60,
    thrust: opts.thrust,
    turnRate: 0.1,
    weapons: [],
    compartments: 0,
    airtightCompartments: 0,
  };
  const modules: ResolvedModule[] = [
    moduleOf(`${opts.id}-cmd`, { kind: "power", output: 1000 }, 0, 0, true),
    moduleOf(`${opts.id}-eng`, { kind: "engine", thrust: opts.thrust, facing: Math.PI }, -1, 0),
    moduleOf(`${opts.id}-rcs`, { kind: "rcs", torque: 0.5 }, 0, 0),
    moduleOf(
      `${opts.id}-sen`,
      { kind: "sensor", sensorType: "omni", arc: Math.PI, bearing: 0, detectionRange: 4e9, nebulaImmune: false },
      0,
      1,
    ),
  ];
  return {
    instanceId: opts.id,
    designId: `design-${opts.id}`,
    faction: "test",
    side: opts.side,
    stats,
    position: { x: opts.x, y: 0 },
    facing: 0,
    orders: { ...defaultOrders },
    crewPriority: "combat",
    shipStance: "balanced",
    classification: "frigate",
    rules: [],
    modules,
  };
}

function battle(ships: CombatShip[], seed: number, maxTicks: number): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomaly: "none",
    seed,
    maxTicks,
  };
}

describe("engine relativistic-integrator determinism (N14)", () => {
  it("is byte-identical across two same-seed runs of a relativistic chase", () => {
    // The attacker carries an enormous engine and chases an unarmed marker down
    // +x: it stays in the closing branch and thrusts hard, crossing 0.1c within
    // the first couple of ticks. A short tick budget is plenty — the
    // relativistic frames appear immediately — and keeps the gate fast. Neither
    // ship is armed, so the battle never resolves; it runs the full budget.
    const make = (): CombatShip[] => [
      ship({ id: "r-rocket", side: "attacker", x: 0, thrust: 2_500_000 }),
      ship({ id: "r-marker", side: "defender", x: 1e7, thrust: 0 }),
    ];

    // A short budget: the rocket crosses gamma > 1.001 within a couple of ticks,
    // so a handful of frames captures the relativistic regime. (Swept collision
    // genuinely sweeps the per-tick displacement, which is large at relativistic
    // speed, so a long run would be needlessly heavy for no extra coverage — the
    // determinism property holds at any tick count.)
    const TICKS = 8;
    const a = runBattle(battle(make(), 13, TICKS));
    const b = runBattle(battle(make(), 13, TICKS));

    // The gate: every frame byte-identical, plus the run summary.
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
    expect(b.ticks).toBe(a.ticks);

    // The relativistic branch is genuinely active: at least one ship shows
    // gamma > 1.001 at some frame. (Proves the closed-form is doing real
    // relativistic work, not sitting at gamma ≈ 1 the whole battle.)
    let sawRelativistic = false;
    let maxSpeedSeen = 0;
    for (const frame of a.frames) {
      for (const s of frame.ships) {
        const speed = Math.hypot(s.vx ?? 0, s.vy ?? 0);
        if (speed > maxSpeedSeen) maxSpeedSeen = speed;
        if (gammaOf(speed) > 1.001) sawRelativistic = true;
      }
    }
    expect(sawRelativistic, "a ship should reach gamma > 1.001 (relativistic branch active)").toBe(true);

    // And the speed limit holds: no ship ever exceeds c, however hard it burned.
    expect(maxSpeedSeen).toBeLessThan(C);
  });

  it("stays deterministic over a sustained relativistic run with a different seed", () => {
    const make = (): CombatShip[] => [
      ship({ id: "q-rocket", side: "attacker", x: 0, thrust: 3_000_000 }),
      ship({ id: "q-marker", side: "defender", x: 2e7, thrust: 0 }),
    ];
    const TICKS = 16;
    const a = runBattle(battle(make(), 41, TICKS));
    const b = runBattle(battle(make(), 41, TICKS));
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
    expect(b.ticks).toBe(a.ticks);
  });
});
