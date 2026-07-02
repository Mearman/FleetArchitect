/**
 * Equivalence test for the two parallel roster-refresh implementations.
 *
 * {@link refreshRosterReference} (the oracle) rebuilds unconditionally;
 * {@link refreshRosterIncremental} rebuilds only when the ships array has grown
 * (detected via the derived signal `attackers.length + defenders.length !==
 * ships.length`). Both must leave the roster views identical after every call,
 * whether the ships array grew or not. This test proves that equivalence and
 * verifies the skip/rebuild behaviour of the incremental path.
 */
import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/domain/simulation/rng";
import { buildArenaMedium } from "@/domain/simulation/engine/medium-setup";
import { toSimShip } from "@/domain/simulation/engine/setup";
import { freshAwarenessScratch } from "@/domain/simulation/engine/awareness";
import { SpatialHash } from "@/domain/simulation/spatial-hash";
import { newCollisionScratch } from "@/domain/simulation/engine/collision";
import type { ShipCell } from "@/domain/simulation/engine/collision";
import {
  refreshRosterIncremental,
  refreshRosterReference,
} from "@/domain/simulation/engine/roster";
import type { EngineState } from "@/domain/simulation/engine/state";
import type { SimShip } from "@/domain/simulation/engine/types";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { ShipStats } from "@/domain/stats";
import type { CellEdges } from "@/schema/grid";
import type { ModuleEffect } from "@/schema/module";

const OPEN: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };

/** A single hull module so the CombatShip satisfies the modular shape. */
function hullModule(slotId: string): ResolvedModule {
  const effect: ModuleEffect = { kind: "hull" };
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col: 0,
    row: 0,
    x: 0,
    y: 0,
    surface: "bare",
    edges: OPEN,
    maxSurfaceHp: 0,
    maxSubstrateHp: 1_000,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    maxReactiveHp: 0,
    mass: 5,
    powerDraw: 0,
    crewRequired: 0,
    effect,
    command: true,
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
    compartments: 0,
    airtightCompartments: 0,
    ...over,
  };
}

function buildSimShip(id: string, side: "attacker" | "defender"): SimShip {
  const combat: CombatShip = {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side,
    stats: stats(),
    position: { x: 0, y: 0 },
    facing: 0,
    classification: "frigate",
    modules: [hullModule(`${id}-h`)],
    // Empty doctrine is legacy-equivalent (stance → balanced fallback,
    // crew → combat, targeting → nearest) and is all the roster mechanics
    // under test here require.
    doctrine: { base: {}, rules: [] },
  };
  return toSimShip(combat, mulberry32(1));
}

/** Construct a minimal EngineState with the given ships and empty roster views. */
function stateWith(ships: SimShip[]): EngineState {
  return {
    ships,
    attackers: [],
    defenders: [],
    byId: new Map(),
    deployment: { attacker: { x: 0, y: 0 }, defender: { x: 0, y: 0 } },
    points: new Map(),
    projectiles: [],
    mines: [],
    pods: [],
    pulses: [],
    emissions: [],
    debris: [],
    beams: [],
    particles: [],
    medium: buildArenaMedium(ships),
    chunkSeq: 0,
    mineSeq: 0,
    podSeq: 0,
    phantomSeq: 0,
    pulseSeq: 0,
    emissionSeq: 0,
    debrisSeq: 0,
    ticks: 0,
    ticksSinceLastDeath: 0,
    winner: "draw",
    resolved: false,
    asteroidDiscs: [],
    asteroidSourceCells: [],
    dynamicOccluderScratch: [],
    aliveAtTickStartScratch: new Set(),
    aliveRealSortedScratch: [],
    projectileMediumScratch: [],
    awarenessScratch: freshAwarenessScratch(),
    shipCellHashScratch: new SpatialHash<ShipCell>(),
    collisionScratch: newCollisionScratch(),
  };
}

/** Extract a comparable snapshot of the roster views: id lists and ship refs. */
function rosterSnapshot(state: EngineState): {
  attackerIds: string[];
  defenderIds: string[];
  byIds: string[];
  attackerRefs: SimShip[];
  defenderRefs: SimShip[];
} {
  return {
    attackerIds: state.attackers.map((s) => s.instanceId),
    defenderIds: state.defenders.map((s) => s.instanceId),
    byIds: [...state.byId.keys()],
    attackerRefs: [...state.attackers],
    defenderRefs: [...state.defenders],
  };
}

describe("roster refresh: parallel implementations are equivalent", () => {
  it("produce identical roster views after a fresh rebuild", () => {
    const ships = [
      buildSimShip("a1", "attacker"),
      buildSimShip("d1", "defender"),
      buildSimShip("a2", "attacker"),
    ];
    const refState = stateWith(structuredClone(ships));
    const incState = stateWith(structuredClone(ships));

    refreshRosterReference(refState);
    refreshRosterIncremental(incState);

    expect(rosterSnapshot(incState)).toEqual(rosterSnapshot(refState));
  });

  it("produce identical roster views after growth", () => {
    const ships = [
      buildSimShip("a1", "attacker"),
      buildSimShip("d1", "defender"),
    ];
    const refState = stateWith(structuredClone(ships));
    const incState = stateWith(structuredClone(ships));

    // Initial rebuild so both start in sync.
    refreshRosterReference(refState);
    refreshRosterIncremental(incState);

    // Grow: push a new attacker onto ships.
    const newcomer = buildSimShip("a3", "attacker");
    refState.ships.push(newcomer);
    incState.ships.push(structuredClone(newcomer));

    refreshRosterReference(refState);
    refreshRosterIncremental(incState);

    expect(rosterSnapshot(incState)).toEqual(rosterSnapshot(refState));
  });

  it("incremental path skips the rebuild when the count is unchanged", () => {
    const ships = [buildSimShip("a1", "attacker"), buildSimShip("d1", "defender")];
    const state = stateWith(ships);

    // Prime the roster so attackers + defenders === ships.length.
    refreshRosterIncremental(state);
    expect(state.attackers.length + state.defenders.length).toBe(state.ships.length);

    // Sentinel: replace the roster arrays with a distinctive marker so we can
    // detect whether the incremental path overwrites them.
    const sentinelArray: SimShip[] = [ships[0]!];
    state.attackers = sentinelArray;
    state.defenders = sentinelArray;

    refreshRosterIncremental(state);

    // No growth → the arrays must be untouched (still the sentinel).
    expect(state.attackers).toBe(sentinelArray);
    expect(state.defenders).toBe(sentinelArray);
  });

  it("incremental path rebuilds after growth", () => {
    const ships = [buildSimShip("a1", "attacker"), buildSimShip("d1", "defender")];
    const state = stateWith(ships);

    // Prime the roster.
    refreshRosterIncremental(state);
    const primedAttackers = state.attackers;

    // Grow: push a new defender.
    state.ships.push(buildSimShip("d2", "defender"));

    refreshRosterIncremental(state);

    // Rebuild fired: the attackers array was reallocated (filter returns a new
    // array) and the roster now reflects the grown ships.
    expect(state.attackers).not.toBe(primedAttackers);
    expect(state.defenders.map((s) => s.instanceId)).toEqual(["d1", "d2"]);
    expect(state.byId.size).toBe(3);
  });
});
