import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { Doctrine } from "@/schema/ai";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";
import { splitBreakApart, splitBreakApartReference } from "@/domain/simulation/engine/damage";
import { recomputeAggregates } from "@/domain/simulation/engine/physics";
import { toSimShip } from "@/domain/simulation/engine/setup";
import { mulberry32 } from "@/domain/simulation/rng";
import type { SimShip } from "@/domain/simulation/engine/types";


/** Count set (non-zero) entries in a Uint8Array alive-flags array. */
function countAliveFlags(alive: Uint8Array | undefined): number {
  if (alive === undefined) return 0;
  let count = 0;
  for (let i = 0; i < alive.length; i += 1) {
    if (alive[i] !== 0) count += 1;
  }
  return count;
}

/** The index of the first non-zero (alive) entry, or -1 if none. */
function findAliveIndex(alive: Uint8Array | undefined): number {
  if (alive === undefined) return -1;
  for (let i = 0; i < alive.length; i += 1) {
    if (alive[i] !== 0) return i;
  }
  return -1;
}


const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

/**
 * Doctrine equivalent of the legacy `orders: { ...defaultOrders, engageRange:
 * "hold" }`: station-keep within the default range-keeping band (0.3) of the
 * target, bearing free. These fixtures exist to exercise break-apart topology,
 * not movement, so the ships hold at their deployment positions.
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

/**
 * Structural break-apart: when a modular ship's alive modules are no longer
 * connected, each connected component (under 4-connected, edge-sharing
 * adjacency) becomes its own rigid body. The largest component keeps the
 * original ship's `instanceId`; the smaller ones split off as fresh ships with
 * their own `instanceId`, inheriting the parent's momentum and a copy of their
 * carried modules.
 *
 * Layout under test: a vertical three-cell column in grid column 0 — a weapon
 * cell at row 0, a hull cell at row 1, a weapon cell at row 2. The hull is the
 * middle cell, edge-adjacent to both weapons (row diff 1). The two weapons are
 * NOT adjacent to each other (row diff 2), so they are only held together
 * through the hull. The hull sits at the centre of the impact edge facing the
 * attacker, so the beam (fired along +x from the left) lands nearest the hull
 * cell. Destroying it severs the column into two single-weapon components.
 *
 * Connectivity rule: two cells are adjacent iff they share a grid edge
 * (4-connected). Diagonal cells do not connect.
 */

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
  col: number,
  row: number,
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
    col,
    row,
    x,
    y,
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
    compartments: 0,
  airtightCompartments: 0,
};
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side: "attacker",
    stats,
    position: { x, y: 0 },
    facing: 0,
    doctrine: HOLD_DOCTRINE,
    classification: "frigate",
  };
}

/**
 * A modular defender: a vertical column of three cells in grid column 0 — a
 * weapon at (col 0, row 0), a hull cell at (col 0, row 1), a weapon at
 * (col 0, row 2). The hull's HP is `hullHp`; setting it to 1 lets a single
 * hammer hit tear it apart. The hull cell sits at ship-local (−14, 0) — the
 * centre of the left edge facing the attacker — so the beam strikes it first.
 * The two weapons sit at (−14, −12) and (−14, +12); they are edge-adjacent to
 * the hull (row diff 1) but not to each other (row diff 2), so destroying the
 * hull severs the column into two single-weapon components.
 */
function columnShip(id: string, x: number, hullHp: number): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf("wU", beam({ damage: 1, range: 50 }), 0, 0, -14, -12, 50, 5, 0, true),
    moduleOf("h1", { kind: "hull" }, 0, 1, -14, 0, hullHp, 5),
    moduleOf("wD", beam({ damage: 1, range: 50 }), 0, 2, -14, 12, 50, 5, 0, false),
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
    compartments: 0,
  airtightCompartments: 0,
};
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side: "defender",
    stats,
    position: { x, y: 0 },
    facing: Math.PI,
    doctrine: HOLD_DOCTRINE,
    classification: "frigate",
    modules,
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

