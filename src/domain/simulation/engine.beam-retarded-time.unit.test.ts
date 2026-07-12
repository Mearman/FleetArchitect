import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { SPEED_OF_LIGHT_M_PER_TICK } from "@/domain/simulation/engine/config";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { Doctrine } from "@/schema/ai";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Retarded-time (finite-speed-of-light) beam weapons. A beam fired at a target
 * beyond one light-tick of range has its damage deferred to
 * `fire_tick + floor(range / c)`. At battlefield scales (tens of km)
 * `range / c < 1` so `floor === 0` and beams resolve same-tick (byte-identical
 * to hitscan); this test stages an engagement at `2 * c` range so the delay is
 * exactly 2 ticks and the deferral is observable.
 */

const HOLD_DOCTRINE: Doctrine = {
  base: {
    spatial: {
      reference: { kind: "target" },
      range: { kind: "hold", band: 0.3 },
      bearing: { kind: "free" },
    },
  },
  rules: [],
};

const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

/** Speed of light in metres per tick (~9.99e6). */
const C = SPEED_OF_LIGHT_M_PER_TICK;
/** Engagement range: 2 light-ticks → floor(2c / c) = 2 ticks of delay. */
const RANGE = 2 * C;

/** Beam damage high enough that the divergence-scaled damage at RANGE is
 *  still clearly measurable (beamDamageFactor(RANGE) ≈ 2.25e-6, so 1e16 →
 *  ~2.25e10 J per strike). */
const BEAM_DAMAGE = 1e16;
/** Defender structure — large enough to survive many strikes. */
const DEFENDER_STRUCTURE = 1e12;

function beam(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 30,
    range: 500,
    cooldown: 5,
    projectileSpeed: 0,
    projectileMass: 0.5,
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
  command: boolean,
  mass = 5,
  powerDraw = 0,
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
    maxSubstrateHp: maxHp,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    maxReactiveHp: 0,
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
    facing: 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

/** A stationary attacker with a beam weapon, a command module, and a sensor
 *  whose reach covers the 2c engagement range. Immobile (thrust 0) so it stays
 *  at its deployment position facing +x toward the defender. */
function attacker(): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf("w1", beam({ damage: BEAM_DAMAGE, range: 2.5 * C, cooldown: 0 }), 12, 0, 50, false),
    moduleOf("c1", { kind: "power", output: 40 }, 0, -12, 20, true),
    moduleOf(
      "se1",
      { kind: "sensor", sensorType: "omni", arc: Math.PI, bearing: 0, detectionRange: 3 * C, nebulaImmune: false },
      0,
      12,
      20,
      false,
    ),
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
    structure: 9999,
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
    compartments: 0,
    airtightCompartments: 0,
  };
  return {
    instanceId: "a1",
    designId: "d-a1",
    faction: "Terran",
    side: "attacker",
    stats,
    position: { x: 0, y: 0 },
    facing: 0,
    doctrine: HOLD_DOCTRINE,
    classification: "frigate",
    modules,
  };
}

/** A stationary target dummy at range 2c from the attacker. No weapons, no
 *  shield, huge structure — the beam's energy goes straight to structure. */
function defender(): CombatShip {
  const stats: ShipStats = {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: DEFENDER_STRUCTURE,
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
    compartments: 0,
    airtightCompartments: 0,
  };
  return {
    instanceId: "d1",
    designId: "d-d1",
    faction: "Terran",
    side: "defender",
    stats,
    position: { x: RANGE, y: 0 },
    facing: Math.PI,
    doctrine: HOLD_DOCTRINE,
    classification: "frigate",
  };
}

function inputs(ships: CombatShip[]): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomalies: [],
    seed: 1,
    maxTicks: DEFAULT_MAX_TICKS,
  };
}

describe("engine.beam-retarded-time", () => {
  // Staged at 2 light-ticks of range, this battle runs on a light-second-scale
  // arena whose medium field makes each tick far heavier than a normal preset
  // engagement. It is genuinely slow (normally well under the default 30s, but
  // a loaded CI runner can push it past 30s and flake the gate), so give it a
  // generous timeout rather than tightening the scenario and risking the
  // acquisition timing the assertion depends on.
  it(
    "a beam at range > c defers damage by floor(range/c) ticks",
    { timeout: 120_000 },
    () => {
    const result = runBattle(inputs([attacker(), defender()]));

    // Find the first tick where the defender's structure drops — that is the
    // tick the first beam's light front arrives. With delay = 2, no damage can
    // appear before tick 3 (tick 1 fire + 2-tick flight) at the earliest.
    let damageTick = -1;
    for (let i = 1; i < result.frames.length; i++) {
      const d = result.frames[i]?.ships.find((s) => s.instanceId === "d1");
      if (d !== undefined && d.structure < DEFENDER_STRUCTURE) {
        damageTick = i;
        break;
      }
    }
    // The beam must eventually land (the weapon fires once the awareness phase
    // acquires the defender; the light-lagged acquisition may take a few ticks).
    expect(damageTick).toBeGreaterThan(0);

    // Every tick before the damage tick: the beam is in flight and the
    // defender's structure is unchanged.
    for (let t = 1; t < damageTick; t++) {
      const d = result.frames[t]?.ships.find((s) => s.instanceId === "d1");
      expect(d?.structure).toBe(DEFENDER_STRUCTURE);
    }

    // The delay is at least 2 ticks (range / c = 2): the weapon cannot fire
    // before tick 1, so damage cannot appear before tick 3.
    expect(damageTick).toBeGreaterThanOrEqual(3);
  });
});
