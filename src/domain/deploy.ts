/**
 * Formation-tree deployment: place each ship leaf by its authored formation
 * geometry rather than the legacy radius-spaced column.
 *
 * The resolver (`resolveFleetToCombatShips`) resolves every leaf's per-ship
 * data first (modules, stats, doctrine), then hands the resolved leaves here
 * for positioning. Two paths:
 *
 *  1. The legacy column ({@link placeByColumn} lives in `resolve.ts` inline):
 *     a flat root with no `pattern` layout anywhere in the tree stacks its
 *     leaves vertically, byte-identical to the pre-formation resolve.
 *  2. The pattern walk ({@link placeByPattern}): if any formation in the tree
 *     carries a `pattern` layout, walk the tree recursively and place each
 *     child by its pattern offset (or explicit slot), rotated by its parent's
 *     accumulated facing.
 *
 * This module is independent of `resolve.ts`'s per-ship helpers: the builder
 * for a resolved leaf's {@link CombatShip} is passed in as a callback, so no
 * import cycle is created. The {@link ResolvedEntry} type carries only schema
 * types (formation leaf, design, stats, weapon effects), so it lives here and
 * is imported by `resolve.ts`.
 */

import { childOffset, rotateOffset } from "@/domain/formation-layout";
import type { CombatShip } from "@/domain/simulation/types";
import type { ShipStats } from "@/domain/stats";
import type { Formation, FormationLeaf, Offset2 } from "@/schema/formation";
import type { ShipDesign } from "@/schema/ship";
import type { WeaponEffect } from "@/schema/module";

/**
 * A ship leaf paired with its resolved design data, built once per leaf so both
 * deployment paths (the legacy column and the pattern walk) share the same
 * per-ship work — stats, radius, modules, outline, doctrine, formation
 * identity. Sharing the builder guarantees the two paths produce
 * byte-identical {@link CombatShip}s apart from `position`/`facing`, which each
 * path computes from its own geometry.
 */
export interface ResolvedEntry {
  leaf: FormationLeaf;
  design: ShipDesign;
  grownDesign: ShipDesign;
  stats: ShipStats;
  radius: number;
  weapons: WeaponEffect[];
  sightReachM: number;
  accelMps2: number;
}

/**
 * Build a {@link CombatShip} from a resolved entry at a given position and
 * facing. Passed as a callback to {@link placeByPattern} so this module stays
 * independent of `resolve.ts`'s per-ship helpers (no import cycle). The
 * `instanceIndex` is the ship's position in the output array (the resolver's
 * pre-order DFS leaf order), giving a deterministic instanceId.
 */
export type ShipBuilder = (
  entry: ResolvedEntry,
  position: { x: number; y: number },
  facing: number,
  instanceIndex: number,
) => CombatShip;

/**
 * Does any formation in the tree carry a `pattern` layout? A flat/absent fleet
 * (the preset path) has none, so the legacy column runs byte-identically. The
 * first pattern anywhere flips the whole fleet to the recursive pattern walk,
 * because once one node's children are arranged by authored geometry the whole
 * tree must compose by parent anchor + child offset rather than the global
 * leaf-stack column. Explicit `slot`s on children of a column/absent formation
 * do NOT trigger the pattern path (slots are ignored under column per the
 * schema contract); only an authored pattern layout does.
 */
export function hasPatternLayout(formation: Formation): boolean {
  if (formation.layout?.kind === "pattern") return true;
  for (const child of formation.children) {
    if (child.kind === "formation" && hasPatternLayout(child.formation)) return true;
  }
  return false;
}

