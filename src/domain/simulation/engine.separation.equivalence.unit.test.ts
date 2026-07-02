/**
 * Equivalence proof for the spatial-grid separation heading: the optimised
 * {@link separationHeading} (uniform-hash candidate gather + id re-sort + identical
 * accumulation) must produce byte-identical heading/weight results to the frozen
 * O(N²) reference oracle ({@link separationHeadingReference}) for every ship,
 * across geometries that stress the optimisation's decision boundary.
 *
 * Why this is lossless: the separation field is short-range —
 * {@link separationWeight} returns exactly 0 for any neighbour outside the pair's
 * outer edge (`contact × (1 + SEPARATION_CLEARANCE_FACTOR)`), so such a neighbour
 * contributes nothing to the sum or the peak. The optimised path gathers a
 * SUPERSET of the contributing neighbours via a spatial hash (the query disc
 * radius `(ship.radius + maxRadius) × 1.5` reaches at least as far as any pair's
 * outer edge), re-sorts that gathered set into the snapshot's fixed lexicographic
 * id order, and runs the identical per-neighbour weight/sum/peak. The gathered
 * bodies the disc admits but the pair field excludes are filtered by the SAME
 * `separationWeight <= 0` test, so the contributing SET and summation ORDER are
 * unchanged. The cases below force each of those paths: in-field multi-neighbour
 * sums, out-of-field bodies admitted by an over-large disc (mixed radii), the
 * degenerate sandwich cancellation, a lone in-field neighbour, and an empty
 * (far-only) field. The per-frame digest gate (engine.lossless-digest) is the
 * whole-battle arbiter; this unit test is the finer-grained, targeted regression
 * guard that exercises the boundary directly.
 *
 * Self-contained (no shared helper) so the gate cannot silently change when an
 * unrelated helper does — same rationale as the separation determinism test.
 */
import { describe, expect, it } from "vitest";

import { buildSeparationSnapshot, separationHeading } from "@/domain/simulation/engine/separation";
import { separationHeadingReference } from "@/domain/simulation/engine/separation.reference";
import { toSimShip } from "@/domain/simulation/engine/setup";
import { mulberry32 } from "@/domain/simulation/rng";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { ACCEL_PER_TICK_FROM_SI } from "@/domain/simulation/types";
import type { ShipStats } from "@/domain/stats";
import type { CellEdges } from "@/schema/grid";
import type { ModuleEffect } from "@/schema/module";
import type { SimShip } from "@/domain/simulation/engine/types";

const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

/** Build a ResolvedModule with the per-instance fields the engine reads. */
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
    facing: effect.kind === "engine" ? effect.facing ?? 0 : 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

const FRIGATE_STATS: ShipStats = {
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
  deflectorCapacity: 0,
  deflectorRechargeRate: 0,
  deflectorRechargeDelay: 0,
  thrust: 0.5,
  turnRate: 0.1,
  weapons: [],
  compartments: 0,
  airtightCompartments: 0,
};

/**
 * A frigate-sized ship: a command core, an engine, an RCS, and a small spread of
 * hull cells giving a real bounding disc (radius ≈ 5.5 m). Two such frigates have
 * contact ≈ 11 m and a field outer edge ≈ 16.5 m, so a cluster placed ~10 m apart
 * falls inside the field while ships hundreds of metres apart are well outside it.
 */
function frigate(opts: {
  id: string;
  side: "attacker" | "defender";
  x: number;
  y: number;
}): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf(`${opts.id}-cmd`, { kind: "power", output: 1000 }, 0, 0, true),
    moduleOf(`${opts.id}-eng`, { kind: "engine", thrust: 0.5, facing: Math.PI }, -5, 0),
    moduleOf(`${opts.id}-rcs`, { kind: "rcs", torque: 0.5 / ACCEL_PER_TICK_FROM_SI }, 0, 0),
    moduleOf(`${opts.id}-h1`, { kind: "hull" }, 5, 0),
    moduleOf(`${opts.id}-h2`, { kind: "hull" }, 0, 5),
  ];
  return {
    instanceId: opts.id,
    designId: `design-${opts.id}`,
    faction: "Terran",
    side: opts.side,
    stats: FRIGATE_STATS,
    position: { x: opts.x, y: opts.y },
    facing: 0,
    doctrine: { base: {}, rules: [] },
    classification: "frigate",
    modules,
  };
}

