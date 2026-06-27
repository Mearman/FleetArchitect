import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/domain/grid";
import { mulberry32 } from "@/domain/simulation/rng";
import {
  buildShipCellHash,
  resolveShipCollisions,
  resolveShipCollisionsReference,
  type ShipCell,
  type ShipContact,
} from "@/domain/simulation/engine/collision";
import { toSimShip } from "@/domain/simulation/engine/setup";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { ModuleEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";
import type { SimShip } from "@/domain/simulation/engine/types";
import type { SpatialHash } from "@/domain/simulation/spatial-hash";

/**
 * Equivalence between the reference (oracle) and optimised ship-pair collision
 * broad-phases. Both implementations share the narrow-phase (outline refine,
 * impulse, positional separation), so equivalence reduces to: the candidate
 * contacts each generates lead to the same resolved ShipContact[] — same set of
 * unordered ship pairs, and per pair the same depth, contact point, normal, and
 * approach velocity. The resolver mutates ship state (impulse + separation), so
 * each path runs against a fresh deep clone of the resolved ships.
 */

const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

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
    ...over,
    compartments: 0,
    airtightCompartments: 0,
  };
}

function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  mass = 5,
  command = false,
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    x: col * CELL_SIZE,
    y: row * CELL_SIZE,
    maxSurfaceHp: 0,
    maxSubstrateHp: 1000,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    surface: "deck",
    edges: OPEN_EDGES,
    mass,
    powerDraw: 0,
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

interface BuildOpts {
  /** When set, the CombatShip carries a chamfered hull outline so the
   *  polygon narrow-phase refines the disc contact. */
  outline?: { x: number; y: number }[][];
  velocity?: { x: number; y: number };
}

/** A compact 3x1 modular ship (command + two hull cells) with no engine: a
 *  closed drifting body whose only interaction is the contact impulse. */
function driftingShip(
  id: string,
  side: "attacker" | "defender",
  position: { x: number; y: number },
  facing: number,
  opts: BuildOpts = {},
): CombatShip {
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side,
    stats: stats({ thrust: 0 }),
    position,
    facing,
    velocity: opts.velocity,
    // Empty doctrine matches the legacy defaults: stance undefined -> balanced
    // fallback, crew undefined -> combat, targeting undefined -> nearest.
    doctrine: { base: {}, rules: [] },
    classification: "frigate",
    outline: opts.outline,
    modules: [
      moduleOf("c1", { kind: "power", output: 40 }, 0, 0, 5, true),
      moduleOf("h1", { kind: "hull" }, 1, 0, 5),
      moduleOf("h2", { kind: "hull" }, -1, 0, 5),
    ],
  };
}

function resolveToSim(ships: CombatShip[]): SimShip[] {
  const rng = mulberry32(7);
  return ships.map((s) => toSimShip(s, rng));
}

/** Build a fresh cell hash over a snapshot of the ships. The hash captures each
 *  cell's world-space centre at build time; the resolver reads live ship fields
 *  (velocity, position) from the SimShip references inside each entry, so the
 *  ships passed here are the ones the resolver will mutate. */
function buildHash(ships: SimShip[]): SpatialHash<ShipCell> {
  return buildShipCellHash(ships);
}

interface PairSummary {
  depth: number;
  px: number;
  py: number;
  nx: number;
  ny: number;
  relVx: number;
  relVy: number;
}

/** Normalise a resolved contact list to a pair-keyed map so order-independent
 *  comparison is exact. The resolver already returns contacts sorted by pair
 *  key, but keying makes the equivalence assertion robust to that. */
function summarise(contacts: readonly ShipContact[]): Map<string, PairSummary> {
  const out = new Map<string, PairSummary>();
  for (const c of contacts) {
    const lo = c.a.instanceId < c.b.instanceId ? c.a.instanceId : c.b.instanceId;
    const hi = c.a.instanceId < c.b.instanceId ? c.b.instanceId : c.a.instanceId;
    out.set(`${lo}|${hi}`, {
      depth: c.depth,
      px: c.px,
      py: c.py,
      nx: c.nx,
      ny: c.ny,
      relVx: c.relVx,
      relVy: c.relVy,
    });
  }
  return out;
}

