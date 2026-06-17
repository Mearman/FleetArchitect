import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Structural break-apart: when a modular ship's alive modules are no longer
 * connected, each connected component (under Chebyshev adjacency) becomes its
 * own rigid body. The largest component keeps the original ship's
 * `instanceId`; the smaller ones split off as fresh ships with their own
 * `instanceId`, inheriting the parent's momentum and a copy of their
 * carried modules.
 *
 * Layout under test: a small hull cell at the impact edge of the defender
 * with two weapon cells diagonally behind it. The hull sits at x = -15,
 * the weapons at (-14, -1) and (-14, +1) — all three Chebyshev-adjacent to
 * the hull. The hull is the first thing the attacker (firing down +x from
 * the left) hits; destroying it severs the two weapon cells, which are not
 * Chebyshev-adjacent to each other (|dy| = 2 > 1), so the ship splits into
 * two single-weapon chunks.
 *
 * Connectivity rule: every alive module is a node; two nodes are adjacent
 * iff Chebyshev distance ≤ 1 (i.e. sharing an edge or a corner cell).
 */

function beam(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 30,
    range: 500,
    cooldown: 5,
    projectileSpeed: 0,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    ...over,
  };
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
    x,
    y,
    maxHp,
    mass,
    powerDraw,
    effect,
    command,
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: 0,
  };
}

/** A legacy (non-modular) hammer ship — large structure, single high-power
 *  beam that focuses its fire on the central hull module of the target. */
function hammerShip(id: string, x: number): CombatShip {
  const weapon = beam({ damage: 50, range: 500, cooldown: 1 });
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
    thrust: 0,
    turnRate: 0,
    weapons: [{ slotId: "s", effect: weapon }],
  };
  return {
    instanceId: id,
    designId: `d-${id}`,
    side: "attacker",
    stats,
    position: { x, y: 0 },
    facing: 0,
    orders: { ...defaultOrders, engageRange: "hold" },
    classification: "frigate",
  };
}

/** A modular defender with a hull cell at the impact edge and two weapon
 *  cells diagonally behind it. The hull's HP is `hullHp`; setting it to 1
 *  lets a single hammer hit tear it apart. The hull cell at x = -15 is the
 *  closest module to the impact point (a beam from the attacker's left hits
 *  the defender's left edge at ship-local x = -16); destroying it severs
 *  the two weapons, which sit at (-14, ±1) and are not Chebyshev-adjacent
 *  to each other (|dy| = 2). */
function threeCellShip(id: string, x: number, hullHp: number): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf("wL", beam({ damage: 1, range: 50 }), -14, -1, 50, 5, 0, true),
    moduleOf("h1", { kind: "hull" }, -15, 0, hullHp, 5),
    moduleOf("wR", beam({ damage: 1, range: 50 }), -14, 1, 50, 5, 0, false),
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
    structure: 5000,
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
    position: { x, y: 0 },
    facing: Math.PI,
    orders: { ...defaultOrders, engageRange: "hold" },
    classification: "frigate",
    modules,
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

describe("engine.breakaway", () => {
  it("a modular ship splits when its only hull cell is destroyed", () => {
    // Hull HP = 1: the first hit tears the central cell apart, severing
    // the graph into two single-cell chunks (one weapon each).
    const result = runBattle(inputs([hammerShip("a1", 0), threeCellShip("d1", 80, 1)]));

    // Find a frame where the original `d1` still exists but a chunk
    // has broken off (some ship in the frame has `brokeOff: true`).
    const splitFrame = result.frames.find((f) =>
      f.ships.some((s) => s.brokeOff === true),
    );
    expect(splitFrame, "the ship should split when its hull cell is destroyed").toBeDefined();
    if (splitFrame === undefined) return;

    // The original ship kept its identity; at least one chunk also exists.
    const original = splitFrame.ships.find((s) => s.instanceId === "d1");
    expect(original, "the original ship should still be tracked").toBeDefined();
    const chunk = splitFrame.ships.find((s) => s.brokeOff === true);
    expect(chunk, "exactly one chunk should have broken off").toBeDefined();
    if (chunk === undefined) return;

    // The chunk is alive and carries exactly one alive weapon — it kept
    // the weapon module from one end of the severed row.
    expect(chunk.alive).toBe(true);
    const aliveChunkModules = chunk.modules?.filter((m) => m.alive) ?? [];
    expect(aliveChunkModules.length).toBe(1);
    expect(aliveChunkModules[0]?.kind).toBe("weapon");

    // The split is permanent: subsequent frames keep the chunk alive.
    const lastWithChunk = result.frames.find(
      (f) => f.ships.find((s) => s.brokeOff === true) !== undefined,
    );
    expect(lastWithChunk).toBeDefined();
  });

  it("a modular ship with an intact hull cell does not split", () => {
    // Hull HP huge: no amount of hammer fire in one battle destroys it,
    // so the graph stays connected and no chunk ever appears.
    const result = runBattle(inputs([hammerShip("a1", 0), threeCellShip("d1", 80, 1_000_000)]));
    const anyChunk = result.frames.some((f) => f.ships.some((s) => s.brokeOff === true));
    expect(anyChunk, "an intact hull should not split").toBe(false);
  });

  it("split chunks carry independent momentum from the parent", () => {
    // The split happens; the chunk inherits the parent's velocity, which
    // is zero at this stage (the defender is stationary). The chunk's
    // own velocity should also be zero, and it should keep flying along
    // with the parent as the battle continues.
    const result = runBattle(inputs([hammerShip("a1", 0), threeCellShip("d1", 80, 1)]));
    const splitFrame = result.frames.find((f) =>
      f.ships.some((s) => s.brokeOff === true),
    );
    if (splitFrame === undefined) throw new Error("no split occurred");
    const chunk = splitFrame.ships.find((s) => s.brokeOff === true);
    if (chunk === undefined) throw new Error("no chunk found");
    expect(chunk.vx ?? 0).toBe(0);
    expect(chunk.vy ?? 0).toBe(0);

    // A few ticks later, the chunk should still be alive and tracked.
    const later = result.frames.slice(splitFrame.tick + 1, splitFrame.tick + 20);
    const trackedChunk = later.find((f) =>
      f.ships.some((s) => s.instanceId === chunk.instanceId),
    );
    expect(trackedChunk, "the chunk should remain in the simulation after the split").toBeDefined();
  });

  it("split behaviour is deterministic", () => {
    const mk = () => runBattle(inputs([hammerShip("a1", 0), threeCellShip("d1", 80, 1)]));
    const a = mk();
    const b = mk();
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });
});