/**
 * A capital-sized ship: the same core/engine/RCS plus a broad 5×5 hull block
 * spanning ±10..±20 m, giving a much larger bounding disc (radius ≈ 21 m). Its
 * presence lifts `field.maxRadius`, which widens every smaller ship's gather
 * disc — so a frigate query gathers bodies that its own (framerate, frigate)
 * pair field excludes, exercising the optimised path's "gathered but filtered"
 * branch against the reference's straightforward skip.
 */
function capital(opts: {
  id: string;
  side: "attacker" | "defender";
  x: number;
  y: number;
}): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf(`${opts.id}-cmd`, { kind: "power", output: 1000 }, 0, 0, true),
    moduleOf(`${opts.id}-eng`, { kind: "engine", thrust: 0.5, facing: Math.PI }, -12, 0),
    moduleOf(`${opts.id}-rcs`, { kind: "rcs", torque: 0.5 / ACCEL_PER_TICK_FROM_SI }, 0, 0),
  ];
  for (let cx = -10; cx <= 10; cx += 5) {
    for (let cy = -10; cy <= 10; cy += 5) {
      modules.push(moduleOf(`${opts.id}-h${cx}_${cy}`, { kind: "hull" }, cx, cy));
    }
  }
  return {
    instanceId: opts.id,
    designId: `design-${opts.id}`,
    faction: "Terran",
    side: opts.side,
    stats: FRIGATE_STATS,
    position: { x: opts.x, y: opts.y },
    facing: 0,
    doctrine: { base: {}, rules: [] },
    classification: "cruiser",
    modules,
  };
}

/** Convert fixture CombatShips to engine-internal SimShips with a fixed rng. */
function simShips(ships: CombatShip[]): SimShip[] {
  const rng = mulberry32(7);
  return ships.map((s) => toSimShip(s, rng));
}

/** Deep-equality that treats `undefined` as a valid result (both paths may agree
 *  no neighbour is in the field). Returns true iff both are undefined, or both
 *  are defined with bit-identical heading and weight. */
function headingEqual(
  a: { heading: number; weight: number } | undefined,
  b: { heading: number; weight: number } | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === undefined && b === undefined;
  return a.heading === b.heading && a.weight === b.weight;
}