/**
 * Place each leaf by its authored formation geometry: the root anchors at the
 * side's deployment edge (`dir · edgeInset, 0`), and each child is offset in
 * its parent's local frame by the pattern formula (or its explicit slot
 * override) and rotated by the parent's accumulated facing. Sub-formations
 * recurse with `childFacing = parentFacing + (child.formation.facing ?? 0)` so
 * a sub-formation authored at a relative bearing to its parent composes
 * correctly, and the defender's mirror (parentFacing = π) emerges from the
 * rotation rather than a special case.
 *
 * `childOffset` and `rotateOffset` are imported from `formation-layout.ts` —
 * the SAME helpers the fleet-builder preview uses — so a player's drag-tuned
 * layout is exactly what deploys. Both walkers are pre-order DFS in child
 * order, matching `collectFormationLeaves`'s leaf sequence, so the index into
 * `resolved[]` advances in lockstep with the recursive visit and every
 * instanceId/formation-identity field is byte-identical to the column path.
 *
 * @param rootFormation The fleet's root formation.
 * @param resolved      The resolved leaves in pre-order DFS order (from
 *                      `collectFormationLeaves`).
 * @param edgeInset     The deployment edge inset (metres from the midline),
 *                      derived from ship sizes/weapon reach by the caller.
 * @param side          Which side the fleet deploys on.
 * @param buildShip     Callback that builds a {@link CombatShip} from a resolved
 *                      entry at a position/facing (the resolver's per-ship
 *                      builder, kept out of this module to avoid an import
 *                      cycle).
 */
export function placeByPattern(
  rootFormation: Formation,
  resolved: readonly ResolvedEntry[],
  edgeInset: number,
  side: "attacker" | "defender",
  buildShip: ShipBuilder,
): CombatShip[] {
  const ships: CombatShip[] = [];
  // Attackers anchor left of the midline facing +x (0); defenders anchor right
  // facing -x (π). The root anchor sits at the deployment edge — the same
  // `edgeInset` term the column path uses, so the pattern fleet and a
  // same-composition column fleet deploy at the same depth from the midline.
  const dir = side === "attacker" ? -1 : 1;
  const baseFacing = side === "attacker" ? 0 : Math.PI;
  const rootAnchor = { x: dir * edgeInset, y: 0 };

  // Index into `resolved[]`, advanced as ship leaves are encountered in
  // pre-order DFS — matching `collectFormationLeaves`'s yield order.
  let resolvedIdx = 0;

  const visit = (
    formation: Formation,
    anchor: { x: number; y: number },
    parentFacing: number,
  ): void => {
    const layout = formation.layout;
    const children = formation.children;
    const count = children.length;
    for (let i = 0; i < count; i += 1) {
      const child = children[i];
      if (child === undefined) continue;
      // The child's local-frame offset (forward along facing, lateral left
      // positive). `childOffset` returns the explicit `slot` if authored,
      // otherwise the pattern formula; a column/absent layout yields a lateral
      // abreast line (the formation-layout.ts default).
      const offset: Offset2 = childOffset(child, layout, i, count);
      // Rotate into the parent's facing frame, then translate to the anchor.
      // For facing 0 (attacker) forward → +x, lateral → +y; for facing π
      // (defender) both axes flip, giving the mirror image.
      const rotated = rotateOffset(offset, parentFacing);
      const childPos = {
        x: anchor.x + rotated.forward,
        y: anchor.y + rotated.lateral,
      };

      if (child.kind === "ship") {
        const entry = resolved[resolvedIdx];
        resolvedIdx += 1;
        // A leaf whose design is missing was filtered out of `resolved` (the
        // column path skips it too), so `resolved` and the DFS leaf order stay
        // in lockstep by construction. Defensive guard for a gap the filters
        // make impossible — never expected to fire.
        if (entry === undefined) continue;
        ships.push(buildShip(entry, childPos, parentFacing, ships.length));
      } else if (child.kind === "formation") {
        // Recurse: the sub-formation's anchor is the child's computed position,
        // and its facing is the parent's facing plus the sub-formation's
        // authored relative bearing. The rotation in the next level places the
        // sub-formation's children in the rotated frame.
        const childFacing = parentFacing + (child.formation.facing ?? 0);
        visit(child.formation, childPos, childFacing);
      }
      // kind === "template": inlined into the tree before resolve by
      // `expandTemplates`; an unexpanded template is silently skipped here,
      // matching `collectFormationLeaves`.
    }
  };

  visit(rootFormation, rootAnchor, baseFacing);
  return ships;
}
