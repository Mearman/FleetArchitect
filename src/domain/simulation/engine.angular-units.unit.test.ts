import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { ACCEL_PER_TICK_FROM_SI } from "@/domain/simulation/types";
import type {
  BattleInputs,
  CombatShip,
  ResolvedModule,
} from "@/domain/simulation/types";
import type { ModuleEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";
import { mulberry32 } from "@/domain/simulation/rng";
import { toSimShip } from "./engine/setup";
import { maxCommandableTorque } from "./engine/physics";

/**
 * Angular acceleration must live in the per-tick clock, exactly as linear
 * acceleration does. A reaction wheel produces an SI torque (N·m); the ship's
 * moment of inertia is in kg·m², so `torque / I` is an SI angular acceleration
 * (rad/s²). The integrator stores `angVel` in rad/TICK, so the per-tick
 * increment is `(torque / I) · ACCEL_PER_TICK_FROM_SI` — the angular twin of
 * the linear thrust rescale. Without the factor every ship spins up by
 * TICKS_PER_SECOND² (900×) too fast, which both over-accelerates commanded
 * turns and breaks the bang-bang controller's stopping-angle estimate (its
 * `alpha` is then 900× too large, so it brakes far too late and the ship spins
 * out of control). The catalogue authors RCS / reaction-wheel / engine torque
 * in SI units (millions of N·m), so this is the production scale, not a test
 * artefact.
 */

const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

function shipStats(over: Partial<ShipStats>): ShipStats {
  return {
    mass: 10,
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
    deflectorCapacity: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    damageReduction: 0,
    thrust: 1,
    turnRate: 0,
    weapons: [],
    ...over,
    compartments: 0,
    airtightCompartments: 0,
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
    maxSurfaceHp: 0,
    maxSubstrateHp: 50,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    maxReactiveHp: 0,
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
    facing: effect.kind === "engine" ? (effect.facing ?? 0) : 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

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
 * A ship whose only commandable attitude authority is a single reaction wheel
 * of the given SI torque, with a centreline engine (no geometric r×F torque)
 * and an omni sensor so it acquires the target. At rest, facing a target that
 * is directly behind it, the first integrated tick applies exactly the wheel's
 * angular acceleration and nothing else (the engine is unaligned so it does not
 * fire; the ship is at rest so the lateral damper is idle).
 */
function reactionWheelShip(
  id: string,
  side: "attacker" | "defender",
  pos: { x: number; y: number },
  facing: number,
  torque: number,
): CombatShip {
  return {
    instanceId: id,
    designId: "d-",
    faction: "Terran",
    side,
    stats: shipStats({}),
    position: pos,
    facing,
    doctrine: {
      base: {
        stance: "balanced",
        crew: "combat",
        targeting: { mode: { kind: "nearest" }, vulnerableWeight: 0, focusFire: false },
        cohesion: 0,
        retreat: 0,
        spatial: {
          reference: { kind: "target" },
          range: { kind: "hold", band: 0.3 },
          bearing: { kind: "free" },
        },
      },
      rules: [],
    },
    classification: "frigate",
    modules: [
      moduleOf("c", { kind: "power", output: 40 }, 0, 0, true),
      moduleOf("e", { kind: "engine", thrust: 1, facing: Math.PI }, -1, 0),
      moduleOf("r", { kind: "reactionWheel", torque }, 0, 1),
      moduleOf("se", omniSensor(1000), -1 / 3, 1 / 3),
    ],
  };
}

describe("engine.angular-units", () => {
  it("a reaction wheel accelerates rotation in the per-tick clock, not the SI clock", () => {
    // An SI torque chosen on the catalogue's scale of angular authority.
    const torque = 0.5;
    const s = reactionWheelShip("s1", "attacker", { x: 0, y: 0 }, 0, torque);
    const t = reactionWheelShip("t1", "defender", { x: -600, y: 0 }, Math.PI, torque);

    // The engine itself is the source of truth for the ship's commandable torque
    // (mct) and moment of inertia (I). The first integrated tick from rest, with
    // the target directly behind, applies exactly `mct / I` as an angular
    // acceleration — which must land in the per-tick clock.
    const sim = toSimShip(s, mulberry32(1));
    const I = sim.momentOfInertia;
    const mct = maxCommandableTorque(sim, false);
    const expectedFirstTickTurn = (mct / I) * ACCEL_PER_TICK_FROM_SI;

    const inputs: BattleInputs = {
      ships: [s, t],
      attackerFleetId: "a",
      defenderFleetId: "b",
      anomalies: [],
      seed: 1,
      maxTicks: 10,
    };
    const res = runBattle(inputs);
    const facings = res.frames.map(
      (f) => f.ships.find((x) => x.instanceId === "s1")?.facing ?? 0,
    );
    const f0 = facings[0];
    const f1 = facings[1];
    if (f0 === undefined || f1 === undefined) throw new Error("missing frames");
    const firstTickTurn = Math.abs(f1 - f0);

    // The per-tick increment must be the SI angular acceleration rescaled into
    // the tick clock. Before the fix the integrator added the raw `mct / I`
    // (the SI value), which is TICKS_PER_SECOND² (900×) too large.
    expect(firstTickTurn).toBeCloseTo(expectedFirstTickTurn, 6);
  });
});