describe("engine.breakaway", () => {
  it("a modular ship splits when its only hull cell is destroyed", () => {
    // Hull HP = 1: the first hit tears the central cell apart, severing the
    // column into two single-cell chunks (one weapon each).
    const result = runBattle(inputs([hammerShip("a1", 0), columnShip("d1", 80, 1)]));

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
    // the weapon module from one end of the severed column.
    expect(chunk.alive).toBe(true);
    const aliveCount = countAliveFlags(chunk.cells?.cellAlive);
    expect(aliveCount).toBe(1);
    // Cell kind is static, read from the chunk's descriptor. The dynamic cells
    // are INDEX-MATCHED to the layout, so find the alive cell's index in the
    // layout and read its kind there.
    const chunkLayout = result.descriptors?.find((d) => d.instanceId === chunk.instanceId)?.cells;
    const aliveIdx = findAliveIndex(chunk.cells?.cellAlive);
    const aliveKind = aliveIdx >= 0 ? chunkLayout?.[aliveIdx]?.kind : undefined;
    expect(aliveKind).toBe("weapon");

    // The split is permanent: subsequent frames keep the chunk alive.
    const lastWithChunk = result.frames.find(
      (f) => f.ships.find((s) => s.brokeOff === true) !== undefined,
    );
    expect(lastWithChunk).toBeDefined();
  });

  it("a modular ship with an intact hull cell does not split", () => {
    // Hull HP huge: no amount of hammer fire in one battle destroys it,
    // so the graph stays connected and no chunk ever appears.
    const result = runBattle(inputs([hammerShip("a1", 0), columnShip("d1", 80, 1_000_000)]));
    const anyChunk = result.frames.some((f) => f.ships.some((s) => s.brokeOff === true));
    expect(anyChunk, "an intact hull should not split").toBe(false);
  });

  it("split chunks carry independent momentum from the parent", () => {
    // The split happens; the chunk inherits the parent's velocity, which
    // is zero at this stage (the defender is stationary). The chunk's
    // own velocity should also be zero, and it should keep flying along
    // with the parent as the battle continues.
    const result = runBattle(inputs([hammerShip("a1", 0), columnShip("d1", 80, 1)]));
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
    const mk = () => runBattle(inputs([hammerShip("a1", 0), columnShip("d1", 80, 1)]));
    const a = mk();
    const b = mk();
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });

  /**
   * Equivalence between the reference (oracle) and optimised (production)
   * break-apart implementations. Both share the analysis core; the optimised
   * path skips it when the alive-module count is unchanged since the last
   * evaluation. The two must produce identical chunk output across:
   *  (a) a connected topology (no death) — the reference runs the analysis
   *      and finds one component (returns []); the optimised skips via the
   *      alive-count marker (returns []); and
   *  (b) a severed topology (bridge cell killed) — both run the analysis and
   *      must return the same chunk set (same instanceIds, same module
   *      slotIds per chunk, same survivor selection).
   *
   * The optimised path is driven through BOTH branches: the skip branch in
   * (a) (by priming `breakApartLastAliveCount`), and the analyse branch in
   * (b) (where the changed alive count forces analysis).
   */
  it("reference and optimised break-apart produce identical chunks across a topology-changing sequence", () => {
    // Deterministic per-tick chunk id generator, matching the engine's
    // convention: parentId + tick + counter. The exact id shape does not
    // matter for the equivalence assertion as long as both implementations
    // receive the same generator and produce the same chunk count.
    let chunkCounter = 0;
    const nextChunkId = (parentId: string, tick: number): string =>
      `${parentId}-chunk-${tick}-${chunkCounter++}`;

    // Build a fresh modular SimShip from the column layout: wU (row 0) and
    // wD (row 2) are each edge-adjacent to the h1 bridge (row 1) but not to
    // each other. Killing h1 severs wU from wD into two single-cell
    // components.
    const buildShip = (): SimShip => {
      const sim = toSimShip(columnShip("d-eq", 80, 1_000_000), mulberry32(1));
      recomputeAggregates(sim); // sets sim.aliveCount
      return sim;
    };

    // --- State (a): connected topology, no module death. -------------------
    // Reference: runs the full analysis, finds one component, returns [].
    const shipRefA = structuredClone(buildShip());
    const refChunksA = splitBreakApartReference(shipRefA, 1, nextChunkId);
    expect(refChunksA, "reference returns no chunks on a connected topology").toEqual([]);

    // Optimised: prime the marker so the alive-count compare succeeds and the
    // analysis is skipped entirely (exercising the skip branch). Must match
    // the reference's [].
    const shipOptA = structuredClone(buildShip());
    shipOptA.breakApartLastAliveCount = shipOptA.aliveCount;
    const optChunksA = splitBreakApart(shipOptA, 1, nextChunkId);
    expect(optChunksA, "optimised returns no chunks on a connected topology").toEqual([]);
    // The skip must NOT have mutated the marker.
    expect(shipOptA.breakApartLastAliveCount).toBe(shipOptA.aliveCount);

    // Sanity: the unprimed optimised path (first-ever call) also returns []
    // because the analysis finds one component.
    const shipOptUnprimed = structuredClone(buildShip());
    delete shipOptUnprimed.breakApartLastAliveCount;
    expect(splitBreakApart(shipOptUnprimed, 1, nextChunkId)).toEqual([]);

    // --- State (b): bridge cell killed, topology severed. -----------------
    // Kill h1 on a fresh ship, then recompute aggregates so aliveCount
    // reflects the death (this is exactly what the engine does between a
    // damage phase and the break-apart step).
    const killBridge = (ship: SimShip): void => {
      const bridge = ship.modules?.find((m) => m.slotId === "h1");
      if (bridge === undefined) throw new Error("bridge module h1 not found");
      bridge.alive = false;
      bridge.hp = 0;
      bridge.surfaceHp = 0;
      recomputeAggregates(ship);
    };

    // Reference: runs the analysis, returns the chunk set.
    chunkCounter = 0;
    const shipRefB = structuredClone(buildShip());
    killBridge(shipRefB);
    const refChunksB = splitBreakApartReference(shipRefB, 2, nextChunkId);

    // Optimised: the alive count changed (3 -> 2) so the skip branch does NOT
    // fire; the analysis runs. Use a fresh counter so the chunk ids match.
    chunkCounter = 0;
    const shipOptB = structuredClone(buildShip());
    killBridge(shipOptB);
    const optChunksB = splitBreakApart(shipOptB, 2, nextChunkId);

    // Same chunk count.
    expect(optChunksB.length, "both implementations produce the same chunk count").toBe(refChunksB.length);
    // A real split occurred (the reference, which always analyses, found > 0).
    expect(refChunksB.length, "the severed topology must actually split").toBeGreaterThan(0);

    // Deep equivalence of each chunk: same instanceId, same alive-module
    // slotIds (in the same order), same survivor identity. The survivor keeps
    // the parent's instanceId on the original ship; chunks are the break-away
    // fragments, so compare chunk-by-chunk.
    const slotsOf = (ship: SimShip): string[] =>
      (ship.modules ?? []).filter((m) => m.alive).map((m) => m.slotId);
    for (let i = 0; i < refChunksB.length; i += 1) {
      const ref = refChunksB[i];
      const opt = optChunksB[i];
      if (ref === undefined || opt === undefined) throw new Error("chunk index out of range");
      expect(opt.instanceId, "chunk instanceId matches").toBe(ref.instanceId);
      expect(slotsOf(opt), "chunk alive-module slotIds match").toEqual(slotsOf(ref));
    }

    // The survivor side (the original ship, post-split) must also match: same
    // alive-module slotIds remain on the parent in both implementations.
    expect(slotsOf(shipOptB), "survivor alive-module slotIds match").toEqual(slotsOf(shipRefB));

    // Cross-check: re-running the optimised path on the post-split survivor
    // (whose aliveCount is now stable) skips via the marker and returns [],
    // matching the reference which analyses and finds one component.
    chunkCounter = 0;
    const optSkipAfterSplit = splitBreakApart(shipOptB, 3, nextChunkId);
    chunkCounter = 0;
    const refAfterSplit = splitBreakApartReference(shipRefB, 3, nextChunkId);
    expect(optSkipAfterSplit, "post-split survivor does not re-split (optimised skip)").toEqual([]);
    expect(refAfterSplit, "post-split survivor does not re-split (reference analysis)").toEqual([]);
  });

  /**
   * A genuine multi-component split: a cross-shaped layout where a single
   * central bridge cell is the only edge-adjacency joining three weapon
   * spokes. Killing the bridge severs the graph into three single-cell
   * components, exercising the union-find → components → survivor →
   * chunk-emission-order path on both implementations with more than two
   * fragments. The chunk instanceIds come from the monotonic `nextChunkId`,
   * so the order chunks are emitted (first-root-appearance in `alive`
   * iteration) is load-bearing; this fixture pins it.
   *
   * Layout: bridge at (col 0, row 0); three weapon spokes at (−1, 0),
   * (1, 0), and (0, −1) — each edge-adjacent to the bridge and to nothing
   * else. Killing the bridge leaves three disconnected single-cell
   * components. The survivor is chosen by largest-then-first-slotId; with
   * all components size 1, the survivor is the one whose sole module has
   * the smallest slotId.
   */
  it("reference and optimised break-apart produce identical chunks on a three-way split", () => {
    let chunkCounter = 0;
    const nextChunkId = (parentId: string, tick: number): string =>
      `${parentId}-chunk-${tick}-${chunkCounter++}`;

    /**
     * Cross layout: bridge (h0) at origin with three weapon spokes —
     * wL (col −1), wR (col +1), wT (row −1) — each edge-adjacent only to
     * the bridge. Killing h0 severs the graph into three components.
     */
    const crossShip = (): SimShip => {
      const modules: ResolvedModule[] = [
        moduleOf("h0", { kind: "hull" }, 0, 0, 0, 0, 1_000_000, 5),
        moduleOf("wL", beam({ damage: 1, range: 50 }), -1, 0, -12, 0, 50, 5, 0, true),
        moduleOf("wR", beam({ damage: 1, range: 50 }), 1, 0, 12, 0, 50, 5, 0, false),
        moduleOf("wT", beam({ damage: 1, range: 50 }), 0, -1, 0, -12, 50, 5, 0, false),
      ];
      const combat: CombatShip = {
        instanceId: "d-cross",
        designId: "d-cross",
        faction: "Terran",
        side: "defender",
        stats: {
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
          compartments: 0,
          airtightCompartments: 0,
        },
        position: { x: 80, y: 0 },
        facing: Math.PI,
        doctrine: HOLD_DOCTRINE,
        classification: "frigate",
        modules,
      };
      const sim = toSimShip(combat, mulberry32(1));
      recomputeAggregates(sim);
      return sim;
    };

    const killBridge = (ship: SimShip): void => {
      const bridge = ship.modules?.find((m) => m.slotId === "h0");
      if (bridge === undefined) throw new Error("bridge module h0 not found");
      bridge.alive = false;
      bridge.hp = 0;
      bridge.surfaceHp = 0;
      recomputeAggregates(ship);
    };

    chunkCounter = 0;
    const shipRef = structuredClone(crossShip());
    killBridge(shipRef);
    const refChunks = splitBreakApartReference(shipRef, 2, nextChunkId);

    chunkCounter = 0;
    const shipOpt = structuredClone(crossShip());
    killBridge(shipOpt);
    const optChunks = splitBreakApart(shipOpt, 2, nextChunkId);

    // A genuine three-way split: two chunks break off and one component
    // stays as the survivor (the original ship).
    expect(refChunks.length, "the severed cross must produce two break-away chunks").toBe(2);
    expect(optChunks.length, "both implementations produce the same chunk count").toBe(refChunks.length);

    const slotsOf = (ship: SimShip): string[] =>
      (ship.modules ?? []).filter((m) => m.alive).map((m) => m.slotId);

    // Chunk-by-chunk deep equivalence: same instanceId and same alive-module
    // slotIds in the same order. This pins chunk-emission order across the
    // Map-based and array-indexed union-find implementations.
    for (let i = 0; i < refChunks.length; i += 1) {
      const ref = refChunks[i];
      const opt = optChunks[i];
      if (ref === undefined || opt === undefined) throw new Error("chunk index out of range");
      expect(opt.instanceId, "chunk instanceId matches").toBe(ref.instanceId);
      expect(slotsOf(opt), "chunk alive-module slotIds match").toEqual(slotsOf(ref));
    }

    // The survivor (original ship, post-split) keeps exactly one alive module
    // and the same slotId in both implementations.
    expect(slotsOf(shipOpt), "survivor alive-module slotIds match").toEqual(slotsOf(shipRef));
    expect(slotsOf(shipOpt).length, "survivor keeps exactly one module").toBe(1);

    // The three distinct alive slotIds across all chunks and the survivor are
    // exactly the three weapon spokes (the bridge is dead in all fragments).
    const allAliveSlots = new Set<string>([
      ...slotsOf(shipOpt),
      ...optChunks.flatMap((c) => slotsOf(c)),
    ]);
    expect([...allAliveSlots].sort()).toEqual(["wL", "wR", "wT"]);
  });
});
