import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { PERF_GUARDS } from "@/domain/simulation/engine/perf-guards";
import { CELL_SIZE } from "@/domain/grid";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { catalog } from "@/data/catalog";
import { presetDesigns, presetFleets } from "@/data/presets";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { BattleInputs } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { CellEdges } from "@/schema/grid";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * W5b: the O(C^2)-bounding guards (chain-reaction spatial pre-filter, bounded
 * brownout cut) must be pure optimisations — the engine produces byte-identical
 * frames with each guard on or off.
 *
 * Each guard is exercised by a targeted synthetic close-range fixture that
 * places ships within weapon range from tick one, ensuring the guard path is
 * actually traversed within 5–10 ticks. A single small preset pair (Phase
 * Lance vs Iron Wall, the smallest by ship count) runs for 3 ticks as an
 * end-to-end sanity check. Total wall time well under 60 s.
 *
 * Guard descriptions:
 *  - chainReactionSpatial: use a spatial pre-filter for blast targets instead
 *    of scanning every cell. Triggered when a volatile cell (magazine/reactor)
 *    is destroyed.
 *  - brownoutBounded: sort power-draw candidates once rather than re-scanning
 *    per cut. Triggered when power demand exceeds supply.
 *
 * Geometry note
 * =============
 * All fixtures share the same axis convention:
 *  - Attacker at world (0, 0) facing RIGHT (facing = 0).
 *  - Defender at world (80, 0) facing RIGHT (facing = 0) too (no frame flip).
 *  - With no outline polygon (bare modules) the beam fallback impact is at:
 *      ix = target.x + dirX * radius = 80 + radius,  iy = 0
 *    In local space (facing=0, no rotation): local.x = ix − 80 = +radius.
 *    A module at col = +1 (local (+1, 0)) is distance (radius − 1) from the
 *    impact; a module at col = 0 is distance radius. The col=+1 cell is
 *    therefore NEAREST the impact and is always struck first.
 */

const OPEN: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };

/** Build a ResolvedModule at integer grid coords. World position is derived
 *  from col/row so adjacency and blast geometry are consistent. */
function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  maxSubstrateHp: number,
  mass = 5,
  command = false,
  powerDraw = 0,
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    x: col * CELL_SIZE,
    y: row * CELL_SIZE,
    surface: "bare",
    edges: OPEN,
    maxSurfaceHp: 0,
    maxSubstrateHp,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    mass,
    powerDraw,
    crewRequired: 0,
    effect,
    command,
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
    thrust: 0,
    turnRate: 0,
    weapons: [],
    compartments: 0,
    airtightCompartments: 0,
    ...over,
  };
}

function combatShip(
  id: string,
  side: "attacker" | "defender",
  modules: ResolvedModule[],
  position: { x: number; y: number },
  facing: number,
  over: Partial<CombatShip> = {},
): CombatShip {
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side,
    stats: stats(),
    position,
    facing,
    orders: { ...defaultOrders, engageRange: "hold" },
    classification: "frigate",
    modules,
    shipStance: "balanced",
    crewPriority: "combat",
    rules: [],
    ...over,
  };
}

/** A hitscan beam weapon: high damage, well within range. Ships 80 m apart are
 *  well inside the 320 m range, so the beam fires from the first tick. */
const BEAM: WeaponEffect = {
  kind: "weapon",
  weaponType: "beam",
  damage: 60,
  range: 320,
  cooldown: 1,
  projectileSpeed: 0,
  projectileMass: 0.5,
  tracking: 0,
  shieldPiercing: 1,
  armourPiercing: 1,
  spread: 0,
  facing: 0,
};

function battleInputs(ships: CombatShip[], seed = 1, maxTicks = 15): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomalies: [],
    seed,
    maxTicks,
  };
}

/** Run a battle and return a SHA-256 digest of the serialised frame stream. */
function frameHash(inputs: BattleInputs): string {
  const result = runBattle({ ...inputs, ships: structuredClone(inputs.ships) });
  return createHash("sha256").update(JSON.stringify(result.frames)).digest("hex");
}

