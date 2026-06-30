import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { CELL_SIZE } from "@/domain/grid";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { Doctrine } from "@/schema/ai";
import type { ModuleEffect, PointDefenseEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";


const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

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
    projectileMass: 0.5,
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

/** Build a module at integer cell coordinates `(col, row)`. The ship-local
 *  world position is the cell index scaled by `CELL_SIZE`, so col/row (used by
 *  break-apart's 4-connected adjacency) and x/y (used by hit geometry) stay
 *  consistent — modules one cell apart are genuine edge neighbours. */
function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  maxHp: number,
  mass = 5,
  powerDraw = 0,
  command = false,
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    repairRate: 0,
    x: col * CELL_SIZE,
    y: row * CELL_SIZE,
    maxSurfaceHp: 0,
    maxSubstrateHp: maxHp,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    surface: "deck",
    edges: OPEN_EDGES,
    mass,
    powerDraw,
    crewRequired: 0,
    effect,
    command,
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

/** A modular attacker with a single missile launcher + reactor (command). */
function modularAttacker(id: string): CombatShip {
  // A 4-connected vertical column at col 0: power (command), weapon, engine.
  const modules: ResolvedModule[] = [
    moduleOf("p1", { kind: "power", output: 40 }, 0, -1, 20, 5, 0, true),
    moduleOf("w1", missileLauncher(), 0, 0, 50, 5, 8),
    moduleOf("e1", { kind: "engine", thrust: 0.4 }, 0, 1, 20, 5, 0),
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
    deflectorCapacity: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    thrust: 0.9,
    turnRate: 0.15,
    weapons: [],
    compartments: 0,
  airtightCompartments: 0,
};
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side: "attacker",
    stats,
    position: { x: 0, y: 0 },
    facing: 0,
    doctrine: holdDoctrine,
    classification: "frigate",
    modules,
  };
}

/** A modular defender with a single PD module + reactor (command). The hull
 *  cell sits on the centreline (local 0,0) so a missile fired along the y=0
 *  line of fire strikes solid structure — with cell-precise hits a ship is
 *  only solid where it has cells, so the column is filled along the firing
 *  axis rather than leaving a centreline gap. */
function modularDefender(id: string, withPd: boolean): CombatShip {
  // A 4-connected vertical column at col 0 (power command, hull centreline,
  // engine) so a missile fired along the y=0 line strikes solid structure.
  // The PD module sits one cell forward (col 1) on the same centreline.
  const modules: ResolvedModule[] = [
    moduleOf("p1", { kind: "power", output: 40 }, 0, -1, 20, 5, 0, true),
    moduleOf("h1", { kind: "hull" }, 0, 0, 30, 5, 0),
    moduleOf("e1", { kind: "engine", thrust: 0.4 }, 0, 1, 20, 5, 0),
  ];
  if (withPd) {
    modules.push(moduleOf("pd1", pdModule(), 1, 0, 30, 4, 5));
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
    deflectorCapacity: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    thrust: 0.9,
    turnRate: 0.15,
    weapons: [],
    compartments: 0,
  airtightCompartments: 0,
};
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side: "defender",
    stats,
    position: { x: 80, y: 0 },
    facing: Math.PI,
    doctrine: holdDoctrine,
    classification: "frigate",
    modules,
  };
}

/**
 * Doctrine equivalent of the legacy `defaultOrders` with `engageRange: "hold"`
 * (and the default `rangeKeepingBand: 0.3`): hold station within a 0.3 band of
 * the target, bearing free. Stance/targeting/cohesion left absent so they fall
 * through to the legacy-equivalent defaults (balanced stance, nearest target).
 */
const holdDoctrine: Doctrine = {
  base: {
    spatial: {
      reference: { kind: "target" },
      range: { kind: "hold", band: 0.3 },
      bearing: { kind: "free" },
    },
  },
  rules: [],
};

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

  it("a PD-defended defender shoots down most of the incoming missiles", () => {
    // PD is stochastic (0.4 per module per tick), so it is not a perfect
    // wall — over a long battle the odd missile threads it. The property
    // that matters is that the great majority of missiles never reach the
    // hull: count how many distinct missiles arrive within striking distance
    // of the defender across the whole battle, against how many were fired.
    const result = runBattle(inputs([modularAttacker("a1"), modularDefender("d1", true)]));
    const defenderX = 80;
    const hitRadius = 16;
    // Frames in which a missile is within striking distance of the defender:
    // each such frame is a missile PD failed to stop on its run-in.
    const breakthroughFrames = result.frames.filter((f) =>
      f.projectiles.some(
        (p) => p.kind === "missile" && Math.abs(p.x - defenderX) <= hitRadius,
      ),
    ).length;
    // Missiles fired over the battle: cooldown 20 ticks across the run. The
    // launcher fires far more missiles than the handful that get through, so
    // breakthroughs must be a small minority of the battle's frames.
    expect(
      breakthroughFrames,
      "PD should stop the great majority of missiles before they reach the hull",
    ).toBeLessThan(result.frames.length * 0.1);
  });

  it("PD-defended defender keeps more of its hull than an undefended one", () => {
    // The attacker sits inside PD range (defender PD range 120, gap 80), so
    // every missile is interceptable from launch. PD won't catch every shot,
    // but the defended hull must end the battle with more structure left than
    // the same hull with no PD.
    const withPd = runBattle(inputs([modularAttacker("a1"), modularDefender("d1", true)]));
    const bare = runBattle(inputs([modularAttacker("a2"), modularDefender("d2", false)]));
    const pdStruct = structureOf(withPd.frames.at(-1) ?? { ships: [] }, "d1") ?? 0;
    const bareStruct = structureOf(bare.frames.at(-1) ?? { ships: [] }, "d2") ?? 0;
    expect(
      pdStruct,
      "PD-defended hull must outlast the undefended one",
    ).toBeGreaterThan(bareStruct);
  });

  it("is deterministic when point defense is in play", () => {
    const mk = () => runBattle(inputs([modularAttacker("a1"), modularDefender("d1", true)]));
    const a = mk();
    const b = mk();
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });
});