function expectEquivalent(ref: readonly ShipContact[], opt: readonly ShipContact[]): void {
  const r = summarise(ref);
  const o = summarise(opt);
  expect(o.size, "optimised must produce the same number of contacts as the reference").toBe(r.size);
  for (const [key, expected] of r) {
    const got = o.get(key);
    expect(got, `optimised must produce a contact for pair ${key}`).toBeDefined();
    expect(got!.depth).toBeCloseTo(expected.depth, 10);
    expect(got!.px).toBeCloseTo(expected.px, 10);
    expect(got!.py).toBeCloseTo(expected.py, 10);
    expect(got!.nx).toBeCloseTo(expected.nx, 10);
    expect(got!.ny).toBeCloseTo(expected.ny, 10);
    expect(got!.relVx).toBeCloseTo(expected.relVx, 10);
    expect(got!.relVy).toBeCloseTo(expected.relVy, 10);
  }
}

describe("engine.collision broad-phase — reference vs optimised equivalence", () => {
  it("two overlapping ships produce an equivalent contact (disc narrow-phase)", () => {
    // Two 3x1 ships placed so their centre cells overlap well within the cell
    // contact distance — a genuine disc contact, not a near-miss.
    const a = driftingShip("a1", "attacker", { x: 0, y: 0 }, 0);
    const b = driftingShip("b1", "defender", { x: CELL_SIZE * 0.5, y: 0 }, 0);
    const refShips = structuredClone(resolveToSim([a, b]));
    const optShips = structuredClone(resolveToSim([a, b]));
    const ref = resolveShipCollisionsReference(buildHash(refShips));
    const opt = resolveShipCollisions(buildHash(optShips));
    expect(ref.length, "a contact must actually form").toBeGreaterThan(0);
    expectEquivalent(ref, opt);
  });

  it("a fast-sweeping pair still matches (tunnelling candidate path)", () => {
    // Both ships carry a per-tick displacement far above CELL_SIZE. The contact
    // depth is computed on post-move positions, so wherever the post-move cells
    // land within the contact distance the two broad-phases must agree — the
    // swept-segment query (reference) and the static-disc query (optimised)
    // gather the same post-move candidate, and recordDeepest produces the same
    // contact from the same post-move cell pair.
    const a = driftingShip("a1", "attacker", { x: 0, y: 0 }, 0, {
      velocity: { x: CELL_SIZE * 50, y: 0 },
    });
    const b = driftingShip("b1", "defender", { x: CELL_SIZE * 0.25, y: 0 }, 0, {
      velocity: { x: -CELL_SIZE * 50, y: 0 },
    });
    const refShips = structuredClone(resolveToSim([a, b]));
    const optShips = structuredClone(resolveToSim([a, b]));
    const ref = resolveShipCollisionsReference(buildHash(refShips));
    const opt = resolveShipCollisions(buildHash(optShips));
    expect(ref.length, "a contact must actually form").toBeGreaterThan(0);
    expectEquivalent(ref, opt);
  });

  it("outline-refined contacts match (polygon narrow-phase)", () => {
    // Ship outlines that enclose the cells: a 5x5 square loop in ship-local
    // coordinates. `outerWorldLoop` transforms the loop into world space; with
    // both ships at facing 0 and overlapping positions the polygons overlap, so
    // the narrow-phase replaces the disc contact point/normal with the polygon
    // contact. Both broad-phases feed the same shared narrow-phase, so the
    // refined output must match.
    const half = CELL_SIZE * 2.5;
    const squareOutline = [
      [
        { x: -half, y: -half },
        { x: half, y: -half },
        { x: half, y: half },
        { x: -half, y: half },
      ],
    ];
    const a = driftingShip("a1", "attacker", { x: 0, y: 0 }, 0, { outline: squareOutline });
    const b = driftingShip("b1", "defender", { x: CELL_SIZE * 0.5, y: 0 }, 0, {
      outline: squareOutline,
    });
    const refShips = structuredClone(resolveToSim([a, b]));
    const optShips = structuredClone(resolveToSim([a, b]));
    const ref = resolveShipCollisionsReference(buildHash(refShips));
    const opt = resolveShipCollisions(buildHash(optShips));
    expect(ref.length, "a refined contact must actually form").toBeGreaterThan(0);
    expectEquivalent(ref, opt);
  });

  it("distant ships produce no contact on either path", () => {
    const a = driftingShip("a1", "attacker", { x: 0, y: 0 }, 0);
    const b = driftingShip("b1", "defender", { x: 10_000, y: 0 }, 0);
    const refShips = structuredClone(resolveToSim([a, b]));
    const optShips = structuredClone(resolveToSim([a, b]));
    const ref = resolveShipCollisionsReference(buildHash(refShips));
    const opt = resolveShipCollisions(buildHash(optShips));
    expect(ref).toHaveLength(0);
    expect(opt).toHaveLength(0);
  });
});