/** Assert that a battle produces byte-identical frames with every guard on vs
 *  off. Returns the naive hash for any further assertion by the caller. */
function assertGuardIdempotence(inputs: BattleInputs): string {
  Object.assign(PERF_GUARDS, {
    chainReactionSpatial: false,
    brownoutBounded: false,
    resourceModuleIndex: false,
  });
  const naive = frameHash(inputs);

  Object.assign(PERF_GUARDS, {
    chainReactionSpatial: true,
    brownoutBounded: true,
    resourceModuleIndex: true,
  });
  const optimised = frameHash(inputs);

  expect(optimised).toBe(naive);
  return naive;
}

/** Assert byte-identical frames toggling ONLY `resourceModuleIndex`, leaving the
 *  other guards on (so the new path is exercised against the established
 *  production paths rather than against the naive everything-off baseline). */
function assertResourceModuleIndexIdempotence(inputs: BattleInputs): void {
  // Optimised path: flag on (production default), all other guards on too.
  Object.assign(PERF_GUARDS, {
    chainReactionSpatial: true,
    brownoutBounded: true,
    resourceModuleIndex: true,
  });
  const optimised = frameHash(inputs);

  // Oracle path: flag off, all other guards still on.
  Object.assign(PERF_GUARDS, {
    chainReactionSpatial: true,
    brownoutBounded: true,
    resourceModuleIndex: false,
  });
  const naive = frameHash(inputs);

  expect(optimised).toBe(naive);
}

/** Build a standard attacker: a reactor (command, bridge) at col=0,row=0 and a
 *  beam weapon at col=0,row=1, parked at world (0, 0) and facing right (0). */
function standardAttacker(id: string): CombatShip {
  return combatShip(
    id,
    "attacker",
    [
      moduleOf("ac", { kind: "power", output: 10_000 }, 0, 0, 5_000, 5, true),
      moduleOf("aw", BEAM, 0, 1, 5_000),
    ],
    { x: 0, y: 0 },
    0,
  );
}