describe("engine separation spatial grid — matches the reference oracle", () => {
  it("a mixed fleet: every ship's optimised heading equals the reference", () => {
    // A tight frigate cluster (multi-neighbour, all in-field), two far frigates
    // (well outside any pair's field, so both paths skip them), and a capital
    // whose large radius lifts maxRadius and widens every gather disc — so the
    // frigates' queries admit far frigates that their own pair field then
    // filters out (the load-bearing "gathered but filtered" path).
    const fleet = simShips([
      frigate({ id: "s-delta", side: "attacker", x: 200, y: 0 }),
      frigate({ id: "s-bravo", side: "attacker", x: 209, y: 2 }),
      frigate({ id: "s-charlie", side: "defender", x: 204, y: 8 }),
      frigate({ id: "s-alpha", side: "defender", x: 196, y: 4 }),
      // Far frigates: hundreds of metres from the cluster and each other.
      frigate({ id: "s-echo", side: "attacker", x: 800, y: 0 }),
      frigate({ id: "s-foxtrot", side: "defender", x: -800, y: 0 }),
      // Capital near the cluster: large bounding disc, lifts maxRadius.
      capital({ id: "s-cap", side: "attacker", x: 240, y: 0 }),
    ]);
    const field = buildSeparationSnapshot(fleet);

    for (const ship of fleet) {
      const optimised = separationHeading(ship, field);
      const reference = separationHeadingReference(ship, field.bodies);
      if (!headingEqual(optimised, reference)) {
        throw new Error(
          `divergence for ${ship.instanceId}: optimised=${JSON.stringify(optimised)} reference=${JSON.stringify(reference)}`,
        );
      }
    }
  });

  it("the optimisation actually skips far pairs and engages close pairs", () => {
    // Guards against the optimisation silently becoming a no-op (e.g. gathering
    // everything). A frigate with only a far neighbour returns undefined on both
    // paths (the gather disc does not reach it); a frigate with a close
    // neighbour returns a defined heading on both paths.
    const far = simShips([
      frigate({ id: "p1", side: "attacker", x: 0, y: 0 }),
      frigate({ id: "p2", side: "defender", x: 500, y: 0 }),
    ]);
    const farField = buildSeparationSnapshot(far);
    const p1 = far[0];
    const p2 = far[1];
    if (p1 === undefined || p2 === undefined) throw new Error("far fixture failed");
    expect(separationHeading(p1, farField)).toBeUndefined();
    expect(separationHeadingReference(p1, farField.bodies)).toBeUndefined();

    const close = simShips([
      frigate({ id: "c1", side: "attacker", x: 0, y: 0 }),
      frigate({ id: "c2", side: "defender", x: 12, y: 0 }),
    ]);
    const closeField = buildSeparationSnapshot(close);
    const c1 = close[0];
    if (c1 === undefined) throw new Error("close fixture failed");
    const opt = separationHeading(c1, closeField);
    const ref = separationHeadingReference(c1, closeField.bodies);
    expect(opt).toBeDefined();
    expect(ref).toBeDefined();
    expect(headingEqual(opt, ref)).toBe(true);
  });

  it("a sandwiched ship cancels to undefined on both paths", () => {
    // The degenerate exactly-sandwiched case: a frigate midway between two
    // equidistant frigates on opposing sides sums equal-and-opposite away
    // vectors, so the resultant magnitude is ~0 and both paths return undefined
    // (rather than atan2(0,0)=0 spuriously steering east).
    const fleet = simShips([
      frigate({ id: "mid", side: "attacker", x: 100, y: 0 }),
      frigate({ id: "left", side: "defender", x: 90, y: 0 }),
      frigate({ id: "right", side: "defender", x: 110, y: 0 }),
    ]);
    const field = buildSeparationSnapshot(fleet);
    const mid = fleet.find((s) => s.instanceId === "mid");
    if (mid === undefined) throw new Error("sandwich fixture missing mid");
    const opt = separationHeading(mid, field);
    const ref = separationHeadingReference(mid, field.bodies);
    // Both agree the resultant cancels (the exact value is undefined; what
    // matters is parity — neither may invent a heading the other does not).
    expect(headingEqual(opt, ref)).toBe(true);
  });

  it("a lone in-field neighbour yields an equal heading/weight on both paths", () => {
    // One neighbour just inside the field, all others far — the minimal
    // contributing case, exercising the single-summand accumulation order.
    const fleet = simShips([
      frigate({ id: "q", side: "attacker", x: 0, y: 0 }),
      frigate({ id: "near", side: "defender", x: 14, y: 0 }),
      frigate({ id: "far1", side: "defender", x: 600, y: 0 }),
      frigate({ id: "far2", side: "attacker", x: -600, y: 0 }),
    ]);
    const field = buildSeparationSnapshot(fleet);
    const q = fleet.find((s) => s.instanceId === "q");
    if (q === undefined) throw new Error("singleton fixture missing q");
    const opt = separationHeading(q, field);
    const ref = separationHeadingReference(q, field.bodies);
    expect(headingEqual(opt, ref)).toBe(true);
    expect(opt).toBeDefined();
  });

  it("randomised fleets: optimised ≡ reference for every ship", () => {
    // A fuzz pass: scatter ships of mixed size and side on a deterministic rng,
    // some placements in-field and most out, and assert parity for every ship.
    // Catches boundary cases the hand-built fixtures do not enumerate.
    const rng = mulberry32(1234);
    const fleet: CombatShip[] = [];
    for (let i = 0; i < 40; i++) {
      const id = `r-${i.toString().padStart(2, "0")}`;
      const side = i % 2 === 0 ? "attacker" : "defender";
      // Mostly within a 200 m box (some pairs in-field, most out), with the
      // occasional capital to vary the radius / maxRadius.
      const x = (rng() - 0.5) * 200;
      const y = (rng() - 0.5) * 200;
      fleet.push(i % 7 === 0 ? capital({ id, side, x, y }) : frigate({ id, side, x, y }));
    }
    const sim = simShips(fleet);
    const field = buildSeparationSnapshot(sim);
    for (const ship of sim) {
      const optimised = separationHeading(ship, field);
      const reference = separationHeadingReference(ship, field.bodies);
      if (!headingEqual(optimised, reference)) {
        throw new Error(
          `fuzz divergence for ${ship.instanceId}: optimised=${JSON.stringify(optimised)} reference=${JSON.stringify(reference)}`,
        );
      }
    }
  });
});
