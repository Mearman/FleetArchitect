import { describe, expect, it } from "vitest";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { computeHullOutline } from "@/domain/hull-outline";
import { growArmourHull, padGrid } from "@/domain/hull-armour";
import { catalog } from "@/data/catalog";
import { presetDesigns } from "@/data/presets";
import { nowIso } from "@/domain/id";
import { mulberry32 } from "@/domain/simulation/rng";
import { toSimShip } from "@/domain/simulation/engine/setup";
import { shipDescriptor } from "@/domain/simulation/engine/snapshot";
import { flatFormation } from "@/schema/formation";
import type { Fleet } from "@/schema/fleet";
import type { ShipDesign } from "@/schema/ship";

/**
 * Regression guard for the cross-view ship-render drift saga: the battle
 * renderer must clip against the SAME bevelled hull outline the designer
 * produces, and the descriptor must carry that bevelled outline through to the
 * renderer. Two past regressions this locks down:
 *
 *  1. resolve swapped `computeHullOutline` (bevelled, 45° facets) back to
 *     `computeOutline` (tight octilinear), so the battle silhouette stopped
 *     matching the designer render.
 *  2. the descriptor dropped or substituted the outline, so the chamfer clip
 *     was applied against the wrong (or no) path.
 *
 * For every preset design we re-derive the expected bevelled outline from the
 * same helpers resolve uses and assert: the resolved CombatShip carries it, it
 * matches the re-derivation, and the descriptor built from the SimShip prefers
 * it over the collision outline.
 */

/** Build a single-design fleet referencing `design.id` as its only deployable. */
function fleetFor(design: ShipDesign): Fleet {
  return {
    id: "f-consistency",
    name: "consistency",
    faction: design.faction,
    formation: flatFormation([
      { designId: design.id, position: { x: 0, y: 0 }, facing: 0 },
    ]),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "user",
    revision: 1,
  };
}

/** Re-derive the bevelled render outline exactly as resolve does (resolve.ts:
 *  grownDesign.grid = growArmourHull(padGrid(design.grid, 1)); then
 *  computeHullOutline(grownDesign.grid)). */
function expectedRenderOutline(design: ShipDesign): { x: number; y: number }[][] {
  return computeHullOutline(growArmourHull(padGrid(design.grid, 1)));
}

/** Structural equality for outline loops: same loop count, same vertex counts,
 *  and each vertex pair within 1 ULP. Identical computations re-derived from the
 *  same helpers are bit-identical, so this is exact in practice — but per-number
 *  toBeCloseTo keeps the guard robust to platform FP quirks while still catching
 *  the structural drift (computeOutline vs computeHullOutline produce different
 *  vertex counts and positions). */
function expectOutlinesEqual(
  actual: { x: number; y: number }[][] | undefined,
  expected: { x: number; y: number }[][],
): void {
  expect(actual).toBeDefined();
  if (actual === undefined) return; // narrowed for the typechecker
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    const aLoop = actual[i];
    const eLoop = expected[i];
    if (aLoop === undefined || eLoop === undefined) throw new Error("missing loop");
    expect(aLoop.length).toBe(eLoop.length);
    for (let j = 0; j < eLoop.length; j += 1) {
      const a = aLoop[j];
      const e = eLoop[j];
      if (a === undefined || e === undefined) throw new Error("missing vertex");
      expect(a.x).toBeCloseTo(e.x, 9);
      expect(a.y).toBeCloseTo(e.y, 9);
    }
  }
}

describe("preset design outline consistency (resolve → descriptor → renderer)", () => {
  for (const design of presetDesigns) {
    it(`${design.id}: CombatShip.renderOutline is the bevelled hull outline and the descriptor prefers it`, () => {
      const designs = new Map([[design.id, design]]);
      const [ship] = resolveFleetToCombatShips(
        fleetFor(design),
        designs,
        catalog(),
        "attacker",
      );
      expect(ship).toBeDefined();
      if (ship === undefined) return;

      const expected = expectedRenderOutline(design);
      // A preset with at least one solid cell always grows a non-empty bevelled
      // outline, so renderOutline must be attached (resolve spreads it only when
      // non-empty — undefined here means someone broke the threading).
      expect(expected.length).toBeGreaterThan(0);
      expect(ship.renderOutline).toBeDefined();

      // Guard 1: the resolved outline is the BEVELLED hull outline
      // (computeHullOutline), not the tight collision outline (computeOutline).
      // Swapping the helper back produces a structurally different path.
      expectOutlinesEqual(ship.renderOutline, expected);

      // Guard 2: the descriptor built from the live SimShip prefers the
      // bevelled render outline over the collision outline, so the chamfer clip
      // the renderer applies matches the designer silhouette.
      const simShip = toSimShip(ship, mulberry32(1));
      const descriptor = shipDescriptor(simShip);
      expectOutlinesEqual(descriptor.outline, expected);
    });
  }
});