describe("W5b perf guards preserve frame output", () => {
  const original = { ...PERF_GUARDS };
  afterEach(() => {
    Object.assign(PERF_GUARDS, original);
  });

  // -------------------------------------------------------------------------
  // Fixture B: chainReactionSpatial guard
  //
  // Impact geometry (see geometry note above):
  //   The beam travels right (+x). The fallback impact is at
  //   target.x + dirX * radius = 80 + radius (RIGHT / far side in world).
  //   In local space (facing=0, no flip): local.x = ix − 80 = +radius.
  //   A module at col=+1 (local +1, 0) is distance (radius − 1) from the
  //   impact; a module at col=0 is distance radius. So col=+1 is NEAREST.
  //
  // The magazine sits at col=+1; the command cell is at col=0. The beam
  // strikes the magazine first (distance 0.5 vs 1.5), destroying it in one
  // hit (HP 40, beam damage 60). The detonation blasts the adjacent command
  // cell. chainReactionSpatial on vs off must give byte-identical frames.
  //
  // Module layout (local, defender facing 0 — same as attacker):
  //   col=0  ← command reactor (high HP, distance 1.5 from impact)
  //   col=+1 ← magazine (low HP — NEAREST the impact at distance 0.5)
  // -------------------------------------------------------------------------
  it("chainReactionSpatial guard: frames are byte-identical when a volatile module detonates", () => {
    // Defender facing 0 (right, same frame as attacker). Magazine at col=+1 is
    // on the far (right) side in local space and therefore nearest the beam
    // impact — it is struck first and destroyed by a single 60-damage hit.
    const defender = combatShip(
      "def-chain",
      "defender",
      [
        moduleOf("dc", { kind: "power", output: 1_000 }, 0, 0, 5_000, 5, true), // command, high HP
        moduleOf("dm", { kind: "magazine", ammoStored: 10 }, 1, 0,  40),         // volatile, low HP — struck first
      ],
      { x: 80, y: 0 },
      0,          // facing right (same as attacker), no frame flip
    );

    const inputs = battleInputs([standardAttacker("atk-chain"), defender]);
    assertGuardIdempotence(inputs);

    // Sanity: the magazine must detonate within the run.
    Object.assign(PERF_GUARDS, {
      chainReactionSpatial: false,
      brownoutBounded: false,
    });
    const result = runBattle({ ...inputs, ships: structuredClone(inputs.ships) });
    const magDied = result.frames.some((f) => {
      const ship = f.ships.find((s) => s.instanceId === "def-chain");
      return (ship?.cells ?? []).some((c) => c.slotId === "dm" && !c.alive);
    });
    expect(magDied, "the magazine must be destroyed for the chain-reaction guard to fire").toBe(true);
  });

  // -------------------------------------------------------------------------
  // Fixture C: brownoutBounded guard
  //
  // A ship whose weapon modules' combined power draw exceeds the reactor's
  // output forces a brownout cut every tick from the first recomputeAggregates
  // call. With brownoutBounded on the engine pre-sorts candidates once per
  // brownout; with it off it re-scans per cut. Both paths yield the same
  // victims in the same order, so frames must be byte-identical.
  //
  // Setup:
  //   reactor (bc): output 50 W
  //   weapon 1 (bw1): powerDraw 80 W — cut first (hungriest)
  //   weapon 2 (bw2): powerDraw 40 W — cut second (demand 150→70→30 ≤ 50)
  //
  // After both cuts demand (30) ≤ supply (50), so neither weapon fires. The
  // dummy defender has near-infinite HP and is never killed, so the battle
  // runs to maxTicks. The key assertion is that the guard paths agree.
  //
  // The brownout guard controls recomputeAggregates' cut loop in physics.ts,
  // which sets m.powered = false for the victims. Both paths produce the same
  // powered/unpowered assignment, so frames are byte-identical.
  // -------------------------------------------------------------------------
  it("brownoutBounded guard: frames are byte-identical when power demand exceeds supply", () => {
    // Reactor output 50 W; two weapons draw 80+40 = 120 W → brownout from tick 1.
    const weaponEffect: WeaponEffect = { ...BEAM, damage: 1 };
    const brownoutShip = combatShip(
      "brownout",
      "attacker",
      [
        moduleOf("bc",  { kind: "power", output: 50 }, 0,  0, 5_000, 5, true),
        moduleOf("bw1", weaponEffect,                  1,  0, 5_000, 5, false, 80),
        moduleOf("bw2", weaponEffect,                  0,  1, 5_000, 5, false, 40),
      ],
      { x: 0, y: 0 },
      0,
    );

    // Near-indestructible single-cell defender so the battle runs to maxTicks
    // (proving the brownout-cut weapons deal no damage, which the byte-identical
    // frame assertion verifies implicitly).
    const dummyDefender = combatShip(
      "dummy-def",
      "defender",
      [
        moduleOf("tc", { kind: "hull" }, 0, 0, 999_999_999, 5, true),
      ],
      { x: 80, y: 0 },
      Math.PI,
      { stats: stats({ structure: 999_999_999 }) },
    );

    const inputs = battleInputs([brownoutShip, dummyDefender], 3, 10);
    assertGuardIdempotence(inputs);

    // Sanity: brownout cuts both weapons so no damage reaches the dummy, which
    // therefore survives all 10 ticks. The battle resolves by leadingSide;
    // both sides have comparable structure so the result can be anything, but
    // the dummy's near-infinite HP means it is not "defender" (the dummy
    // survived). The invariant we care about is frame identicality, already
    // verified above; this check merely confirms the battle ran at all.
    Object.assign(PERF_GUARDS, {
      chainReactionSpatial: false,
      brownoutBounded: false,
    });
    const result = runBattle({ ...inputs, ships: structuredClone(inputs.ships) });
    expect(result.ticks).toBe(10); // battle ran to full duration, not an early kill
  });

  // -------------------------------------------------------------------------
  // Fixture D: resourceModuleIndex guard
  //
  // The per-tick resource step resolves each module to its dense transport
  // index many times per module per tick. With `resourceModuleIndex` on it
  // reads the `m.transportIndex` field that `makeResourceState` cached; with
  // it off it allocates a `"col,row"` template string and hashes the
  // `moduleIndex` map per call. The cache IS the map's value, so the two paths
  // return the same index — but only a real run exercises the path at scale
  // (every alive reactor, engine, deck cell, and crew cell on every modular
  // ship, every tick).
  //
  // The heaviest preset pair (Drone Swarm vs Nexus Armada, 19 ships) is the
  // workload the profiler flagged: it drives the resource step hardest and so
  // stresses the optimised lookup across the most modules and the most ticks
  // in the test suite. Running it twice on one resolved snapshot — flag on vs
  // flag off — and asserting byte-identical frames proves the precomputed
  // index agrees with the map under realistic load.
  // -------------------------------------------------------------------------
  it("resourceModuleIndex guard: heaviest preset pair is byte-identical over multiple ticks", () => {
    const designs = new Map(presetDesigns.map((d) => [d.id, d]));
    const droneSwarm = presetFleets.find((f) => f.id === "preset-fleet-drone-swarm");
    const nexusArmada = presetFleets.find((f) => f.id === "preset-fleet-nexus-armada");
    if (droneSwarm === undefined || nexusArmada === undefined) {
      throw new Error("heaviest preset fleets not found");
    }
    const snapshot = [
      ...resolveFleetToCombatShips(droneSwarm,  designs, catalog(), "attacker"),
      ...resolveFleetToCombatShips(nexusArmada, designs, catalog(), "defender"),
    ];
    // Several seeds so the A/B covers different AI / damage paths, each of
    // which drives the resource step through different module subsets. A
    // handful of ticks is enough to exercise the lookup across the opening
    // exchange (where the most modules are still alive and the per-module
    // lookup count peaks) without making the test slow.
    for (const seed of [1, 7, 99]) {
      const inputs: BattleInputs = {
        ships: snapshot,
        attackerFleetId: droneSwarm.id,
        defenderFleetId: nexusArmada.id,
        anomalies: [],
        seed,
        maxTicks: 4,
      };
      assertResourceModuleIndexIdempotence(inputs);
    }
  });

  // -------------------------------------------------------------------------
  // Safety-net: one small preset fleet pair for end-to-end frame identicality.
  //
  // Phase Lance (4 Shards) vs Iron Wall (4 Anvils) is the smallest pair by
  // total ship count. At 3 ticks this is fast and covers the multi-ship
  // realistic path (AI, movement, sensor resolution) without guard exercise.
  // -------------------------------------------------------------------------
  it("preset safety net: Phase Lance vs Iron Wall is byte-identical over 3 ticks", () => {
    const designs = new Map(presetDesigns.map((d) => [d.id, d]));
    const fleets = presetFleets;
    const phaseLance = fleets.find((f) => f.id === "preset-fleet-concord");
    const ironWall   = fleets.find((f) => f.id === "preset-fleet-foundry");
    if (phaseLance === undefined || ironWall === undefined) {
      throw new Error("preset fleets not found");
    }
    const snapshot = [
      ...resolveFleetToCombatShips(phaseLance, designs, catalog(), "attacker"),
      ...resolveFleetToCombatShips(ironWall,   designs, catalog(), "defender"),
    ];
    for (const seed of [1, 7, 99]) {
      const inputs: BattleInputs = {
        ships: snapshot,
        attackerFleetId: phaseLance.id,
        defenderFleetId: ironWall.id,
        anomalies: [],
        seed,
        maxTicks: 3,
      };
      assertGuardIdempotence(inputs);
    }
  });
});
